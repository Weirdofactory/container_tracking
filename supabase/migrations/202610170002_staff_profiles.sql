-- Staff identity and authorization for Supabase Auth.
-- Apply to staging first. Existing access-code login and policies remain unchanged.
create table if not exists public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('Admin', 'Editor', 'Viewer', 'Operator')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.staff_profiles enable row level security;
alter table public.staff_profiles force row level security;
drop policy if exists staff_profiles_select_self on public.staff_profiles;
create policy staff_profiles_select_self on public.staff_profiles
  for select to authenticated using (user_id = (select auth.uid()) and is_active = true);
-- No client-side INSERT/UPDATE/DELETE policies. Provision roles only through a trusted process.
comment on table public.staff_profiles is
  'Authorization mapping for Supabase Auth staff accounts. Role changes require trusted administration.';
