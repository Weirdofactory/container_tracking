# Container Tracking Suite

Static frontend pages with Supabase Edge Functions for staff operations and private customer tracking.

## Pages

- `index.html` â€” staff operations dashboard and customer landing page.
- `customer-tracking.html` â€” customer view for a shipment-specific private tracking token.
- `tracking-link-admin.html` â€” staff interface for creating and revoking customer links.

## Main files

- `app.js` â€” combined dashboard logic, including operations views and staff UI modules.
- `style.css` â€” combined dashboard styles.
- `premium-ui.css` â€” customer tracking and landing-page styles.
- `supabase/` â€” Edge Functions, configuration, and database migrations.

The browser app requires the configured Supabase project, deployed Edge Functions, and migrations described in `SECURITY_IMPLEMENTATION.md`. The publishable Supabase key in `app.js` is intended for browser use; keep service-role keys in Edge Function secrets only.