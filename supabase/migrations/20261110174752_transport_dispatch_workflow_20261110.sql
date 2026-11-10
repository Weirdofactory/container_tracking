create sequence if not exists public.transport_dispatch_number_seq;
grant usage, select on sequence public.transport_dispatch_number_seq to service_role;

create table if not exists public.transport_dispatches (
  id uuid primary key default gen_random_uuid(),
  dispatch_no text not null unique default ('TRN-' || to_char(current_date,'YYYYMM') || '-' || lpad(nextval('public.transport_dispatch_number_seq')::text,6,'0')),
  job_id uuid not null references public.forwarding_jobs(id) on delete restrict,
  container_no text,
  movement_type text not null default 'delivery' check (movement_type in ('pickup','delivery','haulage','empty_return','customs_transfer','other')),
  status text not null default 'planned' check (status in ('planned','assigned','in_transit','completed','exception','cancelled')),
  pickup_location text,
  delivery_location text,
  planned_pickup_date date,
  actual_pickup_date date,
  planned_delivery_date date,
  actual_delivery_date date,
  carrier_name text,
  vehicle_no text,
  driver_name text,
  driver_phone text,
  pod_reference text,
  instructions text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (actual_delivery_date is null or actual_pickup_date is null or actual_delivery_date >= actual_pickup_date)
);

create index if not exists transport_dispatches_job_idx on public.transport_dispatches(job_id, created_at desc);
create index if not exists transport_dispatches_container_idx on public.transport_dispatches(container_no);
create index if not exists transport_dispatches_status_delivery_idx on public.transport_dispatches(status, planned_delivery_date);

alter table public.transport_dispatches enable row level security;
revoke all on public.transport_dispatches from anon, authenticated;
grant all on public.transport_dispatches to service_role;
create policy transport_dispatches_staff_only on public.transport_dispatches
  for all to anon,authenticated using(false) with check(false);
