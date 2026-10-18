-- Assertions run after the lockdown migration inside disposable CI PostgreSQL.
DO $$
DECLARE
  t text;
  p text;
  roles_to_check text[] := ARRAY['anon', 'authenticated'];
  table_names text[] := ARRAY[
    'public.containers',
    'public.user_roles',
    'public.audit_logs',
    'public.customer_tracking_tokens',
    'public.edge_rate_limit_buckets',
    'public.igm_hbl_details',
    'public.containers_backup_20260926'
  ];
  fn text;
  fn_names text[] := ARRAY[
    'public.get_customer_igm_bundle(text)',
    'public.get_igm_hbl_detail(text)',
    'public.get_igm_hbls_for_container(text)',
    'public.get_igm_hbls_for_shipment(text,text)',
    'public.import_igm_hbl_rows(text,jsonb)',
    'public.import_igm_hbl_rows(uuid,jsonb)',
    'public.search_customer_igm(text)',
    'public.rls_auto_enable()'
  ];
BEGIN
  FOREACH t IN ARRAY table_names LOOP
    FOREACH p IN ARRAY roles_to_check LOOP
      IF has_table_privilege(p, t, 'SELECT')
         OR has_table_privilege(p, t, 'INSERT')
         OR has_table_privilege(p, t, 'UPDATE')
         OR has_table_privilege(p, t, 'DELETE') THEN
        RAISE EXCEPTION 'Unexpected direct % privilege on %', p, t;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT has_table_privilege('authenticated', 'public.staff_profiles', 'SELECT') THEN
    RAISE EXCEPTION 'Authenticated staff must be able to read staff_profiles through its row policy';
  END IF;
  IF has_table_privilege('anon', 'public.staff_profiles', 'SELECT') THEN
    RAISE EXCEPTION 'Anonymous users must not read staff_profiles';
  END IF;
  IF has_table_privilege('authenticated', 'public.staff_profiles', 'INSERT')
     OR has_table_privilege('authenticated', 'public.staff_profiles', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.staff_profiles', 'DELETE') THEN
    RAISE EXCEPTION 'Client-side staff_profiles mutations must remain prohibited';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='containers') THEN
    RAISE EXCEPTION 'Legacy containers policies should all be removed; the table must default-deny clients';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_roles') THEN
    RAISE EXCEPTION 'Legacy user_roles policies should all be removed';
  END IF;

  SELECT policyname INTO p
  FROM pg_policies
  WHERE schemaname='public' AND tablename='audit_logs';
  IF p IS DISTINCT FROM 'audit_logs_insert_active_staff'
     OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='audit_logs') <> 1
     OR NOT has_table_privilege('authenticated', 'public.audit_logs', 'INSERT')
     OR has_table_privilege('authenticated', 'public.audit_logs', 'SELECT')
     OR has_table_privilege('anon', 'public.audit_logs', 'INSERT') THEN
    RAISE EXCEPTION 'Audit log must expose insert-only access for authenticated active staff';
  END IF;

  FOREACH fn IN ARRAY fn_names LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE')
       OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Legacy RPC remains executable by client role: %', fn;
    END IF;
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Trusted service_role execution missing: %', fn;
    END IF;
  END LOOP;
END;
$$;

-- Create active/inactive fixtures as database owner and test a real active-staff audit insert.
INSERT INTO auth.users(id) VALUES
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002')
ON CONFLICT DO NOTHING;
INSERT INTO public.staff_profiles(user_id, display_name, role, is_active) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Active CI Staff', 'Admin', true),
  ('10000000-0000-4000-8000-000000000002', 'Inactive CI Staff', 'Viewer', false)
ON CONFLICT (user_id) DO UPDATE SET is_active=EXCLUDED.is_active;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
INSERT INTO public.audit_logs(id, operator, action, "containerNo", field, "oldVal", "newVal")
VALUES ('ci-active-audit', 'Active CI Staff', 'security-test', 'TEST0000001', 'status', 'old', 'new');
COMMIT;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.audit_logs WHERE id='ci-active-audit') <> 1 THEN
    RAISE EXCEPTION 'Expected active staff audit insert did not persist';
  END IF;
END;
$$;
