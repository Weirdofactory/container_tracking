alter table public.forwarding_jobs
  add column if not exists deleted_at timestamptz null,
  add column if not exists deleted_by uuid null references auth.users(id);

create table if not exists public.forwarding_job_hbls (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.forwarding_jobs(id) on delete restrict,
  hbl_no text not null,
  customer_reference text not null default '',
  shipper text not null default '',
  consignee text not null default '',
  notify_party text not null default '',
  package_count integer null check (package_count is null or package_count > 0),
  package_type text not null default '',
  gross_weight_kg numeric(14,2) null check (gross_weight_kg is null or gross_weight_kg >= 0),
  volume_cbm numeric(12,3) null check (volume_cbm is null or volume_cbm >= 0),
  commodity text not null default '',
  customer_visible boolean not null default false,
  notes text not null default '',
  created_by uuid null references auth.users(id),
  updated_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(hbl_no)) > 0),
  constraint forwarding_job_hbls_job_hbl_uq unique(job_id, hbl_no)
);

alter table public.lcl_consolidation_items
  add column if not exists hbl_id uuid null
  references public.forwarding_job_hbls(id) on delete set null;

alter table public.shipment_filings
  add column if not exists hbl_id uuid null
  references public.forwarding_job_hbls(id) on delete set null;

alter table public.shipment_charges
  add column if not exists hbl_id uuid null
  references public.forwarding_job_hbls(id) on delete set null;

create index if not exists forwarding_job_hbls_job_idx
  on public.forwarding_job_hbls(job_id, created_at);

create index if not exists forwarding_job_hbls_hbl_idx
  on public.forwarding_job_hbls(upper(trim(hbl_no)));

create index if not exists lcl_consolidation_items_hbl_id_idx
  on public.lcl_consolidation_items(hbl_id);

create index if not exists shipment_filings_hbl_id_idx
  on public.shipment_filings(hbl_id);

create index if not exists shipment_charges_hbl_id_idx
  on public.shipment_charges(hbl_id);

insert into public.forwarding_job_hbls (
  job_id, hbl_no, customer_reference, shipper, consignee, notify_party,
  package_count, package_type, gross_weight_kg, volume_cbm, commodity,
  customer_visible, notes, created_by, updated_by, created_at, updated_at
)
select distinct on (j.id, upper(trim(j.hbl_no)))
  j.id, upper(trim(j.hbl_no)), j.customer_reference, j.shipper, j.consignee, j.notify_party,
  j.package_count, j.package_type, j.gross_weight_kg, j.volume_cbm, j.commodity,
  j.customer_visible, j.notes, j.created_by, j.updated_by, j.created_at, j.updated_at
from public.forwarding_jobs j
where trim(coalesce(j.hbl_no, '')) <> ''
  and j.deleted_at is null
order by j.id, upper(trim(j.hbl_no)), j.created_at
on conflict (job_id, hbl_no) do nothing;

update public.lcl_consolidation_items i
set hbl_id = h.id
from public.forwarding_job_hbls h
where i.job_id = h.job_id
  and upper(trim(i.hbl_no)) = upper(trim(h.hbl_no))
  and i.hbl_id is null;

update public.shipment_filings f
set hbl_id = h.id
from public.forwarding_job_hbls h
where f.job_id = h.job_id
  and upper(trim(f.hbl_no)) = upper(trim(h.hbl_no))
  and f.hbl_id is null;

alter table public.forwarding_job_hbls enable row level security;
revoke all on table public.forwarding_job_hbls from anon, authenticated;
grant all on table public.forwarding_job_hbls to service_role;
