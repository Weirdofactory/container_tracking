# Staff authentication and customer-link management — staging only

## What this change adds
- A staff authorization table keyed to Supabase Auth user IDs, with constrained roles and an active flag.
- An Admin-only `customer-tracking-admin` Edge Function that verifies the Supabase Auth JWT and checks the caller's active staff profile.
- Admin actions: `create` (issues a per-container bearer token), `list` (returns grant metadata only, paginated), and `revoke` (revokes a grant by its ID).
- Tokens are generated from 32 cryptographically random bytes; only SHA-256 hashes are stored. The raw token is returned once at creation. The grant ID is returned separately so a later UI can revoke it.

## Frontend pages added on this branch
- `tracking-link-admin.html`: standalone staff sign-in and tracking-link administration UI. The server function enforces the active Admin profile on every action.
- `customer-tracking.html`: token-only customer tracking page. It calls the restricted Edge Function and displays only the function's allow-listed shipment fields. The token is excluded from referrer headers.
- `supabase/config.toml`: disables gateway JWT verification only for `customer-tracking`, because the bearer tracking token is the endpoint's application-level credential; keeps JWT verification enabled for `customer-tracking-admin`, which requires a Supabase Auth access token.

## Not activated
- This PR does not change the existing access-code login, public tracking search, or production RLS policies.
- The migration is not applied and the Edge Function is not deployed.
- The legacy operations dashboard is not yet migrated to Supabase Auth. The new admin and customer pages are separate entry points and do not change the existing dashboard login or data queries.
- This branch adds a database-backed fixed-window limiter shared across Edge Function instances (30 lookups/minute per token; 60 admin actions/minute per active Admin identity). The functions fail closed if the limiter is unavailable. This complements, but does not replace, gateway/WAF and abuse monitoring before public deployment.
- Before issuing a link, the admin function now verifies the normalized container number exists in the shared tracking source dataset. A missing source dataset returns a service-unavailable response; an unknown container is rejected without creating a token.

## Admin function request shapes
- Create: `{ "action": "create", "containerNo": "ABCD1234567", "label": "Customer / shipment", "expiresInDays": 30 }`
- List: `{ "action": "list", "limit": 50, "offset": 0 }` — limit is 1–100; response excludes token hashes and raw tokens.
- Revoke: `{ "action": "revoke", "tokenId": "<grant UUID>" }`

Every action requires a valid Supabase Auth bearer token and an active `Admin` profile. Do not expose the service-role key to the browser.

## Staging rollout checklist
1. Create staff accounts in Supabase Auth through a trusted administrator process; do not enable public sign-up.
2. Apply this migration in staging, then provision staff profile rows using a trusted SQL/admin path. Verify that only active Admin profiles can call the admin function.
3. Deploy both customer-tracking functions to staging with JWT verification enabled. Configure CUSTOMER_TRACKING_ALLOWED_ORIGIN to the exact app origin.
4. Test missing/invalid JWT, inactive staff, Editor/Viewer/Operator denial, create/list/revoke, expired links, unknown-container rejection without token creation, missing source dataset, CORS, and no-store headers.
5. Test `tracking-link-admin.html` with provisioned Admin and non-Admin accounts; test customer links in a clean browser session, including expired/revoked/unknown-container cases. Browser-script syntax was checked, but no live integration tests have been run.
6. Build and test the main operations dashboard's Supabase Auth session flow. Keep the existing login available until staff workflows have parity.
7. Migrate every required staff data operation to authenticated, role-checked server paths. Then plan a separate reversible RLS migration after auditing all app queries and writes.
8. Apply the separate rate-limit migration in staging and verify that requests above the configured limits receive HTTP 429 with `Retry-After`; verify limiter failure returns HTTP 503 (fail closed). Add gateway/WAF limits, monitoring, and a documented rollback before production rollout.

## Important security notes
- Supabase Auth authenticates identity; the staff profile determines authorization. Never accept a role supplied by the browser.
- The legacy access-code login and localStorage session are not secure authentication and remain in place until a tested frontend migration is merged and deployed.
- Container numbers are identifiers, not authorization credentials.
- The customer lookup endpoint must remain unavailable until its token table exists in the target environment.
