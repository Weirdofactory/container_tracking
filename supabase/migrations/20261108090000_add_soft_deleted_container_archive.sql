create table if not exists public.deleted_container_records (
  id uuid primary key default gen_random_uuid(),
  container_no text not null,
  row_data jsonb not null,
  deleted_by uuid null references auth.users(id),
  deleted_at timestamptz not null default now()
);
create index if not exists deleted_container_records_container_idx
  on public.deleted_container_records (upper(trim(container_no)));
alter table public.deleted_container_records enable row level security;
revoke all on table public.deleted_container_records from anon, authenticated;
grant all on table public.deleted_container_records to service_role;
