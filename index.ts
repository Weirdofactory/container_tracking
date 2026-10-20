import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("CUSTOMER_TRACKING_ALLOWED_ORIGIN") ?? "https://weirdofactory.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, private",
  "Vary": "Origin",
};

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function normalize(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

function field(record: Record<string, unknown>, names: string[]): string {
  const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const name of names) {
    const key = Object.keys(record).find(k => normalizeKey(k) === normalizeKey(name));
    if (key && record[key] !== null && record[key] !== undefined && String(record[key]).trim()) {
      return String(record[key]).trim();
    }
  }
  return "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response(405, { error: "Method not allowed" });

  const origin = req.headers.get("origin");
  const allowedOrigin = Deno.env.get("CUSTOMER_TRACKING_ALLOWED_ORIGIN") ?? "https://weirdofactory.github.io";
  if (origin && origin !== allowedOrigin) return response(403, { error: "Forbidden" });

  let payload: { token?: unknown };
  try {
    payload = await req.json();
  } catch {
    return response(400, { error: "Invalid request" });
  }

  const token = typeof payload.token === "string" ? payload.token.trim() : "";
  // Tokens must be generated from at least 32 cryptographically random bytes.
  if (token.length < 40 || token.length > 256 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return response(404, { error: "Tracking record not found" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return response(500, { error: "Tracking service unavailable" });

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const tokenHash = await sha256Hex(token);
  // Apply a shared fixed-window limit before querying grants. Fail closed if
  // the limiter is unavailable; do not silently disable abuse protection.
  const bucketKey = await sha256Hex(`customer-tracking:${tokenHash}`);
  const { data: rateRows, error: rateError } = await admin.rpc("consume_edge_rate_limit", {
    p_bucket_key: bucketKey,
    p_window_seconds: 60,
    p_limit: 30,
  });
  if (rateError || !Array.isArray(rateRows) || !rateRows[0]) {
    return response(503, { error: "Tracking service temporarily unavailable" });
  }
  if (!rateRows[0].allowed) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: { ...corsHeaders, "Retry-After": String(rateRows[0].retry_after_seconds || 60) },
    });
  }

  const { data: grant, error: grantError } = await admin
    .from("customer_tracking_tokens")
    .select("id, container_no, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (grantError || !grant || (grant.expires_at && new Date(grant.expires_at).getTime() <= Date.now())) {
    return response(404, { error: "Tracking record not found" });
  }

  const { data: source, error: sourceError } = await admin
    .from("containers")
    .select("data")
    .eq("id", "gml_tracking_records")
    .maybeSingle();

  if (sourceError || !Array.isArray(source?.data)) {
    return response(503, { error: "Tracking service temporarily unavailable" });
  }

  const expected = normalize(grant.container_no);
  const matched = source.data.find((item: unknown) => {
    if (!item || typeof item !== "object") return false;
    return normalize(field(item as Record<string, unknown>, [
      "CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO", "CONTAINER NUMBER",
    ])) === expected;
  }) as Record<string, unknown> | undefined;

  if (!matched) return response(404, { error: "Tracking record not found" });

  // Explicit allow-list: never return the full source row (which may contain
  // driver contacts, seals, internal remarks, or other operations-only fields).
  const allowedFields: Record<string, string[]> = {
    container: ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO", "CONTAINER NUMBER"],
    type: ["TYPE", "SIZE", "CONTAINER TYPE"],
    status: ["STATUS", "CONTAINER STATUS"],
    vessel: ["VESSEL & VOY", "VESSEL", "VESSEL NAME"],
    shippingLine: ["LINER", "LINE", "SHIPPING LINE"],
    pol: ["POL", "PORT OF LOADING"],
    pod: ["POD", "PORT OF DISCHARGE", "DISCHARGE PORT"],
    gateway: ["GATEWAY PORT", "GATEWAY"],
    cfs: ["CFS NAME", "CFS"],
    etd: ["ETD", "VESSEL DEPARTURE"],
    eta: ["ETA", "ESTIMATED ARRIVAL"],
    inwardDate: ["INWARD DATE", "INWARD"],
    portIn: ["PORT IN"],
    portOut: ["PORT OUT"],
    cfsIn: ["CFS IN"],
    destuffingDate: ["DESTUFFING DATE", "DESTUFF DATE"],
    emptyReturnDate: ["CONTAINER RETURN DATE", "EMPTY RETURN DATE"],
    mbl: ["MBL NO", "MBL", "MASTER BL"],
    booking: ["BOOKING NO", "BOOKING NUMBER", "BOOKING"],
  };

  const shipment: Record<string, string> = {};
  for (const [key, aliases] of Object.entries(allowedFields)) {
    const value = field(matched, aliases);
    if (value) shipment[key] = value;
  }

  await admin.from("customer_tracking_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", grant.id);

  return response(200, { shipment });
});
