# Staff authentication and customer-link management — staged implementation

## Implemented on the security rollout branch

- `staff_profiles` maps Supabase Auth user IDs to constrained roles (`Admin`, `Editor`, `Viewer`, `Operator`) and an active flag.
- `customer-tracking-admin` verifies the Supabase Auth JWT and active Admin profile on every request.
- Link administration supports create, paginated list, and revoke. Creation validates the container against the source dataset and accepts expiry from 1–90 days.
- Tokens are generated from 32 cryptographically random bytes; only SHA-256 hashes are stored. The raw token is returned once at creation. Grant metadata listing never returns token hashes or raw tokens.
- `tracking-link-admin.html` provides staff sign-in and link administration. `customer-tracking.html` consumes a token-only link and displays an allow-listed subset of the associated shipment.
- The customer page strips the token query parameter from the visible URL/history. The customer Edge Function checks token validity, expiry and revocation and uses a shared database-backed rate limiter.
- The branch version of `operations-data` requires Supabase Auth and an active staff profile, enforces write roles server-side, and uses compare-and-swap on `updated_at` to reject stale writes with HTTP 409.
- The staff control tower includes a rule-based shipment exception queue calculated from the latest loaded dataset. It is not a live carrier feed and needs SLA threshold validation.

## Connected-project status observed 2026-10-18

The connected Supabase account currently exposes one project and no development branches. Do not assume it is a staging project. In its current state:

- The three tracking/auth/rate-limit migrations are recorded as applied and all three Edge Functions are active.
- Live `customer-tracking` and `customer-tracking-admin` source matches this branch exactly.
- Live `operations-data` does not match this branch: it lacks the `expectedUpdatedAt` stale-write guard even though the frontend branch sends that version.
- Supabase policy inspection reported unconditional public policies on `containers`, public SELECT policies on legacy `user_roles`, a public all-operations policy on `audit_logs`, and anonymous execute privileges on several IGM security-definer RPCs.

These findings were obtained via read-only project inspection. No live data was changed and no function was redeployed during this review. The new migration `202610180001_lock_down_legacy_public_access.sql` is only committed to the GitHub branch; it has **not** been applied. Verify any IGM integration outside this repository before restricting the legacy IGM RPCs.

## Staging status and boundaries

The GitHub code is in draft PR #27 on `security/public-tracking-hardening`. A passing GitHub Actions static smoke/type-check run is not equivalent to endpoint or browser validation. Production traffic through the active functions has not been confirmed. **Do not merge, apply the new lockdown migration, or deploy updated Edge Functions until an isolated staging rehearsal and dependency review pass.**

The hardened dashboard should not restore public arbitrary-reference search against the shared shipment dataset. The new database lockdown migration revokes direct browser API access to operational datasets and legacy IGM RPCs; it must be applied only after the staging checks below and an external-client dependency review.

## Trusted provisioning

1. Create staff accounts in Supabase Auth through a trusted administrator process; do not enable public sign-up.
2. Provision `staff_profiles` rows through a trusted SQL/admin path. Never accept a role supplied by the browser.
3. Store the service-role key only in Supabase Edge Function secrets.
4. Configure `CUSTOMER_TRACKING_ALLOWED_ORIGIN` to the exact origin serving the pages.

## Staging checklist

1. Use an isolated staging Supabase environment; do not use the connected single project as staging without confirmation.
2. Apply migrations in order: customer tracking tokens, staff profiles, shared rate limits, then `202610180001_lock_down_legacy_public_access.sql`.
3. Test customer tokens: valid, invalid, expired, revoked, unknown container, and unavailable source data. Confirm only one container and approved fields are returned.
4. Test link management with active Admin, Editor, Viewer, Operator, inactive staff, and non-staff accounts. Only an active Admin should be able to create/list/revoke.
5. Test CORS, no-store headers, token removal from URL/history, and shared rate limits. Requests over limit should return 429 with `Retry-After`; limiter failure should fail closed with 503.
6. Test staff dashboard reads and writes by role, including two sessions editing the same dataset. A stale save must return 409 and must not overwrite the newer data.
7. Test direct REST API access to legacy tables and IGM RPCs after the lockdown migration. Verify anonymous/authenticated calls are denied where intended and active staff audit inserts work.
8. Test Excel imports, bulk edits, delete/undo, refresh/retry behavior, and record counts/sample rows before and after saves.
9. Validate the exception queue against actual GML operating thresholds; document any changes before relying on it for operations.
10. Review customer disclosure approval for every allow-listed field, including MBL and booking references.
11. Review audit logging, monitoring, backup/rollback, gateway/WAF rate limits, remaining Supabase advisor warnings, and all external IGM integrations before production rollout.

## Request shapes for the admin function

- Create: `{ "action": "create", "containerNo": "ABCD1234567", "label": "Customer / shipment", "expiresInDays": 30 }`
- List: `{ "action": "list", "limit": 50, "offset": 0 }` — limit is 1–100; response excludes token hashes and raw tokens.
- Revoke: `{ "action": "revoke", "tokenId": "<grant UUID>" }`

Every action requires a valid Supabase Auth bearer token and an active `Admin` profile. Do not expose the service-role key to the browser. Container numbers are identifiers, not authorization credentials.
