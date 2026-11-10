create table public.finance_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  account_label text not null check (length(btrim(account_label)) between 2 and 120),
  bank_name text not null default '' check (length(bank_name) <= 120),
  account_last4 text not null default '' check (account_last4 = '' or account_last4 ~ '^[0-9]{4}$'),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  opening_balance numeric(20,4) not null default 0,
  opening_date date not null default current_date,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.finance_bank_transactions (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.finance_bank_accounts(id) on delete restrict,
  row_fingerprint text not null check (row_fingerprint ~ '^[a-f0-9]{64}$'),
  transaction_date date not null,
  direction text not null check (direction in ('credit','debit')),
  amount numeric(20,4) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  bank_reference text not null default '' check (length(bank_reference) <= 160),
  description text not null default '' check (length(description) <= 500),
  status text not null default 'unmatched' check (status in ('unmatched','matched','ignored')),
  matched_receipt_id uuid references public.shipment_invoice_payments(id) on delete restrict,
  matched_vendor_payment_id uuid references public.vendor_bill_payments(id) on delete restrict,
  matched_at timestamptz,
  matched_by uuid references auth.users(id) on delete set null,
  imported_by uuid references auth.users(id) on delete set null,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint finance_bank_transactions_fingerprint_unique unique (bank_account_id,row_fingerprint),
  constraint finance_bank_transactions_match_shape check (
    (status = 'matched' and num_nonnulls(matched_receipt_id,matched_vendor_payment_id) = 1 and matched_at is not null)
    or (status in ('unmatched','ignored') and matched_receipt_id is null and matched_vendor_payment_id is null and matched_at is null and matched_by is null)
  )
);

create index finance_bank_transactions_account_date_idx on public.finance_bank_transactions(bank_account_id,transaction_date desc);
create index finance_bank_transactions_status_idx on public.finance_bank_transactions(status,transaction_date);
create unique index finance_bank_transactions_receipt_match_unique on public.finance_bank_transactions(matched_receipt_id) where matched_receipt_id is not null;
create unique index finance_bank_transactions_vendor_payment_match_unique on public.finance_bank_transactions(matched_vendor_payment_id) where matched_vendor_payment_id is not null;

alter table public.finance_bank_accounts enable row level security;
alter table public.finance_bank_transactions enable row level security;
revoke all on public.finance_bank_accounts,public.finance_bank_transactions from anon,authenticated;
grant all on public.finance_bank_accounts,public.finance_bank_transactions to service_role;

create policy finance_bank_accounts_deny_anon on public.finance_bank_accounts for all to anon using (false) with check (false);
create policy finance_bank_accounts_deny_authenticated on public.finance_bank_accounts for all to authenticated using (false) with check (false);
create policy finance_bank_transactions_deny_anon on public.finance_bank_transactions for all to anon using (false) with check (false);
create policy finance_bank_transactions_deny_authenticated on public.finance_bank_transactions for all to authenticated using (false) with check (false);

create or replace function public.reconcile_finance_bank_transaction(
  p_transaction_id uuid,
  p_match_type text,
  p_payment_id uuid,
  p_user_id uuid
) returns public.finance_bank_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  tx public.finance_bank_transactions%rowtype;
  receipt public.shipment_invoice_payments%rowtype;
  vendor_payment public.vendor_bill_payments%rowtype;
begin
  select * into tx from public.finance_bank_transactions where id = p_transaction_id for update;
  if not found then raise exception 'Bank statement transaction not found.'; end if;

  if p_match_type = 'ignore' then
    if tx.status = 'matched' then raise exception 'Unmatch the linked payment before ignoring this bank line.'; end if;
    update public.finance_bank_transactions
      set status='ignored',matched_receipt_id=null,matched_vendor_payment_id=null,matched_at=null,matched_by=null
      where id=tx.id returning * into tx;
    return tx;
  elsif p_match_type = 'unmatch' then
    if tx.status <> 'matched' then raise exception 'This bank line is not currently matched.'; end if;
    update public.finance_bank_transactions
      set status='unmatched',matched_receipt_id=null,matched_vendor_payment_id=null,matched_at=null,matched_by=null
      where id=tx.id returning * into tx;
    return tx;
  elsif p_match_type = 'receipt' then
    if tx.status <> 'unmatched' then raise exception 'Only unmatched bank lines can be reconciled.'; end if;
    if tx.direction <> 'credit' then raise exception 'A customer receipt must match a bank credit.'; end if;
    if p_payment_id is null then raise exception 'Select a customer receipt.'; end if;
    select * into receipt from public.shipment_invoice_payments where id=p_payment_id for update;
    if not found then raise exception 'Customer receipt not found.'; end if;
    if receipt.currency <> tx.currency or abs(receipt.amount-tx.amount)>0.0001 then raise exception 'Receipt currency and amount must exactly match the bank transaction.'; end if;
    update public.finance_bank_transactions
      set status='matched',matched_receipt_id=receipt.id,matched_vendor_payment_id=null,matched_at=now(),matched_by=p_user_id
      where id=tx.id returning * into tx;
    return tx;
  elsif p_match_type = 'vendor_payment' then
    if tx.status <> 'unmatched' then raise exception 'Only unmatched bank lines can be reconciled.'; end if;
    if tx.direction <> 'debit' then raise exception 'A supplier payment must match a bank debit.'; end if;
    if p_payment_id is null then raise exception 'Select a supplier payment.'; end if;
    select * into vendor_payment from public.vendor_bill_payments where id=p_payment_id for update;
    if not found then raise exception 'Supplier payment not found.'; end if;
    if vendor_payment.currency <> tx.currency or abs(vendor_payment.amount-tx.amount)>0.0001 then raise exception 'Supplier-payment currency and amount must exactly match the bank transaction.'; end if;
    update public.finance_bank_transactions
      set status='matched',matched_receipt_id=null,matched_vendor_payment_id=vendor_payment.id,matched_at=now(),matched_by=p_user_id
      where id=tx.id returning * into tx;
    return tx;
  else
    raise exception 'Invalid bank reconciliation action.';
  end if;
end;
$$;

revoke all on function public.reconcile_finance_bank_transaction(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reconcile_finance_bank_transaction(uuid,text,uuid,uuid) to service_role;
