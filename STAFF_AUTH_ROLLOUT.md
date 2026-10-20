# Staff authentication and customer-link management — staging only

## Implemented on the security rollout branch

- `staff_profiles` maps Supabase Auth user IDs to constrained roles (`Admin`, `Editor`, `Viewer`, `Operator`) and an active flag.
- `customer-tracking-admin` verifies the Supabase Auth JWT and active Admin profile on every request.
- Link administration supports create, paginated list, and revoke. Creation validates the container against the source dataset and accepts expiry from 1–90 days.
- Tokens are generated from 32 cryptographically random bytes; only SHA-256 hashes are stored. The raw token is returned once at creation. Grant metadata listing never returns token hashes or raw tokens.
- `tracking-link-admin.html` provides staff sign-in and link administration. `customer-tracking.html` consumes a token-only link and displays an allow-listed subset of the associated shipment.
- The customer page strips the token query parameter from the visible URL/history. The customer Edge Function checks token validity, expiry and revocation and uses a shared database-backed rate limiter.
- `operations-data` requires Supabase Auth and an active staff profile, enforces write roles server-side, and uses compare-and-swap on `updated_at` to reject stale writes with HTTP 409.
- The staff control tower includes a rule-based shipment exception queue calculated from the latest loaded dataset. It is not a live carrier feed and needs SLA threshold validation.

## Staging status and boundaries

These changes are staged in draft PR #27 on `security/public-tracking-hardening`. They have received static validation, but no live Supabase deployment or browser end-to-end validation has been completed. **Do not merge or deploy until the staging checklist passes.** No claim is made that production traffic is using these Edge Functions.

The legacy access-code and localStorage paths were disabled/removed from the hardened branch's staff/customer entry points. Do not restore public arbitrary-reference search against the shared shipment dataset. Keep existing production RLS policies unchanged until all replacement workflows are validated and a separate reversible policy migration is reviewed.

## Trusted provisioning

1. Create staff accounts in Supabase Auth through a trusted administrator process; do not enable public sign-up.
2. Provision `staff_profiles` rows through a trusted SQL/admin path. Never accept a role supplied by the browser.
3. Store the service-role key only in Supabase Edge Function secrets.
4. Configure `CUSTOMER_TRACKING_ALLOWED_ORIGIN` to the exact origin serving the pages.

## Staging checklist

1. Apply the migrations in order: customer tracking tokens, staff profiles, shared rate limits.
2. Deploy `customer-tracking`, `customer-tracking-admin`, and `operations-data` to staging with the JWT settings in `supabase/config.toml`.
3. Test customer tokens: valid, invalid, expired, revoked, unknown container, and unavailable source data. Confirm only one container and approved fields are returned.
4. Test link management with active Admin, Editor, Viewer, Operator, inactive staff, and non-staff accounts. Only an active Admin should be able to create/list/revoke.
5. Test CORS, no-store headers, token removal from URL/history, and shared rate limits. Requests over limit should return 429 with `Retry-After`; limiter failure should fail closed with 503.
6. Test staff dashboard reads and writes by role, including two sessions editing the same dataset. A stale save must return 409 and must not overwrite the newer data.
7. Test Excel imports, bulk edits, delete/undo, refresh/retry behavior, and record counts/sample rows before and after saves.
8. Validate the exception queue against actual GML operating thresholds; document any changes before relying on it for operations.
9. Review customer disclosure approval for every allow-listed field, including MBL and booking references.
10. Review audit logging, monitoring, backup/rollback, gateway/WAF rate limits, and all remaining database access paths before production rollout.

## Request shapes for the admin function

- Create: `{ "action": "create", "containerNo": "ABCD1234567", "label": "Customer / shipment", "expiresInDays": 30 }`
- List: `{ "action": "list", "limit": 50, "offset": 0 }` — limit is 1–100; response excludes token hashes and raw tokens.
- Revoke: `{ "action": "revoke", "tokenId": "<grant UUID>" }`

Every action requires a valid Supabase Auth bearer token and an active `Admin` profile. Do not expose the service-role key to the browser. Container numbers are identifiers, not authorization credentials.
