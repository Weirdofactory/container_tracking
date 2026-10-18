-- This insert is expected to fail the audit_logs active-staff RLS policy.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';
INSERT INTO public.audit_logs(id, operator, action)
VALUES ('ci-inactive-audit', 'Inactive CI Staff', 'should-be-rejected');
COMMIT;
