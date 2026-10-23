create table if not exists public.shipment_photos (
  id uuid primary key default gen_random_uuid(),
  container_no text not null,
  milestone text not null check (milestone in ('estimated_departure','port_arrival','port_release','cfs_received','destuffing','empty_returned','other')),
  caption text not null default '' check (char_length(caption) <= 180),
  storage_path text not null unique,
  customer_visible boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists shipment_photos_container_created_idx
  on public.shipment_photos (container_no, created_at desc);

alter table public.shipment_photos enable row level security;
revoke all on table public.shipment_photos from public, anon, authenticated;
grant select, insert, update, delete on table public.shipment_photos to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shipment-milestone-photos',
  'shipment-milestone-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Allow all public access" on public.containers;
drop policy if exists "Allow public read/update for containers" on public.containers;