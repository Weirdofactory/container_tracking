create or replace function public.save_freight_quote_draft(
  p_quote_id uuid,p_enquiry_id uuid,p_customer_id uuid,p_currency text,p_exchange_rate_to_inr numeric,
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
begin
  if p_currency !~ '^[A-Z]{3}$' then raise exception 'Enter a valid three-letter currency code.'; end if;
  if p_exchange_rate_to_inr is null or p_exchange_rate_to_inr <= 0 then raise exception 'Exchange rate must be greater than zero.'; end if;
  if p_tax_mode not in ('exclusive','inclusive') then raise exception 'Invalid GST calculation mode.'; end if;
  if p_valid_until is null or p_valid_until < current_date then raise exception 'Set a valid future quote expiry date.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>50 then
    raise exception 'A quote needs between 1 and 50 charge lines.';
  end if;
  if not exists(select 1 from public.sales_enquiries where id=p_enquiry_id) then raise exception 'Sales enquiry not found.'; end if;
  v_customer_id := p_customer_id;
  if v_customer_id is not null and not exists(select 1 from public.customer_accounts where id=v_customer_id and is_active=true) then
    raise exception 'Select an active customer account.';
  end if;

  if p_quote_id is not null then
    select * into v_quote from public.freight_quotes where id=p_quote_id for update;
    if not found then raise exception 'Quote not found.'; end if;
    if v_quote.status <> 'draft' then raise exception 'Only draft quotes can be edited.'; end if;
    if v_quote.enquiry_id <> p_enquiry_id then raise exception 'A quote cannot be moved to another enquiry.'; end if;
  else
    insert into public.freight_quotes(enquiry_id,customer_id,currency,exchange_rate_to_inr,fx_rate_date,fx_rate_source,tax_mode,valid_until,terms,created_by,updated_by)
      values(p_enquiry_id,v_customer_id,p_currency,p_exchange_rate_to_inr,p_fx_rate_date,coalesce(p_fx_rate_source,''),p_tax_mode,p_valid_until,coalesce(p_terms,''),p_actor,p_actor)
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

  update public.freight_quotes set customer_id=v_customer_id,currency=p_currency,exchange_rate_to_inr=p_exchange_rate_to_inr,
    fx_rate_date=p_fx_rate_date,fx_rate_source=coalesce(p_fx_rate_source,''),tax_mode=p_tax_mode,
    subtotal=round(v_subtotal_sum,2),tax_total=round(v_tax_sum,2),total_amount=round(v_total_sum,2),
    total_inr=round(v_total_sum*p_exchange_rate_to_inr,2),valid_until=p_valid_until,terms=coalesce(p_terms,''),
    updated_by=p_actor,updated_at=now()
    where id=v_quote.id returning * into v_quote;
  return to_jsonb(v_quote);
end;
$$;
revoke all on function public.save_freight_quote_draft(uuid,uuid,uuid,text,numeric,date,text,text,date,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_freight_quote_draft(uuid,uuid,uuid,text,numeric,date,text,text,date,text,jsonb,uuid) to service_role;
