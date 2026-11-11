-- Customer relationship history and follow-up management
create table if not exists public.customer_activities (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customer_accounts(id),
  contact_id uuid references public.customer_account_contacts(id),
  job_id uuid references public.forwarding_jobs(id),
  activity_type text not null check (activity_type in ('call','meeting','email','visit','note','task')),
  subject text not null check (length(btrim(subject)) between 1 and 180),
  details text not null default '',
  activity_at date not null default current_date,
  follow_up_at date,
  follow_up_status text not null default 'none'
    check (follow_up_status in ('none','open','completed','cancelled')),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_activities_follow_up_consistency check (
    (follow_up_status = 'none' and follow_up_at is null)
    or (follow_up_status in ('open','completed','cancelled') and follow_up_at is not null)
  )
);

create index if not exists customer_activities_customer_date_idx
  on public.customer_activities (customer_id, activity_at desc, created_at desc);
create index if not exists customer_activities_contact_id_idx
  on public.customer_activities (contact_id)
  where contact_id is not null;
create index if not exists customer_activities_job_id_idx
  on public.customer_activities (job_id)
  where job_id is not null;
create index if not exists customer_activities_open_follow_up_idx
  on public.customer_activities (follow_up_at, customer_id)
  where follow_up_status = 'open';

alter table public.customer_activities enable row level security;
revoke all on table public.customer_activities from anon, authenticated;
grant all on table public.customer_activities to service_role;
