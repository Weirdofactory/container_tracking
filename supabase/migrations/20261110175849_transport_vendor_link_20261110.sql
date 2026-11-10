alter table public.transport_dispatches
  add column if not exists carrier_vendor_id uuid references public.vendor_accounts(id) on delete set null;
create index if not exists transport_dispatches_vendor_idx on public.transport_dispatches(carrier_vendor_id);
