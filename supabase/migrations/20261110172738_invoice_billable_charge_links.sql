create table if not exists public.shipment_invoice_charge_links (
  invoice_id uuid not null references public.shipment_invoices(id) on delete cascade,
  charge_id uuid not null unique references public.shipment_charges(id) on delete restrict,
  linked_by uuid references auth.users(id) on delete set null,
  linked_at timestamptz not null default now(),
  primary key(invoice_id,charge_id)
);
create index if not exists shipment_invoice_charge_links_invoice_idx on public.shipment_invoice_charge_links(invoice_id);
alter table public.shipment_invoice_charge_links enable row level security;
revoke all on public.shipment_invoice_charge_links from anon,authenticated;
grant all on public.shipment_invoice_charge_links to service_role;
create policy shipment_invoice_charge_links_staff_only on public.shipment_invoice_charge_links
  for all to anon,authenticated using(false) with check(false);

create or replace function public.issue_shipment_invoice(p_invoice_id uuid,p_user_id uuid)
returns public.shipment_invoices
language plpgsql
security definer
set search_path to public
as $function$
declare
  invoice_row public.shipment_invoices%rowtype;
  charge_row public.shipment_charges%rowtype;
  source_charge_id uuid;
  start_year integer;
  fy text;
  next_number integer;
begin
  select * into invoice_row
  from public.shipment_invoices
  where id=p_invoice_id
  for update;

  if not found then raise exception 'Invoice not found.'; end if;
  if invoice_row.status<>'draft' then raise exception 'Only a draft invoice can be issued.'; end if;

  for source_charge_id in
    select distinct (line.value->>'source_charge_id')::uuid
    from jsonb_array_elements(coalesce(invoice_row.lines,'[]'::jsonb)) as line(value)
    where nullif(line.value->>'source_charge_id','') is not null
  loop
    select * into charge_row
    from public.shipment_charges
    where id=source_charge_id
    for update;

    if not found then raise exception 'A billable revenue charge was removed before invoice issue.'; end if;
    if charge_row.direction<>'revenue' or charge_row.approval_status<>'approved' then
      raise exception 'Only approved revenue charges can be invoiced.';
    end if;
    if invoice_row.job_id is null or charge_row.job_id is distinct from invoice_row.job_id then
      raise exception 'Invoice job must match every source revenue charge.';
    end if;
    if exists(select 1 from public.shipment_invoice_charge_links where charge_id=source_charge_id) then
      raise exception 'A selected revenue charge has already been invoiced.';
    end if;
    insert into public.shipment_invoice_charge_links(invoice_id,charge_id,linked_by)
    values(p_invoice_id,source_charge_id,p_user_id);
  end loop;

  start_year:=extract(year from invoice_row.invoice_date)::integer
    - case when extract(month from invoice_row.invoice_date)::integer<4 then 1 else 0 end;
  fy:=right(start_year::text,2)||'-'||right((start_year+1)::text,2);

  insert into public.shipment_invoice_sequences(financial_year,last_number)
  values(fy,1)
  on conflict(financial_year)
  do update set last_number=public.shipment_invoice_sequences.last_number+1
  returning last_number into next_number;

  if next_number>999999 then raise exception 'Invoice sequence limit reached for this financial year.'; end if;

  update public.shipment_invoices
  set invoice_number='INV/'||fy||'/'||lpad(next_number::text,6,'0'),
      status='issued',issued_at=now(),updated_by=p_user_id,updated_at=now()
  where id=p_invoice_id
  returning * into invoice_row;

  return invoice_row;
end;
$function$;
