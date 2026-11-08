alter table public.shipment_charges
  add column if not exists job_id uuid null
  references public.forwarding_jobs(id) on delete set null;

alter table public.shipment_filings
  add column if not exists job_id uuid null
  references public.forwarding_jobs(id) on delete set null;

alter table public.lcl_consolidation_items
  add column if not exists job_id uuid null
  references public.forwarding_jobs(id) on delete set null;

alter table public.shipment_charges
  alter column container_no drop not null;

alter table public.shipment_filings
  alter column container_no drop not null;

create index if not exists shipment_charges_job_id_idx
  on public.shipment_charges(job_id);

create index if not exists shipment_filings_job_id_idx
  on public.shipment_filings(job_id);

create index if not exists lcl_consolidation_items_job_id_idx
  on public.lcl_consolidation_items(job_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'shipment_charges_job_or_container_check'
  ) then
    alter table public.shipment_charges
      add constraint shipment_charges_job_or_container_check
      check (job_id is not null or container_no is not null) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'shipment_filings_job_or_container_check'
  ) then
    alter table public.shipment_filings
      add constraint shipment_filings_job_or_container_check
      check (job_id is not null or container_no is not null) not valid;
  end if;
end $$;

alter table public.shipment_charges
  validate constraint shipment_charges_job_or_container_check;

alter table public.shipment_filings
  validate constraint shipment_filings_job_or_container_check;
