create table public.air_waybills (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.forwarding_jobs(id) on delete restrict,
  hawb_no text not null unique check (length(btrim(hawb_no)) between 4 and 40),
  mawb_no text not null default '' check (length(mawb_no)<=40),
  airline text not null default '' check (length(airline)<=120),
  flight_no text not null default '' check (length(flight_no)<=40),
  origin_airport text not null check (origin_airport ~ '^[A-Z]{3}$'),
  destination_airport text not null check (destination_airport ~ '^[A-Z]{3}$'),
  etd date,
  eta date,
  pieces integer not null default 1 check (pieces>0),
  package_type text not null default 'Packages' check (length(package_type)<=80),
  gross_weight_kg numeric(14,3) not null default 0 check (gross_weight_kg>=0),
  volume_cbm numeric(14,4) not null default 0 check (volume_cbm>=0),
  volumetric_divisor numeric(10,3) not null default 167 check (volumetric_divisor>0),
  chargeable_weight_kg numeric(14,3) not null default 0 check (chargeable_weight_kg>=gross_weight_kg),
  commodity text not null default '' check (length(commodity)<=240),
  goods_description text not null default '' check (length(goods_description)<=3000),
  shipper text not null default '' check (length(shipper)<=500),
  consignee text not null default '' check (length(consignee)<=500),
  notify_party text not null default '' check (length(notify_party)<=500),
  freight_terms text not null default 'prepaid' check (freight_terms in ('prepaid','collect')),
  status text not null default 'planned' check (status in ('planned','booked','cargo_received','departed','in_transit','arrived','customs','delivered','closed','exception','cancelled')),
  hawb_status text not null default 'draft' check (hawb_status in ('draft','issued')),
  hawb_snapshot jsonb check (hawb_snapshot is null or jsonb_typeof(hawb_snapshot)='object'),
  hawb_issued_at timestamptz,
  customer_visible boolean not null default false,
  notes text not null default '' check (length(notes)<=3000),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint air_waybills_hawb_issue_state check (
    (hawb_status='draft' and hawb_snapshot is null and hawb_issued_at is null)
    or (hawb_status='issued' and hawb_snapshot is not null and hawb_issued_at is not null)
  ),
  constraint air_waybills_dates_check check (etd is null or eta is null or eta>=etd)
);

create index air_waybills_job_status_idx on public.air_waybills(job_id,status);
create index air_waybills_eta_idx on public.air_waybills(eta) where eta is not null;

create table public.air_waybill_events (
  id uuid primary key default gen_random_uuid(),
  air_waybill_id uuid not null references public.air_waybills(id) on delete cascade,
  event_code text not null check (event_code in ('booking_confirmed','cargo_received','flight_departed','flight_arrived','customs_cleared','delivered','exception','other')),
  event_name text not null check (length(btrim(event_name)) between 2 and 120),
  location text not null default '' check (length(location)<=160),
  event_at timestamptz not null,
  notes text not null default '' check (length(notes)<=1000),
  customer_visible boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index air_waybill_events_timeline_idx on public.air_waybill_events(air_waybill_id,event_at desc);

alter table public.air_waybills enable row level security;
alter table public.air_waybill_events enable row level security;
revoke all on public.air_waybills,public.air_waybill_events from anon,authenticated;
grant all on public.air_waybills,public.air_waybill_events to service_role;
create policy air_waybills_deny_anon on public.air_waybills for all to anon using(false) with check(false);
create policy air_waybills_deny_authenticated on public.air_waybills for all to authenticated using(false) with check(false);
create policy air_waybill_events_deny_anon on public.air_waybill_events for all to anon using(false) with check(false);
create policy air_waybill_events_deny_authenticated on public.air_waybill_events for all to authenticated using(false) with check(false);

create or replace function public.issue_air_waybill(
  p_air_waybill_id uuid,
  p_snapshot jsonb,
  p_user_id uuid
) returns public.air_waybills
language plpgsql
security definer
set search_path=public
as $$
declare
  w public.air_waybills%rowtype;
begin
  select * into w from public.air_waybills where id=p_air_waybill_id for update;
  if not found then raise exception 'Air waybill not found.'; end if;
  if w.hawb_status <> 'draft' then raise exception 'Issued HAWBs are locked.'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' then raise exception 'A HAWB snapshot is required.'; end if;
  update public.air_waybills
    set hawb_status='issued',hawb_snapshot=p_snapshot,hawb_issued_at=now(),updated_by=p_user_id,updated_at=now()
    where id=w.id returning * into w;
  return w;
end;
$$;
revoke all on function public.issue_air_waybill(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.issue_air_waybill(uuid,jsonb,uuid) to service_role;