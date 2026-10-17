# Security review and safe rollout plan

Reviewed: 2026-10-17

## Confirmed current-state risks

- `public.containers` has permissive policies named `Allow all public access` and `Allow public read/update for containers` with unrestricted predicates. The browser app reads the shared `gml_tracking_records` JSON row directly. This exposes the full shared shipment dataset to any client able to call the public API.
- `public.user_roles` has public SELECT policies, including access-code verification. Role metadata and access-code records should not be readable as a public table.
- Several `SECURITY DEFINER` functions in the public schema are executable by `anon` and `authenticated`. They need per-function authorization and least-privilege grants. In particular, partial-match IGM search can return shipment-related details.
- Phase 2 exception tasks and the operations-hub audit currently use browser localStorage. They are not shared, centrally audited records and can disappear when browser storage is cleared.
- Existing access-code login is not equivalent to a Supabase Auth session. Replacing public policies before migrating the login/session flow and customer lookup would risk breaking staff access.

## Safe rollout sequence

1. **Do not apply a blanket RLS policy change directly to production.** First implement and test a secure server-side staff session and customer lookup endpoint.
2. Replace public table reads with a narrowly scoped RPC/Edge Function that validates a tracking reference, returns only customer-approved fields, applies rate limiting, and avoids returning the full JSON shipment dataset. Define how customers prove entitlement to a shipment (authenticated customer account or high-entropy tracking token); a guessable container number alone is not authorization.
3. Migrate staff sign-in to Supabase Auth and enforce role checks server-side. Keep Admin/Editor/Viewer permissions distinct. Never rely on client-side role labels or a public access-code lookup.
4. Review each SECURITY DEFINER function. Add explicit authorization, validate input, restrict EXECUTE grants, and remove anonymous access where not required.
5. Create and test replacement RLS policies in a staging project with anonymous, Viewer, Editor, Admin and customer test cases. Only then remove permissive policies in production.
6. Persist exception tasks and audit events in shared database tables with RLS. Keep the browser-only audit as a convenience view, not the authoritative audit log.
7. Verify customer tracking, staff login, import/export, editing, audit trail, and rollback before production rollout.

## Scope of this branch

This branch adds responsive customer-facing tracking cards while preserving the existing desktop table and data model. It does **not** alter production database policies or claim that the security risks above are resolved. Security hardening is intentionally separated because the current application loads the entire shared container dataset in the browser; removing public reads before replacing that flow would break tracking.
