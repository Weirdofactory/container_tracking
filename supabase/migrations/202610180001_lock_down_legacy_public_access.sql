-- Defense-in-depth for legacy public access paths.
--
-- IMPORTANT: review and apply only in a staging Supabase branch first. These
-- policies/RPC grants were found on the connected live project during the
-- 2026-10-18 security review. Do not run against production until all legacy
-- clients have been audited and the staging test matrix passes.
--
-- The staff dashboard now uses the authenticated operations-data Edge
-- Function (service role on the server); no browser should read or mutate
-- the shared containers dataset directly.
begin;

-- The broad policies below made the shared shipment dataset publicly
-- readable and writable regardless of the narrower role-specific policies.
drop policy if exists "Allow all public access" on public.containers;
drop policy if exists "Allow public read/update for containers" on public.containers;
drop policy if exists "Allow delete for Admins only" on public.containers;
drop policy if exists "Allow inserts for Editors and Admins" on public.containers;
drop policy if exists "Allow read access for authenticated users" on public.containers;
drop policy if exists "Allow updates for Editors and Admins" on public.containers;
revoke all privileges on table public.containers from public, anon, authenticated;
-- Trusted Edge Functions continue to use service_role on the server only.

-- user_roles contains legacy access_code values. Retire client reads, including
-- the "read own role" policy, since the new staff_profiles table is the
-- authorization source for the migrated dashboard.
drop policy if exists "Allow public access code verification" on public.user_roles;
drop policy if exists "Allow public read of user_roles" on public.user_roles;
drop policy if exists "Users can read own role" on public.user_roles;
revoke all privileges on table public.user_roles from public, anon, authenticated;

-- Audit logs must not be publicly readable or mutable. Keep a narrow insert
-- path for authenticated active staff because the dashboard writes audit rows
-- after staff actions; do not allow browser-side select/update/delete.
drop policy if exists "Allow delete for Admins only" on public.audit_logs;
drop policy if exists "Allow insert for authenticated" on public.audit_logs;
drop policy if exists "Allow public access for audit_logs" on public.audit_logs;
drop policy if exists "Allow read for authenticated" on public.audit_logs;
revoke all privileges on table public.audit_logs from public, anon, authenticated;
grant insert on table public.audit_logs to authenticated;
drop policy if exists audit_logs_insert_active_staff on public.audit_logs;
create policy audit_logs_insert_active_staff
  on public.audit_logs
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.staff_profiles sp
      where sp.user_id = (select auth.uid())
        and sp.is_active = true
    )
  );

-- Remove direct client privileges from security-sensitive tables. The customer
-- tracking and staff workflows access these through trusted Edge Functions.
revoke all privileges on table public.staff_profiles from public, anon, authenticated;
grant select on table public.staff_profiles to authenticated;

revoke all privileges on table public.customer_tracking_tokens from public, anon, authenticated;
revoke all privileges on table public.edge_rate_limit_buckets from public, anon, authenticated;
revoke all privileges on table public.igm_hbl_details from public, anon, authenticated;
revoke all privileges on table public.containers_backup_20260926 from public, anon, authenticated;

-- IGM RPCs returned full HBL records from arbitrary customer-supplied keys, and
-- the import overloads were callable without a staff JWT. Retire direct RPC
-- access until IGM queries/imports are exposed through an authorized,
-- token-scoped or staff-authenticated API. Trusted server calls can still use
-- service_role; never put the service-role key in browser code.
revoke execute on function public.get_customer_igm_bundle(text) from public, anon, authenticated;
grant execute on function public.get_customer_igm_bundle(text) to service_role;

revoke execute on function public.get_igm_hbl_detail(text) from public, anon, authenticated;
grant execute on function public.get_igm_hbl_detail(text) to service_role;

revoke execute on function public.get_igm_hbls_for_container(text) from public, anon, authenticated;
grant execute on function public.get_igm_hbls_for_container(text) to service_role;

revoke execute on function public.get_igm_hbls_for_shipment(text, text) from public, anon, authenticated;
grant execute on function public.get_igm_hbls_for_shipment(text, text) to service_role;

revoke execute on function public.import_igm_hbl_rows(text, jsonb) from public, anon, authenticated;
grant execute on function public.import_igm_hbl_rows(text, jsonb) to service_role;

revoke execute on function public.import_igm_hbl_rows(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_igm_hbl_rows(uuid, jsonb) to service_role;

revoke execute on function public.search_customer_igm(text) from public, anon, authenticated;
grant execute on function public.search_customer_igm(text) to service_role;

-- This event-trigger function is managed by PostgreSQL's DDL event-trigger
-- mechanism, not intended as an RPC. Explicitly remove inherited API execute
-- grants as defense in depth; the existing event-trigger binding is unchanged.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
grant execute on function public.rls_auto_enable() to service_role;

commit;
