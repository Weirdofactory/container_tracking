-- Customer tracking access tokens.
-- Apply only after reviewing the rollout plan. This migration does not change
-- existing policies or expose this table to anon/authenticated clients.
create table if not exists public.customer_tracking_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  container_no text not null,
  label text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  last_used_at timestamptz
);

create index if not exists customer_tracking_tokens_container_idx
  on public.customer_tracking_tokens (upper(regexp_replace(container_no, '[^A-Z0-9]', '', 'g')));

alter table public.customer_tracking_tokens enable row level security;
alter table public.customer_tracking_tokens force row level security;

-- Deliberately no anon/authenticated policies. Only a trusted server using
-- the service-role key may read/write tokens. Never put that key in the browser.
comment on table public.customer_tracking_tokens is
  'Hashed bearer tokens granting narrowly scoped customer access to one container. Service-role only.';
