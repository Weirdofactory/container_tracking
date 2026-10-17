# Scoped customer tracking lookup (staging implementation)

This folder contains the first server-side building block for moving customer tracking away from downloading the shared shipment dataset.

## Important status

- This is **not deployed** and is not connected to the public page yet.
- The existing production policies and staff login are unchanged.
- The function returns an allow-listed subset of one container record after validating a high-entropy bearer token.
- Tokens are hashed with SHA-256 before storage. The raw token is intended to be shown once at issuance and never stored.
- The function uses the service-role key only in the Edge Function environment; never place it in browser code.
- The SQL migration intentionally creates a table with RLS enabled and no client policies. Only trusted server-side code should access it.

## Before enabling customer access

1. Apply the migration to a staging project first.
2. Build an authenticated staff-only token issuance/revocation flow. Generate tokens with at least 32 random bytes, store only SHA-256 hashes, set expiry, and bind each token to exactly one container.
3. Configure `CUSTOMER_TRACKING_ALLOWED_ORIGIN` to the exact production site origin.
4. Add rate limiting at the gateway/WAF layer. In-memory Edge Function counters are not adequate in a distributed deployment.
5. Review the allow-list against the fields approved for customer disclosure.
6. Test valid, invalid, expired, revoked tokens; unknown containers; CORS; rate limits; no-store headers; and confirm no other containers or internal fields are returned.
7. Update the frontend to call this endpoint with a token instead of searching the full local `rows` array.
8. Only after staff authentication and all required write paths have migrated, replace permissive production RLS policies in a separate, reversible migration.

## Deliberate limitations

- There is no token issuance UI yet.
- This function does not implement rate limiting itself.
- Container number alone is not an authorization credential.
- The existing access-code login must not be represented as secure Supabase Auth.
