import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = () => Deno.env.get("CUSTOMER_TRACKING_ALLOWED_ORIGIN") ?? "https://weirdofactory.github.io";
function headersFor(origin: string | null) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, private",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "X-Content-Type-Options": "nosniff",
  };
  if (origin && origin === allowedOrigin()) headers["Access-Control-Allow-Origin"] = allowedOrigin();
  return headers;
}
function reply(status: number, body: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: headersFor(origin) });
}
function normalize(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function field(record: Record<string, unknown>, names: string[]): string {
  const normalizedNames = new Set(names.map(name => name.toLowerCase().replace(/[^a-z0-9]/g, "")));
  for (const key of Object.keys(record)) {
    if (normalizedNames.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) {
      const value = record[key];
      if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
    }
  }
  return "";
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
function clientAddress(req: Request): string {
  const direct = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip");
  if (direct) return direct.trim().slice(0, 100);
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim().slice(0, 100) : "unknown";
}
function safeShipment(row: Record<string, unknown>) {
  const etd = field(row, ["ETD", "VESSEL DEPARTURE"]);
  const portIn = field(row, ["PORT IN"]);
  const portOut = field(row, ["PORT OUT"]);
  const cfsIn = field(row, ["CFS IN"]);
  const destuffing = field(row, ["DESTUFFING DATE", "DESTUFF DATE"]);
  const emptyReturned = field(row, ["CONTAINER RETURN DATE", "EMPTY RETURN DATE"]);
  let status = "Awaiting departure";
  if (emptyReturned) status = "Empty returned";
  else if (destuffing) status = "Destuffing";
  else if (cfsIn) status = "At CFS";
  else if (portOut) status = "Port released";
  else if (portIn) status = "Arrived at port";
  else if (etd) status = "Vessel departed";
  return {
    container: field(row, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO", "CONTAINER NUMBER"]),
    type: field(row, ["TYPE", "SIZE", "CONTAINER TYPE"]),
    status,
    vessel: field(row, ["VESSEL & VOY", "VESSEL", "VESSEL NAME"]),
    shippingLine: field(row, ["LINER", "LINE", "SHIPPING LINE"]),
    origin: field(row, ["POL", "PORT OF LOADING"]),
    gateway: field(row, ["GATEWAY PORT", "GATEWAY"]),
    etd,
    eta: field(row, ["ETA", "ESTIMATED ARRIVAL"]),
    milestones: [
      { label: "Vessel departure", date: etd, estimate: true },
      { label: "Port arrival", date: portIn, estimate: false },
      { label: "Port release", date: portOut, estimate: false },
      { label: "CFS received", date: cfsIn, estimate: false },
      { label: "Destuffing", date: destuffing, estimate: false },
      { label: "Empty returned", date: emptyReturned, estimate: false },
    ],
  };
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    if (origin && origin !== allowedOrigin()) return new Response(null, { status: 403, headers: headersFor(null) });
    return new Response(null, { status: 204, headers: headersFor(origin) });
  }
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" }, origin);
  if (origin && origin !== allowedOrigin()) return reply(403, { error: "Forbidden" }, null);
  const length = Number(req.headers.get("content-length") || 0);
  if (length > 4096) return reply(413, { error: "Request too large" }, origin);

  let payload: { reference?: unknown };
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reply(400, { error: "Invalid request" }, origin);
    payload = parsed as { reference?: unknown };
  } catch {
    return reply(400, { error: "Invalid request" }, origin);
  }
  const rawReference = typeof payload.reference === "string" ? payload.reference.trim() : "";
  const reference = normalize(rawReference);
  if (reference.length < 5 || reference.length > 32 || !/^[A-Z0-9]+$/.test(reference)) {
    return reply(400, { error: "Enter a valid container or bill of lading number." }, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return reply(503, { error: "Tracking service is temporarily unavailable." }, origin);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const bucketKey = await sha256Hex("customer-track-public:" + clientAddress(req) + ":" + serviceKey);
  const { data: rateRows, error: rateError } = await admin.rpc("consume_edge_rate_limit", {
    p_bucket_key: bucketKey,
    p_window_seconds: 60,
    p_limit: 12,
  });
  if (rateError || !Array.isArray(rateRows) || !rateRows[0]) {
    return reply(503, { error: "Tracking service is temporarily unavailable." }, origin);
  }
  if (!rateRows[0].allowed) {
    return new Response(JSON.stringify({ error: "Too many searches. Please try again in a minute." }), {
      status: 429,
      headers: { ...headersFor(origin), "Retry-After": String(rateRows[0].retry_after_seconds || 60) },
    });
  }

  const { data: source, error: sourceError } = await admin.from("containers")
    .select("data").eq("id", "gml_tracking_records").maybeSingle();
  if (sourceError || !Array.isArray(source?.data)) {
    return reply(503, { error: "Tracking service is temporarily unavailable." }, origin);
  }
  const blAliases = ["MBL NO", "MBL", "MASTER BL", "MASTER BILL OF LADING", "BILL OF LADING", "BL NO", "B/L NO"];
  const matches = source.data.filter((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const row = item as Record<string, unknown>;
    const container = normalize(field(row, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO", "CONTAINER NUMBER"]));
    const billOfLading = normalize(field(row, blAliases));
    return container === reference || billOfLading === reference;
  }) as Record<string, unknown>[];

  const results = matches.slice(0, 12).map(safeShipment);
  return reply(200, { results, truncated: matches.length > results.length }, origin);
});
