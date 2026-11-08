create table if not exists public.deleted_shipment_charges (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null,
  row_data jsonb not null,
  deleted_by uuid null references auth.users(id),
  deleted_at timestamptz not null default now()
);
create index if not exists deleted_shipment_charges_charge_idx
  on public.deleted_shipment_charges (charge_id);
alter table public.deleted_shipment_charges enable row level security;
revoke all on table public.deleted_shipment_charges from anon, authenticated;
grant all on table public.deleted_shipment_charges to service_role;
