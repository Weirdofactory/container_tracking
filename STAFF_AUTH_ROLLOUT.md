# Staff authentication and customer-link management — staging only

## What this change adds
- A staff authorization table keyed to Supabase Auth user IDs, with constrained roles and an active flag.
- A server-side customer-tracking-admin Edge Function. It verifies the caller's Supabase Auth JWT, checks the caller's active profile is Admin, and supports issuing/revoking per-container bearer tokens.
- Tokens are generated from 32 cryptographically random bytes; only SHA-256 hashes are stored. A newly issued raw token is returned once and must be copied into the customer URL by a later frontend integration.

## Not activated
- This PR does not change the existing access-code login, public tracking search, or production RLS policies.
- The migration is not applied and the Edge Function is not deployed.
- The UI is not yet connected to Supabase Auth or token administration.
- No rate limiting is implemented here. Add gateway/WAF rate limiting before public deployment.

## Staging rollout checklist
1. Create staff accounts in Supabase Auth through a trusted administrator process; do not enable public sign-up.
2. Apply this migration in staging, then provision staff profile rows using a trusted SQL/admin path. Verify that only active Admin profiles can call the admin function.
3. Deploy both customer-tracking functions to staging with JWT verification enabled. Configure CUSTOMER_TRACKING_ALLOWED_ORIGIN to the exact app origin.
4. Test missing/invalid JWT, inactive staff, Editor/Viewer/Operator denial, create/revoke, expired links, unknown container, CORS, and no-store headers.
5. Build and test the frontend Supabase Auth session flow and admin UI. Keep the existing login available until parity checks pass.
6. Migrate every required staff data operation to authenticated, role-checked server paths. Then plan a separate reversible RLS migration after auditing all app queries and writes.
7. Add rate limiting, monitoring, and a documented rollback before production rollout.

## Important security notes
- Supabase Auth authenticates identity; the staff profile determines authorization. Never accept a role supplied by the browser.
- The legacy access-code login and localStorage session are not secure authentication and remain in place until a tested frontend migration is merged and deployed.
- Container numbers are identifiers, not authorization credentials.
- The customer lookup endpoint must remain unavailable until its token table exists in the target environment.
