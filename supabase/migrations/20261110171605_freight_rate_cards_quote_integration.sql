create table if not exists public.freight_rate_cards (
  id uuid primary key default gen_random_uuid(),
  rate_code text not null unique,
  title text not null,
  customer_id uuid references public.customer_accounts(id) on delete set null,
  service_type text not null check (service_type in ('FCL','LCL','AIR','OTHER')),
  direction text not null check (direction in ('import','export','cross_trade','transshipment')),
  origin text not null,
  destination text not null,
  carrier text not null default '',
  valid_from date not null default current_date,
  valid_to date check (valid_to is null or valid_to>=valid_from),
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'draft' check (status in ('draft','published','retired')),
  notes text not null default '',
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.freight_rate_lines (
  id uuid primary key default gen_random_uuid(),
  rate_card_id uuid not null references public.freight_rate_cards(id) on delete cascade,
  line_no integer not null check (line_no>0),
  charge_code text not null default 'FREIGHT',
  description text not null,
  unit text not null default 'shipment',
  unit_rate numeric(18,4) not null check (unit_rate>0),
  gst_rate numeric(6,3) not null default 0 check (gst_rate between 0 and 100),
  created_at timestamptz not null default now(),
  unique(rate_card_id,line_no)
);
alter table public.freight_quotes add column if not exists rate_card_id uuid references public.freight_rate_cards(id) on delete set null;
create index if not exists freight_rate_cards_search_idx on public.freight_rate_cards(status,service_type,direction,origin,destination,valid_from,valid_to);
create index if not exists freight_rate_cards_customer_idx on public.freight_rate_cards(customer_id) where customer_id is not null;
create index if not exists freight_rate_lines_card_idx on public.freight_rate_lines(rate_card_id,line_no);
create index if not exists freight_quotes_rate_card_idx on public.freight_quotes(rate_card_id) where rate_card_id is not null;
alter table public.freight_rate_cards enable row level security;
alter table public.freight_rate_lines enable row level security;
revoke all on public.freight_rate_cards,public.freight_rate_lines from anon,authenticated;
grant all on public.freight_rate_cards,public.freight_rate_lines to service_role;

create or replace function public.save_freight_rate_card_draft(
 p_card_id uuid,p_rate_code text,p_title text,p_customer_id uuid,p_service_type text,p_direction text,
 p_origin text,p_destination text,p_carrier text,p_valid_from date,p_valid_to date,p_currency text,p_notes text,p_lines jsonb,p_actor uuid
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_card public.freight_rate_cards%rowtype;
 v_line jsonb;
 v_count integer:=0;
 v_rate numeric;
begin
 if nullif(trim(p_title),'') is null then raise exception 'Rate card title is required.'; end if;
 if p_origin is null or trim(p_origin)='' or p_destination is null or trim(p_destination)='' then raise exception 'Origin and destination are required.'; end if;
 if p_service_type not in ('FCL','LCL','AIR','OTHER') or p_direction not in ('import','export','cross_trade','transshipment') then raise exception 'Invalid rate card service or direction.'; end if;
 if p_currency !~ '^[A-Z]{3}$' then raise exception 'Enter a valid three-letter currency code.'; end if;
 if p_valid_from is null or (p_valid_to is not null and p_valid_to<p_valid_from) then raise exception 'Rate card validity dates are invalid.'; end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>50 then raise exception 'A rate card needs between 1 and 50 charge lines.'; end if;
 if p_customer_id is not null and not exists(select 1 from public.customer_accounts where id=p_customer_id and is_active=true) then raise exception 'Select an active customer account or leave this rate card general.'; end if;
 if p_card_id is not null then
   select * into v_card from public.freight_rate_cards where id=p_card_id for update;
   if not found then raise exception 'Rate card not found.'; end if;
   if v_card.status<>'draft' then raise exception 'Published and retired rate cards cannot be edited. Create a new draft.'; end if;
 else
   insert into public.freight_rate_cards(rate_code,title,customer_id,service_type,direction,origin,destination,carrier,valid_from,valid_to,currency,notes,created_by,updated_by)
   values(left(trim(p_rate_code),50),left(trim(p_title),180),p_customer_id,p_service_type,p_direction,left(trim(p_origin),160),left(trim(p_destination),160),left(coalesce(p_carrier,''),160),p_valid_from,p_valid_to,p_currency,left(coalesce(p_notes,''),3000),p_actor,p_actor)
   returning * into v_card;
 end if;
 delete from public.freight_rate_lines where rate_card_id=v_card.id;
 for v_line in select value from jsonb_array_elements(p_lines) as lines(value) loop
   v_count:=v_count+1;v_rate:=(v_line->>'unit_rate')::numeric;
   if v_rate<=0 or coalesce((v_line->>'gst_rate')::numeric,0)<0 or coalesce((v_line->>'gst_rate')::numeric,0)>100 then raise exception 'Rate and GST values are invalid.'; end if;
   if nullif(trim(v_line->>'description'),'') is null then raise exception 'Every rate line needs a description.'; end if;
   insert into public.freight_rate_lines(rate_card_id,line_no,charge_code,description,unit,unit_rate,gst_rate)
   values(v_card.id,v_count,coalesce(nullif(left(trim(v_line->>'charge_code'),40),''),'FREIGHT'),left(trim(v_line->>'description'),240),
    coalesce(nullif(left(trim(v_line->>'unit'),40),''),'shipment'),v_rate,coalesce((v_line->>'gst_rate')::numeric,0));
 end loop;
 update public.freight_rate_cards set rate_code=left(trim(p_rate_code),50),title=left(trim(p_title),180),customer_id=p_customer_id,
  service_type=p_service_type,direction=p_direction,origin=left(trim(p_origin),160),destination=left(trim(p_destination),160),
  carrier=left(coalesce(p_carrier,''),160),valid_from=p_valid_from,valid_to=p_valid_to,currency=p_currency,notes=left(coalesce(p_notes,''),3000),
  updated_by=p_actor,updated_at=now() where id=v_card.id returning * into v_card;
 return to_jsonb(v_card);
end;
$$;

create or replace function public.publish_freight_rate_card(p_card_id uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_card public.freight_rate_cards%rowtype;
 v_count integer;
begin
 select * into v_card from public.freight_rate_cards where id=p_card_id for update;
 if not found then raise exception 'Rate card not found.'; end if;
 if v_card.status<>'draft' then raise exception 'Only a draft rate card can be published.'; end if;
 if v_card.valid_to is not null and v_card.valid_to<current_date then raise exception 'This rate card has already expired.'; end if;
 select count(*) into v_count from public.freight_rate_lines where rate_card_id=p_card_id;
 if v_count=0 then raise exception 'Add at least one freight rate before publishing.'; end if;
 update public.freight_rate_cards set status='published',published_at=now(),updated_by=p_actor,updated_at=now() where id=p_card_id returning * into v_card;
 return to_jsonb(v_card);
end;
$$;

create or replace function public.retire_freight_rate_card(p_card_id uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_card public.freight_rate_cards%rowtype;
begin
 select * into v_card from public.freight_rate_cards where id=p_card_id for update;
 if not found then raise exception 'Rate card not found.'; end if;
 if v_card.status<>'published' then raise exception 'Only a published rate card can be retired.'; end if;
 update public.freight_rate_cards set status='retired',updated_by=p_actor,updated_at=now() where id=p_card_id returning * into v_card;
 return to_jsonb(v_card);
end;
$$;

create or replace function public.save_freight_quote_draft(
  p_quote_id uuid,p_enquiry_id uuid,p_rate_card_id uuid,p_customer_id uuid,p_currency text,p_exchange_rate_to_inr numeric,
  p_fx_rate_date date,p_fx_rate_source text,p_tax_mode text,p_valid_until date,p_terms text,p_lines jsonb,p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.freight_quotes%rowtype;
  v_line jsonb;
  v_count integer := 0;
  v_qty numeric;
  v_price numeric;
  v_rate numeric;
  v_raw numeric;
  v_base numeric;
  v_tax numeric;
  v_total numeric;
  v_subtotal_sum numeric := 0;
  v_tax_sum numeric := 0;
  v_total_sum numeric := 0;
  v_customer_id uuid;
  v_rate_card public.freight_rate_cards%rowtype;
  v_enquiry public.sales_enquiries%rowtype;
begin
  if p_currency !~ '^[A-Z]{3}$' then raise exception 'Enter a valid three-letter currency code.'; end if;
  if p_exchange_rate_to_inr is null or p_exchange_rate_to_inr <= 0 then raise exception 'Exchange rate must be greater than zero.'; end if;
  if p_tax_mode not in ('exclusive','inclusive') then raise exception 'Invalid GST calculation mode.'; end if;
  if p_valid_until is null or p_valid_until < current_date then raise exception 'Set a valid future quote expiry date.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>50 then
    raise exception 'A quote needs between 1 and 50 charge lines.';
  end if;
  select * into v_enquiry from public.sales_enquiries where id=p_enquiry_id;
  if not found then raise exception 'Sales enquiry not found.'; end if;
  v_customer_id := p_customer_id;
  if p_rate_card_id is not null then
    select * into v_rate_card from public.freight_rate_cards where id=p_rate_card_id and status='published' for share;
    if not found then raise exception 'The selected rate card is not published.'; end if;
    if v_rate_card.valid_from>current_date or (v_rate_card.valid_to is not null and v_rate_card.valid_to<current_date) then raise exception 'The selected rate card is outside its validity dates.'; end if;
    if v_rate_card.service_type<>v_enquiry.service_type or v_rate_card.direction<>v_enquiry.direction
      or lower(trim(v_rate_card.origin))<>lower(trim(v_enquiry.origin)) or lower(trim(v_rate_card.destination))<>lower(trim(v_enquiry.destination)) then
      raise exception 'The selected rate card does not match this enquiry service and lane.';
    end if;
    if v_rate_card.customer_id is not null and v_rate_card.customer_id<>coalesce(v_customer_id,v_enquiry.customer_id) then raise exception 'The selected rate card belongs to another customer.'; end if;
    if v_rate_card.currency<>p_currency then raise exception 'Quote currency must match the selected rate card.'; end if;
    if v_rate_card.valid_to is not null and p_valid_until>v_rate_card.valid_to then raise exception 'Quote validity cannot extend beyond the rate card validity.'; end if;
  end if;
  if v_customer_id is not null and not exists(select 1 from public.customer_accounts where id=v_customer_id and is_active=true) then
    raise exception 'Select an active customer account.';
  end if;

  if p_quote_id is not null then
    select * into v_quote from public.freight_quotes where id=p_quote_id for update;
    if not found then raise exception 'Quote not found.'; end if;
    if v_quote.status <> 'draft' then raise exception 'Only draft quotes can be edited.'; end if;
    if v_quote.enquiry_id <> p_enquiry_id then raise exception 'A quote cannot be moved to another enquiry.'; end if;
  else
    insert into public.freight_quotes(enquiry_id,rate_card_id,customer_id,currency,exchange_rate_to_inr,fx_rate_date,fx_rate_source,tax_mode,valid_until,terms,created_by,updated_by)
      values(p_enquiry_id,p_rate_card_id,v_customer_id,p_currency,p_exchange_rate_to_inr,p_fx_rate_date,coalesce(p_fx_rate_source,''),p_tax_mode,p_valid_until,coalesce(p_terms,''),p_actor,p_actor)
      returning * into v_quote;
  end if;

  delete from public.freight_quote_lines where quote_id=v_quote.id;
  for v_line in select value from jsonb_array_elements(p_lines) as lines(value) loop
    v_count := v_count + 1;
    v_qty := (v_line->>'quantity')::numeric;
    v_price := (v_line->>'unit_price')::numeric;
    v_rate := coalesce((v_line->>'gst_rate')::numeric,0);
    if v_qty <= 0 or v_price <= 0 or v_rate < 0 or v_rate > 100 then raise exception 'Quote line quantity, rate, or GST is invalid.'; end if;
    v_raw := v_qty * v_price;
    if p_tax_mode='inclusive' then
      v_base := round(v_raw/(1+v_rate/100),2);
      v_total := round(v_raw,2);
      v_tax := v_total-v_base;
    else
      v_base := round(v_raw,2);
      v_tax := round(v_base*v_rate/100,2);
      v_total := v_base+v_tax;
    end if;
    insert into public.freight_quote_lines(quote_id,line_no,charge_code,description,quantity,unit,unit_price,gst_rate,line_subtotal,tax_amount,total_amount)
    values(v_quote.id,v_count,coalesce(nullif(left(trim(v_line->>'charge_code'),40),''),'FREIGHT'),
      left(trim(v_line->>'description'),240),v_qty,coalesce(nullif(left(trim(v_line->>'unit'),40),''),'shipment'),
      v_price,v_rate,v_base,v_tax,v_total);
    v_subtotal_sum := v_subtotal_sum + v_base;
    v_tax_sum := v_tax_sum + v_tax;
    v_total_sum := v_total_sum + v_total;
  end loop;

  update public.freight_quotes set rate_card_id=p_rate_card_id,customer_id=v_customer_id,currency=p_currency,exchange_rate_to_inr=p_exchange_rate_to_inr,
    fx_rate_date=p_fx_rate_date,fx_rate_source=coalesce(p_fx_rate_source,''),tax_mode=p_tax_mode,
    subtotal=round(v_subtotal_sum,2),tax_total=round(v_tax_sum,2),total_amount=round(v_total_sum,2),
    total_inr=round(v_total_sum*p_exchange_rate_to_inr,2),valid_until=p_valid_until,terms=coalesce(p_terms,''),
    updated_by=p_actor,updated_at=now()
    where id=v_quote.id returning * into v_quote;
  return to_jsonb(v_quote);
end;
$$;
revoke all on function public.save_freight_quote_draft(uuid,uuid,uuid,uuid,text,numeric,date,text,text,date,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_freight_quote_draft(uuid,uuid,uuid,uuid,text,numeric,date,text,text,date,text,jsonb,uuid) to service_role;
revoke all on function public.save_freight_rate_card_draft(uuid,text,text,uuid,text,text,text,text,text,date,date,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_freight_rate_card_draft(uuid,text,text,uuid,text,text,text,text,text,date,date,text,text,jsonb,uuid) to service_role;
revoke all on function public.publish_freight_rate_card(uuid,uuid) from public,anon,authenticated;
grant execute on function public.publish_freight_rate_card(uuid,uuid) to service_role;
revoke all on function public.retire_freight_rate_card(uuid,uuid) from public,anon,authenticated;
grant execute on function public.retire_freight_rate_card(uuid,uuid) to service_role;

drop policy if exists freight_rate_cards_staff_only on public.freight_rate_cards;
create policy freight_rate_cards_staff_only on public.freight_rate_cards for all to anon,authenticated using (false) with check (false);
drop policy if exists freight_rate_lines_staff_only on public.freight_rate_lines;
create policy freight_rate_lines_staff_only on public.freight_rate_lines for all to anon,authenticated using (false) with check (false);
