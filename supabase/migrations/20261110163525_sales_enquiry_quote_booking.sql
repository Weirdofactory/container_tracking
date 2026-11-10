create table if not exists public.sales_enquiries (
  id uuid primary key default gen_random_uuid(),
  enquiry_no text not null unique,
  customer_id uuid references public.customer_accounts(id) on delete set null,
  company_name text not null default '',
  contact_name text not null default '',
  email text not null default '',
  phone text not null default '',
  service_type text not null default 'FCL' check (service_type in ('FCL','LCL','AIR','OTHER')),
  direction text not null default 'import' check (direction in ('import','export','cross_trade','transshipment')),
  origin text not null default '',
  destination text not null default '',
  commodity text not null default '',
  package_count integer check (package_count is null or package_count > 0),
  gross_weight_kg numeric(14,3) check (gross_weight_kg is null or gross_weight_kg >= 0),
  volume_cbm numeric(14,3) check (volume_cbm is null or volume_cbm >= 0),
  cargo_ready_date date,
  follow_up_date date,
  assigned_to uuid references auth.users(id) on delete set null,
  status text not null default 'new' check (status in ('new','quoted','won','lost','converted')),
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.freight_quotes (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.sales_enquiries(id) on delete restrict,
  customer_id uuid references public.customer_accounts(id) on delete set null,
  quote_no text unique,
  status text not null default 'draft' check (status in ('draft','sent','accepted','rejected','expired','converted')),
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  exchange_rate_to_inr numeric(18,8) not null default 1 check (exchange_rate_to_inr > 0),
  fx_rate_date date,
  fx_rate_source text not null default '',
  tax_mode text not null default 'exclusive' check (tax_mode in ('exclusive','inclusive')),
  subtotal numeric(18,2) not null default 0 check (subtotal >= 0),
  tax_total numeric(18,2) not null default 0 check (tax_total >= 0),
  total_amount numeric(18,2) not null default 0 check (total_amount >= 0),
  total_inr numeric(18,2) not null default 0 check (total_inr >= 0),
  valid_until date,
  terms text not null default '',
  issued_at timestamptz,
  issued_by uuid references auth.users(id) on delete set null,
  responded_at timestamptz,
  accepted_job_id uuid references public.forwarding_jobs(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.freight_quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.freight_quotes(id) on delete cascade,
  line_no integer not null check (line_no > 0),
  charge_code text not null default 'FREIGHT',
  description text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null default 'shipment',
  unit_price numeric(18,4) not null check (unit_price > 0),
  gst_rate numeric(6,3) not null default 0 check (gst_rate between 0 and 100),
  line_subtotal numeric(18,2) not null default 0,
  tax_amount numeric(18,2) not null default 0,
  total_amount numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (quote_id,line_no)
);

create table if not exists public.document_number_counters (
  document_type text not null,
  counter_year integer not null,
  last_number bigint not null default 0,
  primary key (document_type,counter_year)
);

create index if not exists sales_enquiries_customer_created_idx on public.sales_enquiries(customer_id,created_at desc);
create index if not exists sales_enquiries_status_followup_idx on public.sales_enquiries(status,follow_up_date);
create index if not exists freight_quotes_enquiry_created_idx on public.freight_quotes(enquiry_id,created_at desc);
create index if not exists freight_quotes_status_validity_idx on public.freight_quotes(status,valid_until);
create index if not exists freight_quote_lines_quote_idx on public.freight_quote_lines(quote_id,line_no);

alter table public.sales_enquiries enable row level security;
alter table public.freight_quotes enable row level security;
alter table public.freight_quote_lines enable row level security;
alter table public.document_number_counters enable row level security;
revoke all on public.sales_enquiries, public.freight_quotes, public.freight_quote_lines, public.document_number_counters from anon, authenticated;
grant all on public.sales_enquiries, public.freight_quotes, public.freight_quote_lines, public.document_number_counters to service_role;

create or replace function public.issue_freight_quote(p_quote_id uuid,p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.freight_quotes%rowtype;
  v_lines integer;
  v_subtotal numeric(18,2);
  v_tax numeric(18,2);
  v_total numeric(18,2);
  v_year integer := extract(year from now())::integer;
  v_number bigint;
begin
  select * into v_quote from public.freight_quotes where id=p_quote_id for update;
  if not found then raise exception 'Quote not found.'; end if;
  if v_quote.status <> 'draft' then raise exception 'Only draft quotes can be issued.'; end if;
  select count(*) into v_lines from public.freight_quote_lines where quote_id=p_quote_id;
  if v_lines=0 then raise exception 'Add at least one quote line before issue.'; end if;
  if v_quote.valid_until is null or v_quote.valid_until < current_date then raise exception 'Set a valid future quote expiry date.'; end if;
  update public.freight_quote_lines l set
    line_subtotal=round((l.quantity*l.unit_price) / case when v_quote.tax_mode='inclusive' then (1+l.gst_rate/100) else 1 end,2),
    tax_amount=round((l.quantity*l.unit_price) - ((l.quantity*l.unit_price) / case when v_quote.tax_mode='inclusive' then (1+l.gst_rate/100) else 1 end),2),
    total_amount=round(case when v_quote.tax_mode='inclusive' then (l.quantity*l.unit_price) else (l.quantity*l.unit_price)*(1+l.gst_rate/100) end,2)
    where l.quote_id=p_quote_id;
  select coalesce(sum(line_subtotal),0),coalesce(sum(tax_amount),0),coalesce(sum(total_amount),0)
    into v_subtotal,v_tax,v_total from public.freight_quote_lines where quote_id=p_quote_id;
  insert into public.document_number_counters(document_type,counter_year,last_number)
    values('FQ',v_year,1)
    on conflict(document_type,counter_year) do update set last_number=public.document_number_counters.last_number+1
    returning last_number into v_number;
  update public.freight_quotes set
    quote_no='FQ-'||v_year::text||'-'||lpad(v_number::text,5,'0'),
    status='sent',subtotal=v_subtotal,tax_total=v_tax,total_amount=v_total,
    total_inr=round(v_total*exchange_rate_to_inr,2),issued_at=now(),issued_by=p_actor,updated_by=p_actor,updated_at=now()
    where id=p_quote_id returning * into v_quote;
  update public.sales_enquiries set status='quoted',updated_by=p_actor,updated_at=now() where id=v_quote.enquiry_id and status='new';
  return to_jsonb(v_quote);
end;
$$;

create or replace function public.set_freight_quote_outcome(p_quote_id uuid,p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.freight_quotes%rowtype;
begin
  if p_outcome not in ('accepted','rejected') then raise exception 'Invalid quote outcome.'; end if;
  select * into v_quote from public.freight_quotes where id=p_quote_id for update;
  if not found then raise exception 'Quote not found.'; end if;
  if v_quote.status <> 'sent' then raise exception 'Only sent quotes can be accepted or declined.'; end if;
  if p_outcome='accepted' and v_quote.valid_until < current_date then raise exception 'This quote has expired.'; end if;
  update public.freight_quotes set status=p_outcome,responded_at=now(),updated_at=now() where id=p_quote_id returning * into v_quote;
  return to_jsonb(v_quote);
end;
$$;

create or replace function public.convert_accepted_quote_to_job(p_quote_id uuid,p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.freight_quotes%rowtype;
  v_enquiry public.sales_enquiries%rowtype;
  v_customer public.customer_accounts%rowtype;
  v_year integer := extract(year from now())::integer;
  v_number bigint;
  v_job public.forwarding_jobs%rowtype;
begin
  select * into v_quote from public.freight_quotes where id=p_quote_id for update;
  if not found then raise exception 'Quote not found.'; end if;
  if v_quote.status <> 'accepted' then raise exception 'Only an accepted quote can become a job.'; end if;
  select * into v_enquiry from public.sales_enquiries where id=v_quote.enquiry_id for update;
  if not found then raise exception 'The linked enquiry could not be found.'; end if;
  if coalesce(v_quote.customer_id,v_enquiry.customer_id) is null then raise exception 'Link an active customer account before converting this quote.'; end if;
  select * into v_customer from public.customer_accounts where id=coalesce(v_quote.customer_id,v_enquiry.customer_id) and is_active=true;
  if not found then raise exception 'The linked customer account is inactive or missing.'; end if;
  insert into public.document_number_counters(document_type,counter_year,last_number)
    values('JOB',v_year,1)
    on conflict(document_type,counter_year) do update set last_number=public.document_number_counters.last_number+1
    returning last_number into v_number;
  insert into public.forwarding_jobs(
    job_no,customer_reference,service_type,direction,status,customer_name,customer_id,
    pol,pod,commodity,package_count,gross_weight_kg,volume_cbm,cargo_ready_date,
    created_by,updated_by,created_at,updated_at
  ) values (
    'JOB-'||v_year::text||'-'||lpad(v_number::text,5,'0'),
    coalesce(v_quote.quote_no,v_enquiry.enquiry_no),v_enquiry.service_type,v_enquiry.direction,'booked',
    v_customer.legal_name,v_customer.id,v_enquiry.origin,v_enquiry.destination,v_enquiry.commodity,
    v_enquiry.package_count,v_enquiry.gross_weight_kg,v_enquiry.volume_cbm,v_enquiry.cargo_ready_date,
    p_actor,p_actor,now(),now()
  ) returning * into v_job;
  insert into public.shipment_charges(
    job_id,direction,charge_code,description,counterparty,amount,currency,exchange_rate_to_inr,amount_inr,
    invoice_reference,approval_status,notes,created_by,updated_by
  )
  select v_job.id,'revenue',l.charge_code,l.description,v_customer.legal_name,l.line_subtotal,
    v_quote.currency,v_quote.exchange_rate_to_inr,round(l.line_subtotal*v_quote.exchange_rate_to_inr,2),
    coalesce(v_quote.quote_no,v_enquiry.enquiry_no),'draft','Quote revenue pending review',p_actor,p_actor
  from public.freight_quote_lines l where l.quote_id=p_quote_id;
  update public.freight_quotes set status='converted',accepted_job_id=v_job.id,updated_by=p_actor,updated_at=now() where id=p_quote_id returning * into v_quote;
  update public.sales_enquiries set status='converted',updated_by=p_actor,updated_at=now() where id=v_enquiry.id;
  return jsonb_build_object('job',to_jsonb(v_job),'quote',to_jsonb(v_quote));
end;
$$;

revoke all on function public.issue_freight_quote(uuid,uuid) from public,anon,authenticated;
revoke all on function public.set_freight_quote_outcome(uuid,text) from public,anon,authenticated;
revoke all on function public.convert_accepted_quote_to_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.issue_freight_quote(uuid,uuid) to service_role;
grant execute on function public.set_freight_quote_outcome(uuid,text) to service_role;
grant execute on function public.convert_accepted_quote_to_job(uuid,uuid) to service_role;
