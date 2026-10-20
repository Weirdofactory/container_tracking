import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const lookup = read("../supabase/functions/customer-tracking/index.ts");
const admin = read("../supabase/functions/customer-tracking-admin/index.ts");
const customerPage = read("../customer-tracking.html");
const adminPage = read("../tracking-link-admin.html");
const tokenMigration = read("../supabase/migrations/202610170001_customer_tracking_tokens.sql");
const staffMigration = read("../supabase/migrations/202610170002_staff_profiles.sql");
const rateLimitMigration = read("../supabase/migrations/202610170003_edge_rate_limits.sql");
const operations = read("../supabase/functions/operations-data/index.ts");
const dashboard = read("../app.js");
const indexPage = read("../index.html");
const supabaseConfig = read("../supabase/config.toml");
const premiumUi = read("../premium-ui.css");
const staffPortal = read("../staff-portal.css");
const staffLoginV3 = read("../staff-login-v3.css");

// Token grants must store only a digest and never expose the full tracking row.
assert.match(lookup, /\.eq\("token_hash", tokenHash\)/);
assert.match(lookup, /\.is\("revoked_at", null\)/);
assert.match(lookup, /grant\.expires_at.*Date\.now\(\)/s);
assert.match(lookup, /return response\(200, \{ shipment \}\)/);
assert.match(lookup, /consume_edge_rate_limit/);
assert.match(lookup, /status: 429/);
assert.match(admin, /consume_edge_rate_limit/);
assert.match(admin, /status: 429/);
assert.match(rateLimitMigration, /enable row level security/);
assert.match(rateLimitMigration, /force row level security/);
assert.match(rateLimitMigration, /grant execute on function public\.consume_edge_rate_limit\(text, integer, integer\) to service_role/i);
assert.match(rateLimitMigration, /revoke all on function public\.consume_edge_rate_limit\(text, integer, integer\) from public, anon, authenticated/i);
assert.match(lookup, /Explicit allow-list/);
assert.doesNotMatch(lookup, /return response\(200,\s*matched\)/);
assert.match(tokenMigration, /token_hash text not null unique/);
assert.match(tokenMigration, /enable row level security/);
assert.match(tokenMigration, /force row level security/);
assert.doesNotMatch(tokenMigration, /create policy/i);

// Every admin action is authenticated and requires an active Admin profile.
assert.match(admin, /caller\.auth\.getUser\(\)/);
assert.match(admin, /!profile\.is_active \|\| profile\.role !== "Admin"/);
assert.match(admin, /crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
assert.match(admin, /token_hash: await sha256Hex\(token\)/);
assert.match(admin, /Container not found in tracking records/);
assert.match(admin, /select\("id, container_no, label, expires_at, revoked_at, created_at, last_used_at"/);
assert.doesNotMatch(admin, /select\([^\n]*token_hash[^\n]*\).*action === "list"/s);
assert.match(staffMigration, /role in \('Admin', 'Editor', 'Viewer', 'Operator'\)/);
assert.match(staffMigration, /enable row level security/);
assert.match(staffMigration, /force row level security/);

// Customer-facing output is no-store, not indexed, and not leaked via referrer.
assert.match(lookup, /Cache-Control": "no-store, private"/);
assert.match(customerPage, /name="robots" content="noindex,nofollow"/);
assert.match(customerPage, /name="referrer" content="no-referrer"/);
assert.match(customerPage, /JSON\.stringify\(\{token\}\)/);
assert.match(customerPage, /esc\(\[.*?\]\)/s);

// Parse every inline browser script to catch syntax errors without a browser.
for (const [name, html] of [["customer page", customerPage], ["admin page", adminPage], ["dashboard page", indexPage]]) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((script) => script.trim());
  for (const script of scripts) {
    // The scripts are wrapped in IIFEs; parsing does not execute DOM or network calls.
    new Function(script);
  }
  assert.ok(scripts.length > 0, `${name} should contain an inline script`);
}

// Parse the large dashboard script as JavaScript without executing DOM or network calls.
new Function(dashboard);
// Operations data endpoint is JWT-authenticated and enforces active staff and write roles server-side.
assert.ok(operations.includes("caller.auth.getUser()"));
assert.ok(operations.includes("!profile.is_active"));
assert.ok(operations.includes('["Admin", "Editor", "Operator"].includes(profile.role)'));
assert.ok(operations.includes('payload.action === "read"'));
assert.ok(operations.includes('payload.action === "write"'));
assert.ok(operations.includes("consume_edge_rate_limit"));
assert.ok(supabaseConfig.includes("[functions.operations-data]"));
assert.ok(supabaseConfig.includes("verify_jwt = true"));
assert.ok(dashboard.includes("sb.auth.signInWithPassword"));
assert.ok(dashboard.includes('sb.functions.invoke("operations-data"'));
assert.ok(indexPage.includes('id="staffEmailInput"'));
assert.ok(indexPage.includes('id="staffPasswordInput"'));
assert.ok(indexPage.includes('id="legacyAccessCodePanel"'));

// UI regression checks: public landing must not advertise unrestricted reference lookup.
assert.ok(indexPage.includes('href="./premium-ui.css?v=20261018-premium-ui-v2"'));
assert.ok(customerPage.includes('href="./premium-ui.css?v=20261018-premium-ui-v1"'));
assert.ok(indexPage.includes("Your shipment link is your secure gateway."));
assert.ok(indexPage.includes('class="legacy-public-search-hooks" hidden aria-hidden="true"'));
assert.ok(indexPage.includes('id="publicSearchInput"'), "preserve the legacy hook for existing script compatibility");
assert.ok(indexPage.includes('Request a tracking link'));
assert.doesNotMatch(indexPage, /Enter a container, MBL, booking or HBL number to begin/);
assert.match(premiumUi, /\.secure-access-panel/);
assert.match(premiumUi, /#opsDashboardView/);
assert.match(premiumUi, /#shipmentPanel/);
assert.match(premiumUi, /prefers-reduced-motion/);
assert.ok(indexPage.includes('href="./staff-portal.css?v=20261020-clean-reset-v1"'));
assert.ok(indexPage.indexOf('staff-portal.css') < indexPage.indexOf('</head>'), "canonical staff UI stylesheet must load in the document head");
assert.match(staffPortal, /#staffControlTowerV12 \.st12-page-head/);
assert.match(staffPortal, /#staffControlTowerV12 \.kpi-row/);
assert.match(staffPortal, /#staffReferenceSidebar/);
assert.match(staffPortal, /@media\(max-width:620px\)/);
assert.ok(indexPage.includes('href="./staff-login-v3.css?v=20261018-login-v3"'));
assert.ok(indexPage.indexOf('staff-login-v3.css') < indexPage.indexOf('</head>'));
assert.match(staffLoginV3, /#loginModalBg \.staff-login-dialog/);
assert.match(staffLoginV3, /grid-template-columns:minmax\(0,\.86fr\) minmax\(0,1\.14fr\)/);
assert.match(staffLoginV3, /@media\(max-width:700px\)/);
assert.match(staffLoginV3, /#loginModalBg \.staff-login-submit/);
assert.doesNotMatch(indexPage, /\\\\n<link rel="stylesheet"/, "do not leave escaped newline text between stylesheet tags");

console.log("Security and UI smoke checks passed.");
