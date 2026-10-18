# Scoped customer tracking — staged implementation

## Current state

This branch contains the frontend and server-side building blocks for private, per-container customer tracking. It is **not deployed or live-validated**. Keep PR #27 open and do not deploy until the staging checklist below passes.

- `customer-tracking.html` accepts a high-entropy token and calls the `customer-tracking` Edge Function; it does not search the shared dataset in the browser.
- `tracking-link-admin.html` signs staff in with Supabase Auth and calls `customer-tracking-admin` for link creation, listing, and revocation.
- The admin function checks the caller's valid Auth session and active `Admin` profile on every request.
- Tokens are generated from 32 cryptographically random bytes. Only SHA-256 hashes are stored; the raw token is returned once on creation.
- Each grant is scoped to one normalized container number and receives a server-generated expiry (1–90 days). The admin endpoint verifies that the container exists before issuing the grant.
- The customer endpoint returns an explicit allow-list of shipment fields, not the source row. It checks revocation and expiry and applies a shared database-backed rate limit.
- The customer page removes the token query parameter from the visible URL/history and sends a `no-referrer` policy.
- `operations-data` requires Supabase Auth and an active staff profile. Writes are role-checked and compare-and-swap against the previously read `updated_at` version, returning HTTP 409 on stale data.
- The staff exception queue is rule-based on loaded records; it is not a live carrier feed. Its thresholds require operational validation.

## Required staging setup

1. Use a staging Supabase project and a non-production copy of the shipment data.
2. Apply migrations in order: `202610170001_customer_tracking_tokens.sql`, `202610170002_staff_profiles.sql`, then `202610170003_edge_rate_limits.sql`.
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
- Staff operations: test Admin/Editor/Operator/Viewer/inactive/non-staff permissions, stale two-session edits (HTTP 409), reload-and-reapply recovery, imports, delete/undo, and record-count integrity.
- Validate staff exception-queue rules and thresholds against actual GML operating SLAs and sample records.

## Rollout boundaries

- No live Supabase deployment, browser end-to-end test, token lifecycle integration test, or two-session concurrency test has been completed by static validation alone.
- Do not merge/deploy or remove legacy database policies as part of this staged work. Before production rollout, review RLS policies and all remaining app read/write paths, define rollback steps, and add monitoring/audit logging.
- Container numbers are identifiers, not authorization credentials. Never restore public arbitrary-reference access against the shared shipment dataset.
