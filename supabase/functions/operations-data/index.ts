import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = () => Deno.env.get("CUSTOMER_TRACKING_ALLOWED_ORIGIN") ?? "https://weirdofactory.github.io";
const headersFor = (origin: string | null) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, private",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (origin && origin === allowedOrigin()) headers["Access-Control-Allow-Origin"] = allowedOrigin();
  return headers;
};
function reply(status: number, body: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: headersFor(origin) });
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    if (origin && origin !== allowedOrigin()) return new Response(null, { status: 403, headers: headersFor(null) });
    return new Response(null, { status: 204, headers: headersFor(origin) });
  }
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" }, origin);
  if (origin && origin !== allowedOrigin()) return reply(403, { error: "Forbidden" }, null);

  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return reply(401, { error: "Authentication required" }, origin);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return reply(503, { error: "Service unavailable" }, origin);

  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) return reply(401, { error: "Authentication required" }, origin);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await admin
    .from("staff_profiles").select("display_name, role, is_active")
    .eq("user_id", userData.user.id).maybeSingle();
  if (profileError || !profile || !profile.is_active) return reply(403, { error: "Active staff profile required" }, origin);

  const bucketKey = await sha256Hex(`operations-data:${userData.user.id}`);
  const { data: rateRows, error: rateError } = await admin.rpc("consume_edge_rate_limit", {
    p_bucket_key: bucketKey, p_window_seconds: 60, p_limit: 120,
  });
  if (rateError || !Array.isArray(rateRows) || !rateRows[0]) return reply(503, { error: "Service unavailable" }, origin);
  if (!rateRows[0].allowed) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429, headers: { ...headersFor(origin), "Retry-After": String(rateRows[0].retry_after_seconds || 60) },
    });
  }

  let payload: { action?: unknown; data?: unknown; expectedUpdatedAt?: unknown };
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reply(400, { error: "Invalid request" }, origin);
    payload = parsed;
  } catch { return reply(400, { error: "Invalid request" }, origin); }

  if (payload.action === "read") {
    const { data, error } = await admin.from("containers").select("data, updated_at")
      .eq("id", "gml_tracking_records").maybeSingle();
    if (error) return reply(503, { error: "Shipment data unavailable" }, origin);
    if (!data || !Array.isArray(data.data)) return reply(503, { error: "Shipment dataset unavailable" }, origin);
    return reply(200, { data: data.data, updatedAt: data.updated_at, profile: { displayName: profile.display_name, role: profile.role } }, origin);
  }

  if (payload.action === "write") {
    if (!["Admin", "Editor", "Operator"].includes(profile.role)) return reply(403, { error: "Read-only staff role" }, origin);
    if (!Array.isArray(payload.data) || payload.data.length > 20000) return reply(400, { error: "Invalid shipment dataset" }, origin);
    const serialized = JSON.stringify(payload.data);
    if (serialized.length > 8_000_000) return reply(413, { error: "Shipment dataset is too large" }, origin);
    for (const row of payload.data) {
      if (!row || typeof row !== "object" || Array.isArray(row)) return reply(400, { error: "Invalid shipment row" }, origin);
    }
    const expectedUpdatedAt = typeof payload.expectedUpdatedAt === "string" ? payload.expectedUpdatedAt : "";
    if (!expectedUpdatedAt || Number.isNaN(Date.parse(expectedUpdatedAt))) {
      return reply(400, { error: "Dataset version missing. Reload shipment data before saving." }, origin);
    }
    // Compare-and-swap: the version check and update are one database statement,
    // so concurrent staff edits cannot silently overwrite a newer dataset.
    const updatedAt = new Date().toISOString();
    const { data: saved, error: writeError } = await admin.from("containers").update({
      data: payload.data, updated_at: updatedAt,
    }).eq("id", "gml_tracking_records").eq("updated_at", expectedUpdatedAt)
      .select("updated_at").maybeSingle();
    if (writeError) return reply(503, { error: "Could not save shipment data" }, origin);
    if (!saved) return reply(409, { error: "Shipment data changed since you loaded it. Reload the latest records and reapply your changes." }, origin);
    return reply(200, { saved: true, count: payload.data.length, updatedAt: saved.updated_at }, origin);
  }
  return reply(400, { error: "Unsupported action" }, origin);
});
