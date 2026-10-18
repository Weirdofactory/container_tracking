# Scoped customer tracking — staged implementation

## Current state

The code changes are staged in draft PR #27. A read-only review of the connected Supabase account on **2026-10-18** found only one project and no development branches, so treat the connected project as live/production unless the owner confirms otherwise. No database writes, policy changes, or Edge Function deployments were made during this review.

The connected project currently records the three tracking/auth/rate-limit migrations as applied and lists the three Edge Functions as active. The deployed `customer-tracking` and `customer-tracking-admin` source files exactly match this branch. The deployed `operations-data` function does **not** match the branch and is missing the `expectedUpdatedAt` compare-and-swap check. Endpoint/browser integration tests have not been run.

Implemented in the branch:

- `customer-tracking.html` accepts a high-entropy token and calls the `customer-tracking` Edge Function; it does not search the shared dataset in the browser.
- `tracking-link-admin.html` signs staff in with Supabase Auth and calls `customer-tracking-admin` for link creation, listing, and revocation.
- The admin function checks the caller's valid Auth session and active `Admin` profile on every request.
- Tokens are generated from 32 cryptographically random bytes. Only SHA-256 hashes are stored; the raw token is returned once on creation.
- Each grant is scoped to one normalized container number and receives a server-generated expiry (1–90 days). The admin endpoint verifies that the container exists before issuing the grant.
- The customer endpoint returns an explicit allow-list of shipment fields, not the source row. It checks revocation and expiry and applies a shared database-backed rate limit.
- The customer page removes the token query parameter from the visible URL/history and sends a `no-referrer` policy.
- The branch version of `operations-data` requires Supabase Auth and an active staff profile. Writes are role-checked and compare-and-swap against the previously read `updated_at` version, returning HTTP 409 on stale data.
- The staff exception queue is rule-based on loaded records; it is not a live carrier feed. Its thresholds require operational validation.

## Connected-project security findings (read-only; 2026-10-18)

The database policy query and Supabase advisors reported remaining legacy API exposures; frontend removal alone does not close them:

- `public.containers` has permissive policies named `Allow all public access` and `Allow public read/update for containers`, both with unconditional true predicates. Other legacy policies also remain on that table.
- `public.user_roles` has public SELECT policies, including `Allow public access code verification`, exposing the legacy access-code surface.
- `public.audit_logs` has a public all-operations policy.
- Anonymous execution is granted on IGM `SECURITY DEFINER` RPCs, including arbitrary-key lookup functions and both `import_igm_hbl_rows` overloads.
- `customer_tracking_tokens` and `edge_rate_limit_buckets` have RLS enabled/forced with no client policies, which is expected; this review did not expose their row data.
- The deployed `operations-data` function is older than this branch and lacks the stale-write version guard.

A separate staged migration, `202610180001_lock_down_legacy_public_access.sql`, now removes broad container/user-role/audit policies, limits audit inserts to active staff, revokes direct API privileges on sensitive tables, and restricts legacy IGM RPC execution to `service_role`. **This migration is not applied.** Its RPC restrictions can affect an undiscovered external IGM client; repository code search did not find a current caller, but verify any external consumers before applying.

## Required staging setup

1. Create/use an isolated staging Supabase environment. Do not treat the connected single project as staging without confirmation, and do not apply the new lockdown migration there as a substitute for a staging rehearsal.
2. Apply migrations in order: `202610170001_customer_tracking_tokens.sql`, `202610170002_staff_profiles.sql`, `202610170003_edge_rate_limits.sql`, then `202610180001_lock_down_legacy_public_access.sql` after verifying dependencies.
3. Provision staff accounts through a trusted Supabase Auth process; do not enable public sign-up. Provision `staff_profiles` through a trusted admin/SQL process.
4. Deploy the three Edge Functions to staging. Keep the service-role key only in Edge Function secrets; never put it in browser code.
5. Set `CUSTOMER_TRACKING_ALLOWED_ORIGIN` to the exact origin serving the pages. Confirm the configured GitHub Pages origin is correct for the actual deployment path.
6. Confirm the Edge Functions use the intended JWT settings from `supabase/config.toml`: customer bearer-token lookup has `verify_jwt = false` because the application validates the tracking token; admin and operations functions require Supabase Auth JWTs.
7. Review the customer disclosure allow-list with the business owner. In particular, confirm whether MBL and booking references are approved for every recipient of a link.

## Required test matrix

- Customer lookup: valid, malformed, random, expired, revoked, and unknown-container tokens.
- Scope: verify a link returns exactly one container and only approved fields; no internal remarks, contact details, seal data, or other rows are exposed.
- Issuance: valid container, unknown container, invalid expiry, and missing/unavailable source dataset. Confirm failed issuance does not create a grant.
- Admin authorization: missing/invalid JWT, inactive staff, non-staff user, and Editor/Viewer/Operator must not be able to create/list/revoke links; active Admin can.
- Lifecycle: create a link, use it, revoke it, and verify the same link immediately fails; verify expiry behavior.
- Abuse controls: rate limit returns HTTP 429 with `Retry-After`; limiter failure returns HTTP 503 (fail closed).
- HTTP/browser: CORS for the configured and unconfigured origins, `Cache-Control: no-store`, token removal from URL/history, clean browser session, clipboard fallback, and no token in referrer.
- Database/API: verify anonymous roles cannot select, insert, update, or delete from `containers`, `user_roles`, or `audit_logs`; verify disabled IGM RPCs reject anon/authenticated; verify active staff audit insert remains functional.
- Staff operations: test Admin/Editor/Operator/Viewer/inactive/non-staff permissions, stale two-session edits (HTTP 409), reload-and-reapply recovery, imports, delete/undo, and record-count integrity.
- Validate staff exception-queue rules and thresholds against actual GML operating SLAs and sample records.

## Rollout boundaries

- No endpoint integration tests, browser end-to-end tests, token lifecycle tests, or two-session concurrency test have been completed. Static GitHub Actions checks alone are not a live validation.
- Do not apply the new lockdown migration or deploy any Edge Function to the connected project until isolated staging tests, dependency review, rollback planning, and explicit production approval are complete.
- Review the remaining Supabase advisor warning for `rls_auto_enable()` separately; do not change the event-trigger function without reviewing its trigger dependency.
- Container numbers are identifiers, not authorization credentials. Never restore public arbitrary-reference access against the shared shipment dataset.
