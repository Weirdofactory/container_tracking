# Security review and safe rollout plan

Reviewed: 2026-10-17

## Confirmed current-state risks

- `public.containers` has permissive policies named `Allow all public access` and `Allow public read/update for containers` with unrestricted predicates. The browser app reads the shared `gml_tracking_records` JSON row directly. This exposes the full shared shipment dataset to any client able to call the public API.
- `public.user_roles` has public SELECT policies, including access-code verification. Role metadata and access-code records should not be readable as a public table.
- Several `SECURITY DEFINER` functions in the public schema are executable by `anon` and `authenticated`. They need per-function authorization and least-privilege grants. In particular, partial-match IGM search can return shipment-related details.
- Phase 2 exception tasks and the operations-hub audit currently use browser localStorage. They are not shared, centrally audited records and can disappear when browser storage is cleared.
- Existing access-code login is not equivalent to a Supabase Auth session. Replacing public policies before migrating the login/session flow and customer lookup would risk breaking staff access.

## Confirmed production database findings (2026-10-17)

A live read-only policy/function inventory confirmed the following additional details:

- `public.audit_logs` has an unrestricted public `ALL` policy. This allows anonymous reads and writes to operational audit records despite the more restrictive policies also present.
- `public.containers` has unrestricted public `ALL` and public read/update policies. The public app currently depends on this table, so removing these policies now would break the existing data-loading and editing flows.
- `public.user_roles` has two public `SELECT` policies. This exposes role/access-code metadata and makes the current access-code verification design unsafe.
- `public.password_resets` permits unrestricted public inserts. This can be abused to create reset-request spam unless input is validated and rate-limited.
- The following `SECURITY DEFINER` RPCs currently grant execute to `anon` and `authenticated`: `get_customer_igm_bundle(text)`, `get_igm_hbl_detail(text)`, `get_igm_hbls_for_container(text)`, `get_igm_hbls_for_shipment(text,text)`, `search_customer_igm(text)`, both overloads of `import_igm_hbl_rows(...)`, and `rls_auto_enable()`. Several return full IGM/HBL records; `search_customer_igm` accepts partial matches, and the access-code overload of `import_igm_hbl_rows` authorizes based on a value in `user_roles` rather than an authenticated user identity.
- The existing `quick-worker` Edge Function requires a JWT but is only a sample “hello” function; it is not yet a customer tracking gateway.

**Immediate risk:** do not treat the current public tracking search as private. A container number or HBL/MBL alone is guessable and should not be treated as proof that a requester is entitled to shipment details.

## Safe rollout sequence

1. **Do not apply a blanket RLS policy change directly to production.** First implement and test a secure server-side staff session and customer lookup endpoint. The live inventory confirms broad public policies are in place, but the existing app still depends on them.
2. Replace public table reads with a narrowly scoped RPC/Edge Function that validates a tracking reference, returns only customer-approved fields, applies rate limiting, and avoids returning the full JSON shipment dataset. Define how customers prove entitlement to a shipment (authenticated customer account or high-entropy tracking token); a guessable container number alone is not authorization.
3. Migrate staff sign-in to Supabase Auth and enforce role checks server-side. Keep Admin/Editor/Viewer permissions distinct. Never rely on client-side role labels or a public access-code lookup.
4. Review each SECURITY DEFINER function. Add explicit authorization, validate input, restrict EXECUTE grants, and remove anonymous access where not required.
5. Create and test replacement RLS policies in a staging project with anonymous, Viewer, Editor, Admin and customer test cases. Only then remove permissive policies in production.
6. Persist exception tasks and audit events in shared database tables with RLS. Keep the browser-only audit as a convenience view, not the authoritative audit log.
7. Verify customer tracking, staff login, import/export, editing, audit trail, and rollback before production rollout.

## Scope of this branch

This branch adds responsive customer-facing tracking cards while preserving the existing desktop table and data model. It does **not** alter production database policies or claim that the security risks above are resolved. Security hardening is intentionally separated because the current application loads the entire shared container dataset in the browser; removing public reads before replacing that flow would break tracking.


## Changes made during this follow-up

- Performed a read-only inspection of production RLS policies, table schemas, Edge Functions, and Supabase security-advisor findings.
- No production SQL, RLS policies, grants, or Edge Functions were changed. This is deliberate: revoking public access before replacing the current client-side data load and access-code login would risk taking down customer tracking and staff operations.
- Before applying the policy changes, build a tested Auth-backed staff session and a narrowly scoped customer tracking endpoint, then test them against a staging copy. The customer endpoint must not return the full `containers.data` payload or expose unrestricted IGM/HBL search.
