create table if not exists public.vendor_accounts (
  id uuid primary key default gen_random_uuid(),
  vendor_code text not null unique,
  legal_name text not null,
  display_name text not null default '',
  gstin text not null default '',
  billing_address text not null default '',
  city text not null default '',
  state text not null default '',
  state_code text not null default '',
  postal_code text not null default '',
  country text not null default 'India',
  email text not null default '',
  phone text not null default '',
  default_currency text not null default 'INR' check (default_currency ~ '^[A-Z]{3}$'),
  payment_terms text not null default 'Due within 30 days',
  is_active boolean not null default true,
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vendor_bills (
  id uuid primary key default gen_random_uuid(),
  ap_number text unique,
  vendor_id uuid not null references public.vendor_accounts(id) on delete restrict,
  job_id uuid references public.forwarding_jobs(id) on delete set null,
  supplier_invoice_no text not null,
  bill_date date not null,
  due_date date not null,
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  exchange_rate_to_inr numeric(18,8) not null default 1 check (exchange_rate_to_inr > 0),
  fx_rate_date date,
  fx_rate_source text not null default '',
  tax_mode text not null default 'exclusive' check (tax_mode in ('exclusive','inclusive')),
  supply_type text not null default 'intra_state' check (supply_type in ('intra_state','inter_state','not_applicable')),
  subtotal numeric(18,2) not null default 0 check (subtotal >= 0),
  cgst_total numeric(18,2) not null default 0 check (cgst_total >= 0),
  sgst_total numeric(18,2) not null default 0 check (sgst_total >= 0),
  igst_total numeric(18,2) not null default 0 check (igst_total >= 0),
  total_tax numeric(18,2) not null default 0 check (total_tax >= 0),
  total_amount numeric(18,2) not null default 0 check (total_amount >= 0),
  total_inr numeric(18,2) not null default 0 check (total_inr >= 0),
  status text not null default 'draft' check (status in ('draft','posted','void')),
  posted_at timestamptz,
  posted_by uuid references auth.users(id) on delete set null,
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vendor_bill_lines (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.vendor_bills(id) on delete cascade,
  line_no integer not null check (line_no > 0),
  charge_code text not null default 'OTHER',
  description text not null,
  hsn_sac text not null default '',
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null default 'service',
  unit_price numeric(18,4) not null check (unit_price > 0),
  gst_rate numeric(6,3) not null default 0 check (gst_rate between 0 and 100),
  taxable_value numeric(18,2) not null default 0 check (taxable_value > 0),
  cgst numeric(18,2) not null default 0,
  sgst numeric(18,2) not null default 0,
  igst numeric(18,2) not null default 0,
  tax_amount numeric(18,2) not null default 0,
  line_total numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (bill_id,line_no)
);

create table if not exists public.vendor_bill_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.vendor_bills(id) on delete restrict,
  payment_no text not null unique,
  paid_at date not null,
  amount numeric(18,2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  exchange_rate_to_inr numeric(18,8) not null check (exchange_rate_to_inr > 0),
  amount_inr numeric(18,2) not null check (amount_inr > 0),
  fx_rate_date date,
  fx_rate_source text not null default '',
  payment_method text not null default 'bank_transfer' check (payment_method in ('bank_transfer','upi','cash','cheque','card','other')),
  bank_reference text not null default '',
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists vendor_bills_vendor_invoice_ref_idx
  on public.vendor_bills(vendor_id,lower(supplier_invoice_no)) where status in ('draft','posted');
create index if not exists vendor_bills_vendor_due_idx on public.vendor_bills(vendor_id,due_date desc);
create index if not exists vendor_bills_status_due_idx on public.vendor_bills(status,due_date);
create index if not exists vendor_bills_job_idx on public.vendor_bills(job_id) where job_id is not null;
create index if not exists vendor_bill_lines_bill_idx on public.vendor_bill_lines(bill_id,line_no);
create index if not exists vendor_bill_payments_bill_date_idx on public.vendor_bill_payments(bill_id,paid_at desc);
create index if not exists vendor_accounts_created_by_idx on public.vendor_accounts(created_by) where created_by is not null;

alter table public.vendor_accounts enable row level security;
alter table public.vendor_bills enable row level security;
alter table public.vendor_bill_lines enable row level security;
alter table public.vendor_bill_payments enable row level security;
revoke all on public.vendor_accounts,public.vendor_bills,public.vendor_bill_lines,public.vendor_bill_payments from anon,authenticated;
grant all on public.vendor_accounts,public.vendor_bills,public.vendor_bill_lines,public.vendor_bill_payments to service_role;

create or replace function public.save_vendor_bill_draft(
  p_bill_id uuid,p_vendor_id uuid,p_job_id uuid,p_supplier_invoice_no text,p_bill_date date,p_due_date date,
  p_currency text,p_exchange_rate_to_inr numeric,p_fx_rate_date date,p_fx_rate_source text,p_tax_mode text,
  p_supply_type text,p_notes text,p_lines jsonb,p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill public.vendor_bills%rowtype;
  v_vendor public.vendor_accounts%rowtype;
  v_line jsonb;
  v_count integer := 0;
  v_qty numeric;
  v_price numeric;
  v_rate numeric;
  v_raw numeric;
  v_base numeric;
  v_tax numeric;
  v_cgst numeric;
  v_sgst numeric;
  v_igst numeric;
  v_total numeric;
  v_subtotal_sum numeric := 0;
  v_cgst_sum numeric := 0;
  v_sgst_sum numeric := 0;
  v_igst_sum numeric := 0;
  v_tax_sum numeric := 0;
  v_total_sum numeric := 0;
begin
  if not exists(select 1 from public.vendor_accounts where id=p_vendor_id and is_active=true) then raise exception 'Select an active vendor account.'; end if;
  if p_supplier_invoice_no is null or length(trim(p_supplier_invoice_no))=0 then raise exception 'Supplier invoice number is required.'; end if;
  if p_bill_date is null or p_due_date is null or p_due_date < p_bill_date then raise exception 'Enter a due date on or after the bill date.'; end if;
  if p_currency !~ '^[A-Z]{3}$' then raise exception 'Enter a valid three-letter currency code.'; end if;
  if p_exchange_rate_to_inr is null or p_exchange_rate_to_inr <= 0 then raise exception 'Exchange rate must be greater than zero.'; end if;
  if p_tax_mode not in ('exclusive','inclusive') then raise exception 'Invalid tax calculation mode.'; end if;
  if p_supply_type not in ('intra_state','inter_state','not_applicable') then raise exception 'Invalid GST supply type.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>50 then raise exception 'A supplier bill needs between 1 and 50 charge lines.'; end if;
  if p_job_id is not null and not exists(select 1 from public.forwarding_jobs where id=p_job_id and deleted_at is null) then raise exception 'Forwarding job not found.'; end if;
  select * into v_vendor from public.vendor_accounts where id=p_vendor_id;

  if p_bill_id is not null then
    select * into v_bill from public.vendor_bills where id=p_bill_id for update;
    if not found then raise exception 'Supplier bill not found.'; end if;
    if v_bill.status <> 'draft' then raise exception 'Only draft supplier bills can be edited.'; end if;
  else
    insert into public.vendor_bills(vendor_id,job_id,supplier_invoice_no,bill_date,due_date,currency,exchange_rate_to_inr,fx_rate_date,fx_rate_source,tax_mode,supply_type,notes,created_by,updated_by)
    values(p_vendor_id,p_job_id,trim(p_supplier_invoice_no),p_bill_date,p_due_date,p_currency,p_exchange_rate_to_inr,p_fx_rate_date,coalesce(p_fx_rate_source,''),p_tax_mode,p_supply_type,coalesce(p_notes,''),p_actor,p_actor)
    returning * into v_bill;
  end if;

  if exists(select 1 from public.vendor_bills b where b.id<>coalesce(p_bill_id,v_bill.id) and b.vendor_id=p_vendor_id and lower(b.supplier_invoice_no)=lower(trim(p_supplier_invoice_no)) and b.status in ('draft','posted')) then raise exception 'A draft or posted bill already uses this vendor invoice number.'; end if;
  delete from public.vendor_bill_lines where bill_id=v_bill.id;
  for v_line in select value from jsonb_array_elements(p_lines) as lines(value) loop
    v_count:=v_count+1;
    v_qty:=(v_line->>'quantity')::numeric;
    v_price:=(v_line->>'unit_price')::numeric;
    v_rate:=coalesce((v_line->>'gst_rate')::numeric,0);
    if v_qty<=0 or v_price<=0 or v_rate<0 or v_rate>100 then raise exception 'Supplier bill line quantity, rate or GST is invalid.'; end if;
    v_raw:=v_qty*v_price;
    if p_tax_mode='inclusive' and p_supply_type<>'not_applicable' then
      v_base:=round(v_raw/(1+v_rate/100),2);
      v_total:=round(v_raw,2);
      v_tax:=v_total-v_base;
    else
      v_base:=round(v_raw,2);
      v_tax:=case when p_supply_type='not_applicable' then 0 else round(v_base*v_rate/100,2) end;
      v_total:=v_base+v_tax;
    end if;
    if v_base<=0 then raise exception 'Supplier bill charge values must be at least 0.01.'; end if;
    v_cgst:=0;v_sgst:=0;v_igst:=0;
    if p_supply_type='intra_state' then v_cgst:=round(v_tax/2,2);v_sgst:=v_tax-v_cgst;elsif p_supply_type='inter_state' then v_igst:=v_tax;end if;
    insert into public.vendor_bill_lines(bill_id,line_no,charge_code,description,hsn_sac,quantity,unit,unit_price,gst_rate,taxable_value,cgst,sgst,igst,tax_amount,line_total)
    values(v_bill.id,v_count,coalesce(nullif(left(trim(v_line->>'charge_code'),40),''),'OTHER'),left(trim(v_line->>'description'),240),
      left(coalesce(v_line->>'hsn_sac',''),30),v_qty,coalesce(nullif(left(trim(v_line->>'unit'),40),''),'service'),v_price,
      case when p_supply_type='not_applicable' then 0 else v_rate end,v_base,v_cgst,v_sgst,v_igst,v_tax,v_total);
    v_subtotal_sum:=v_subtotal_sum+v_base;v_cgst_sum:=v_cgst_sum+v_cgst;v_sgst_sum:=v_sgst_sum+v_sgst;
    v_igst_sum:=v_igst_sum+v_igst;v_tax_sum:=v_tax_sum+v_tax;v_total_sum:=v_total_sum+v_total;
  end loop;
  update public.vendor_bills set vendor_id=p_vendor_id,job_id=p_job_id,supplier_invoice_no=trim(p_supplier_invoice_no),
    bill_date=p_bill_date,due_date=p_due_date,currency=p_currency,exchange_rate_to_inr=p_exchange_rate_to_inr,
    fx_rate_date=p_fx_rate_date,fx_rate_source=coalesce(p_fx_rate_source,''),tax_mode=p_tax_mode,supply_type=p_supply_type,
    subtotal=round(v_subtotal_sum,2),cgst_total=round(v_cgst_sum,2),sgst_total=round(v_sgst_sum,2),igst_total=round(v_igst_sum,2),
    total_tax=round(v_tax_sum,2),total_amount=round(v_total_sum,2),total_inr=round(v_total_sum*p_exchange_rate_to_inr,2),
    notes=coalesce(p_notes,''),updated_by=p_actor,updated_at=now()
    where id=v_bill.id returning * into v_bill;
  return to_jsonb(v_bill);
end;
$$;

create or replace function public.post_vendor_bill(p_bill_id uuid,p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill public.vendor_bills%rowtype;
  v_vendor public.vendor_accounts%rowtype;
  v_count integer;
  v_year integer:=extract(year from now())::integer;
  v_number bigint;
begin
  select * into v_bill from public.vendor_bills where id=p_bill_id for update;
  if not found then raise exception 'Supplier bill not found.'; end if;
  if v_bill.status<>'draft' then raise exception 'Only draft supplier bills can be posted.'; end if;
  select count(*) into v_count from public.vendor_bill_lines where bill_id=p_bill_id;
  if v_count=0 then raise exception 'Add at least one charge line before posting.'; end if;
  select * into v_vendor from public.vendor_accounts where id=v_bill.vendor_id;
  insert into public.document_number_counters(document_type,counter_year,last_number) values('AP',v_year,1)
    on conflict(document_type,counter_year) do update set last_number=public.document_number_counters.last_number+1 returning last_number into v_number;
  update public.vendor_bills set ap_number='AP-'||v_year::text||'-'||lpad(v_number::text,5,'0'),status='posted',
    posted_at=now(),posted_by=p_actor,updated_by=p_actor,updated_at=now() where id=p_bill_id returning * into v_bill;
  if v_bill.job_id is not null then
    insert into public.shipment_charges(job_id,direction,charge_code,description,counterparty,amount,currency,exchange_rate_to_inr,amount_inr,
      invoice_reference,invoice_date,due_date,approval_status,notes,created_by,updated_by)
    select v_bill.job_id,'cost',l.charge_code,l.description,v_vendor.legal_name,l.taxable_value,v_bill.currency,v_bill.exchange_rate_to_inr,
      round(l.taxable_value*v_bill.exchange_rate_to_inr,2),v_bill.supplier_invoice_no,v_bill.bill_date,v_bill.due_date,'draft',
      'Supplier payable posted as AP record '||v_bill.ap_number,p_actor,p_actor
    from public.vendor_bill_lines l where l.bill_id=p_bill_id;
  end if;
  return to_jsonb(v_bill);
end;
$$;

create or replace function public.record_vendor_bill_payment(
  p_bill_id uuid,p_paid_at date,p_amount numeric,p_currency text,p_exchange_rate_to_inr numeric,
  p_fx_rate_date date,p_fx_rate_source text,p_payment_method text,p_bank_reference text,p_notes text,p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill public.vendor_bills%rowtype;
  v_paid numeric(18,2);
  v_payment public.vendor_bill_payments%rowtype;
  v_year integer:=extract(year from coalesce(p_paid_at,current_date))::integer;
  v_number bigint;
begin
  select * into v_bill from public.vendor_bills where id=p_bill_id for update;
  if not found then raise exception 'Supplier bill not found.'; end if;
  if v_bill.status<>'posted' then raise exception 'Post the supplier bill before recording payment.'; end if;
  if p_paid_at is null or p_amount is null or p_amount<=0 then raise exception 'Enter a payment date and positive payment amount.'; end if;
  if p_currency<>v_bill.currency then raise exception 'Payment currency must match the supplier bill currency.'; end if;
  if p_exchange_rate_to_inr is null or p_exchange_rate_to_inr<=0 then raise exception 'Exchange rate must be greater than zero.'; end if;
  if p_payment_method not in ('bank_transfer','upi','cash','cheque','card','other') then raise exception 'Select a valid payment method.'; end if;
  select coalesce(sum(amount),0) into v_paid from public.vendor_bill_payments where bill_id=p_bill_id;
  if p_amount>v_bill.total_amount-v_paid+0.005 then raise exception 'Payment is greater than the open supplier balance.'; end if;
  insert into public.document_number_counters(document_type,counter_year,last_number) values('APPAY',v_year,1)
    on conflict(document_type,counter_year) do update set last_number=public.document_number_counters.last_number+1 returning last_number into v_number;
  insert into public.vendor_bill_payments(bill_id,payment_no,paid_at,amount,currency,exchange_rate_to_inr,amount_inr,fx_rate_date,fx_rate_source,payment_method,bank_reference,notes,created_by)
  values(p_bill_id,'PAY-'||v_year::text||'-'||lpad(v_number::text,5,'0'),p_paid_at,p_amount,p_currency,p_exchange_rate_to_inr,
    round(p_amount*p_exchange_rate_to_inr,2),p_fx_rate_date,coalesce(p_fx_rate_source,''),p_payment_method,left(coalesce(p_bank_reference,''),120),left(coalesce(p_notes,''),1000),p_actor)
  returning * into v_payment;
  return to_jsonb(v_payment);
end;
$$;

revoke all on function public.save_vendor_bill_draft(uuid,uuid,uuid,text,date,date,text,numeric,date,text,text,text,text,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.post_vendor_bill(uuid,uuid) from public,anon,authenticated;
revoke all on function public.record_vendor_bill_payment(uuid,date,numeric,text,numeric,date,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.save_vendor_bill_draft(uuid,uuid,uuid,text,date,date,text,numeric,date,text,text,text,text,jsonb,uuid) to service_role;
grant execute on function public.post_vendor_bill(uuid,uuid) to service_role;
grant execute on function public.record_vendor_bill_payment(uuid,date,numeric,text,numeric,date,text,text,text,text,uuid) to service_role;
