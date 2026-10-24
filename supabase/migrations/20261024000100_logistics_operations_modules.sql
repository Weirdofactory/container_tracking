
create table if not exists public.logistics_sailings (
  id uuid primary key default gen_random_uuid(),
  carrier text not null default '',
  vessel_name text not null,
  voyage_no text not null default '',
  pol text not null default '',
  pod text not null default '',
  etd date,
  eta date,
  si_cutoff date,
  vgm_cutoff date,
  cy_cutoff date,
  document_cutoff date,
  status text not null default 'planned' check (status in ('planned','booking_confirmed','in_transit','arrived','cancelled')),
  notes text not null default '',
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(vessel_name)) > 0)
);
create index if not exists logistics_sailings_etd_idx on public.logistics_sailings(etd);
create index if not exists logistics_sailings_vessel_idx on public.logistics_sailings(lower(vessel_name), lower(voyage_no));

create table if not exists public.sailing_schedule_shipments (
  id uuid primary key default gen_random_uuid(),
  sailing_id uuid not null references public.logistics_sailings(id) on delete cascade,
  container_no text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (sailing_id, container_no)
);
create index if not exists sailing_schedule_shipments_container_idx on public.sailing_schedule_shipments(upper(container_no));

create table if not exists public.lcl_consolidations (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  origin text not null default '',
  destination text not null default '',
  carrier text not null default '',
  vessel_name text not null default '',
  voyage_no text not null default '',
  container_type text not null default '',
  capacity_cbm numeric(12,3) check (capacity_cbm is null or capacity_cbm > 0),
  capacity_weight_kg numeric(14,2) check (capacity_weight_kg is null or capacity_weight_kg > 0),
  status text not null default 'open' check (status in ('planned','open','closed','cancelled')),
  etd date,
  eta date,
  notes text not null default '',
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (capacity_cbm is not null or capacity_weight_kg is not null)
);
create index if not exists lcl_consolidations_status_idx on public.lcl_consolidations(status);

create table if not exists public.lcl_consolidation_items (
  id uuid primary key default gen_random_uuid(),
  consolidation_id uuid not null references public.lcl_consolidations(id) on delete cascade,
  hbl_no text not null,
  shipper text not null default '',
  consignee text not null default '',
  package_count integer not null default 1 check (package_count > 0),
  package_type text not null default '',
  gross_weight_kg numeric(14,2) not null default 0 check (gross_weight_kg >= 0),
  volume_cbm numeric(12,3) not null default 0 check (volume_cbm >= 0),
  notes text not null default '',
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (gross_weight_kg > 0 or volume_cbm > 0)
);
create unique index if not exists lcl_consolidation_items_hbl_uq on public.lcl_consolidation_items(lower(hbl_no));
create index if not exists lcl_consolidation_items_group_idx on public.lcl_consolidation_items(consolidation_id);

create table if not exists public.shipment_charges (
  id uuid primary key default gen_random_uuid(),
  container_no text not null,
  direction text not null check (direction in ('cost','revenue')),
  charge_code text not null,
  description text not null default '',
  counterparty text not null default '',
  amount numeric(14,2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  exchange_rate_to_inr numeric(14,6) not null check (exchange_rate_to_inr > 0),
  amount_inr numeric(16,2) generated always as (round(amount * exchange_rate_to_inr, 2)) stored,
  invoice_reference text not null default '',
  invoice_date date,
  due_date date,
  approval_status text not null default 'draft' check (approval_status in ('draft','approved')),
  notes text not null default '',
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shipment_charges_container_idx on public.shipment_charges(upper(container_no));
create index if not exists shipment_charges_direction_idx on public.shipment_charges(direction, approval_status);

create table if not exists public.shipment_filings (
  id uuid primary key default gen_random_uuid(),
  container_no text not null,
  hbl_no text not null default '',
  mbl_no text not null default '',
  filing_type text not null check (filing_type in ('HBL','MBL','CSN','IGM','SI','VGM','OTHER')),
  filing_reference text not null default '',
  status text not null default 'draft' check (status in ('draft','ready','submitted','accepted','rejected','not_required')),
  due_date date,
  filed_at timestamptz,
  acknowledged_at timestamptz,
  notes text not null default '',
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shipment_filings_container_idx on public.shipment_filings(upper(container_no));
create index if not exists shipment_filings_due_idx on public.shipment_filings(due_date, status);

create table if not exists public.filing_documents (
  id uuid primary key default gen_random_uuid(),
  filing_id uuid not null references public.shipment_filings(id) on delete cascade,
  container_no text not null,
  object_path text not null unique,
  original_name text not null,
  content_type text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 12582912),
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists filing_documents_filing_idx on public.filing_documents(filing_id);

create table if not exists public.logistics_alert_actions (
  alert_key text primary key,
  container_no text not null,
  alert_code text not null check (alert_code in ('terminal_lfd','detention_lfd','empty_return')),
  due_date date,
  status text not null check (status in ('acknowledged','resolved')),
  assigned_to uuid references auth.users(id),
  note text not null default '',
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create index if not exists logistics_alert_actions_container_idx on public.logistics_alert_actions(upper(container_no));

create table if not exists public.logistics_module_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  actor_email text not null default '',
  action text not null,
  entity_type text not null,
  entity_id text not null default '',
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists logistics_module_audit_created_idx on public.logistics_module_audit(created_at desc);

alter table public.logistics_sailings enable row level security;
alter table public.sailing_schedule_shipments enable row level security;
alter table public.lcl_consolidations enable row level security;
alter table public.lcl_consolidation_items enable row level security;
alter table public.shipment_charges enable row level security;
alter table public.shipment_filings enable row level security;
alter table public.filing_documents enable row level security;
alter table public.logistics_alert_actions enable row level security;
alter table public.logistics_module_audit enable row level security;

revoke all on public.logistics_sailings, public.sailing_schedule_shipments, public.lcl_consolidations,
  public.lcl_consolidation_items, public.shipment_charges, public.shipment_filings,
  public.filing_documents, public.logistics_alert_actions, public.logistics_module_audit
  from anon, authenticated;
grant all on public.logistics_sailings, public.sailing_schedule_shipments, public.lcl_consolidations,
  public.lcl_consolidation_items, public.shipment_charges, public.shipment_filings,
  public.filing_documents, public.logistics_alert_actions, public.logistics_module_audit
  to service_role;
grant usage, select on sequence public.logistics_module_audit_id_seq to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logistics-documents', 'logistics-documents', false, 12582912,
  array['application/pdf','image/jpeg','image/png','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
