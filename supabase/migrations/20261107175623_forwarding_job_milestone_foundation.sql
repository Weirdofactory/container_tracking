create table public.forwarding_jobs (
  id uuid primary key default gen_random_uuid(),
  job_no text not null,
  customer_reference text not null default '',
  service_type text not null default 'FCL' check (service_type in ('FCL','LCL','AIR','OTHER')),
  direction text not null default 'import' check (direction in ('import','export','cross_trade','transshipment')),
  status text not null default 'draft' check (status in ('draft','booked','origin_handling','departed','transshipment','arrived','customs','destination_handling','out_for_delivery','delivered','closed','on_hold','cancelled')),
  hbl_no text not null default '',
  mbl_no text not null default '',
  booking_no text not null default '',
  customer_name text not null default '',
  shipper text not null default '',
  consignee text not null default '',
  notify_party text not null default '',
  origin_agent text not null default '',
  destination_agent text not null default '',
  carrier text not null default '',
  vessel_name text not null default '',
  voyage_no text not null default '',
  pol text not null default '',
  transshipment_port text not null default '',
  pod text not null default '',
  final_delivery_place text not null default '',
  incoterm text not null default '',
  commodity text not null default '',
  package_count integer check (package_count is null or package_count > 0),
  package_type text not null default '',
  gross_weight_kg numeric(14,2) check (gross_weight_kg is null or gross_weight_kg >= 0),
  volume_cbm numeric(12,3) check (volume_cbm is null or volume_cbm >= 0),
  cargo_ready_date date,
  etd date,
  eta date,
  actual_departure_at timestamptz,
  actual_arrival_at timestamptz,
  delivered_at timestamptz,
  branch text not null default '',
  sales_owner text not null default '',
  operations_owner text not null default '',
  customer_visible boolean not null default false,
  notes text not null default '',
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(job_no)) > 0)
);
create unique index forwarding_jobs_job_no_uq on public.forwarding_jobs (upper(trim(job_no)));
create index forwarding_jobs_hbl_idx on public.forwarding_jobs (upper(trim(hbl_no))) where hbl_no <> '';
create index forwarding_jobs_mbl_idx on public.forwarding_jobs (upper(trim(mbl_no))) where mbl_no <> '';
create index forwarding_jobs_status_eta_idx on public.forwarding_jobs (status, eta);
create index forwarding_jobs_customer_idx on public.forwarding_jobs (lower(customer_name));

create table public.job_container_links (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.forwarding_jobs(id) on delete cascade,
  container_no text not null,
  allocation_role text not null default 'primary' check (allocation_role in ('primary','split','shared')),
  package_count integer check (package_count is null or package_count > 0),
  gross_weight_kg numeric(14,2) check (gross_weight_kg is null or gross_weight_kg >= 0),
  volume_cbm numeric(12,3) check (volume_cbm is null or volume_cbm >= 0),
  notes text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (job_id, container_no),
  check (length(trim(container_no)) > 0)
);
create index job_container_links_container_idx on public.job_container_links (upper(container_no));
create index job_container_links_created_by_idx on public.job_container_links (created_by);

create table public.shipment_milestones (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.forwarding_jobs(id) on delete cascade,
  container_no text not null default '',
  milestone_code text not null check (milestone_code in ('booking_confirmed','cargo_received_origin','export_customs_cleared','gate_in_origin','vessel_departed','transshipment_arrived','transshipment_departed','vessel_arrived_destination','port_discharged','import_customs_cleared','port_released','cfs_received','destuffed','out_for_delivery','delivered_to_consignee','empty_returned','other')),
  milestone_name text not null default '',
  location text not null default '',
  planned_at timestamptz,
  actual_at timestamptz,
  status text not null default 'planned' check (status in ('planned','completed','skipped','delayed')),
  customer_visible boolean not null default false,
  source text not null default 'manual',
  notes text not null default '',
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'completed' or actual_at is not null)
);
create index shipment_milestones_job_timeline_idx on public.shipment_milestones (job_id, coalesce(actual_at, planned_at), created_at);
create index shipment_milestones_container_idx on public.shipment_milestones (upper(container_no), coalesce(actual_at, planned_at));
create index shipment_milestones_customer_visible_idx on public.shipment_milestones (job_id, customer_visible) where customer_visible = true;

alter table public.forwarding_jobs enable row level security;
alter table public.job_container_links enable row level security;
alter table public.shipment_milestones enable row level security;
revoke all on public.forwarding_jobs, public.job_container_links, public.shipment_milestones from anon, authenticated;
grant all on public.forwarding_jobs, public.job_container_links, public.shipment_milestones to service_role;
comment on table public.forwarding_jobs is 'Normalized forwarding job master. Access is restricted to authenticated staff through trusted Edge Functions.';
comment on table public.job_container_links is 'Many-to-many allocation of forwarding jobs/HBLs to equipment containers. Supports shared LCL containers and split HBLs.';
comment on table public.shipment_milestones is 'Planned and actual shipment events, optionally scoped to an individual container within a job.';
