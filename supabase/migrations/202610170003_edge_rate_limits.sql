-- Shared, atomic rate-limit buckets for customer-facing Edge Functions.
-- Staging only until reviewed; never apply automatically as part of deployment.
create table if not exists public.edge_rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now()
);
alter table public.edge_rate_limit_buckets enable row level security;
alter table public.edge_rate_limit_buckets force row level security;
-- No client policies: only trusted server-side code may access rate-limit state.
revoke all on public.edge_rate_limit_buckets from anon, authenticated;

create or replace function public.consume_edge_rate_limit(
  p_bucket_key text,
  p_window_seconds integer,
  p_limit integer
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started timestamptz;
  v_count integer;
  v_now timestamptz := clock_timestamp();
begin
  if p_bucket_key is null or length(p_bucket_key) < 16 or length(p_bucket_key) > 128
     or p_window_seconds < 1 or p_window_seconds > 86400
     or p_limit < 1 or p_limit > 10000 then
    raise exception 'invalid rate-limit arguments';
  end if;

  insert into public.edge_rate_limit_buckets as b
    (bucket_key, window_started_at, request_count, updated_at)
  values (p_bucket_key, v_now, 1, v_now)
  on conflict (bucket_key) do update set
    window_started_at = case
      when b.window_started_at + make_interval(secs => p_window_seconds) <= v_now then v_now
      else b.window_started_at
    end,
    request_count = case
      when b.window_started_at + make_interval(secs => p_window_seconds) <= v_now then 1
      else b.request_count + 1
    end,
    updated_at = v_now
  returning b.window_started_at, b.request_count into v_started, v_count;

  return query select
    v_count <= p_limit,
    case when v_count <= p_limit then 0
         else greatest(1, ceil(extract(epoch from
           (v_started + make_interval(secs => p_window_seconds) - v_now)))::integer)
    end;
end;
$$;

revoke all on function public.consume_edge_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_edge_rate_limit(text, integer, integer) to service_role;

comment on function public.consume_edge_rate_limit(text, integer, integer) is
  'Atomic fixed-window limiter for trusted Edge Functions; service_role only.';
