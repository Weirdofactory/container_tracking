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
function validIMO(value: string) {
  if (!/^\d{7}$/.test(value)) return false;
  const sum = [...value.slice(0, 6)].reduce((total, digit, index) => total + Number(digit) * (7 - index), 0);
  return sum % 10 === Number(value[6]);
}
function validMMSI(value: string) {
  return /^\d{9}$/.test(value);
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
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return reply(503, { error: "Service unavailable" }, origin);

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) return reply(401, { error: "Authentication required" }, origin);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await admin
    .from("staff_profiles").select("is_active")
    .eq("user_id", userData.user.id).maybeSingle();
  if (profileError || !profile || !profile.is_active) return reply(403, { error: "Active staff profile required" }, origin);

  const bucketKey = await sha256Hex(`vessel-ais:${userData.user.id}`);
  const { data: rateRows, error: rateError } = await admin.rpc("consume_edge_rate_limit", {
    p_bucket_key: bucketKey, p_window_seconds: 60, p_limit: 20,
  });
  if (rateError || !Array.isArray(rateRows) || !rateRows[0]) return reply(503, { error: "Service unavailable" }, origin);
  if (!rateRows[0].allowed) {
    return new Response(JSON.stringify({ error: "AIS refresh limit reached. Try again shortly." }), {
      status: 429,
      headers: { ...headersFor(origin), "Retry-After": String(rateRows[0].retry_after_seconds || 60) },
    });
  }

  let payload: { imo?: unknown; mmsi?: unknown };
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reply(400, { error: "Invalid request" }, origin);
    payload = parsed;
  } catch {
    return reply(400, { error: "Invalid request" }, origin);
  }
  const imo = typeof payload.imo === "string" ? payload.imo.replace(/\D/g, "") : "";
  const mmsi = typeof payload.mmsi === "string" ? payload.mmsi.replace(/\D/g, "") : "";
  if (!!imo === !!mmsi) return reply(400, { error: "Provide one IMO or MMSI." }, origin);
  if (imo && !validIMO(imo)) return reply(400, { error: "IMO is invalid. Check the seven-digit IMO number." }, origin);
  if (mmsi && !validMMSI(mmsi)) return reply(400, { error: "MMSI must contain nine digits." }, origin);

  const apiKey = Deno.env.get("MARINETRAFFIC_API_KEY");
  if (!apiKey) return reply(503, { error: "MarineTraffic is not configured yet. Add MARINETRAFFIC_API_KEY to Supabase Edge Function secrets." }, origin);
  if (!/^[a-f0-9]{40}$/i.test(apiKey)) return reply(503, { error: "MarineTraffic API key format is invalid. Check the Supabase secret." }, origin);

  const endpoint = new URL(`https://services.marinetraffic.com/api/exportvesseltrack/${encodeURIComponent(apiKey)}`);
  endpoint.searchParams.set("v", "3");
  endpoint.searchParams.set("days", "1");
  endpoint.searchParams.set("msgtype", "simple");
  endpoint.searchParams.set("protocol", "json");
  endpoint.searchParams.set(imo ? "imo" : "mmsi", imo || mmsi);

  let providerResponse: Response;
  try {
    providerResponse = await fetch(endpoint, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  } catch {
    return reply(502, { error: "Could not reach the AIS provider. Try again shortly." }, origin);
  }
  if (providerResponse.status === 429) return reply(429, { error: "MarineTraffic request limit reached. Try again later." }, origin);
  if (!providerResponse.ok) return reply(502, { error: "MarineTraffic rejected this request. Check the API key, plan access and vessel ID." }, origin);

  let raw: unknown;
  try {
    raw = await providerResponse.json();
  } catch {
    return reply(502, { error: "MarineTraffic returned an unreadable response." }, origin);
  }
  const records: unknown[] = Array.isArray(raw) ? raw :
    raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).DATA)
      ? (raw as { DATA: unknown[] }).DATA
      : [];
  const positions = records.flatMap(record => {
    if (!record || typeof record !== "object") return [];
    const item = record as Record<string, unknown>;
    const lat = Number(item.LAT ?? item.lat), lon = Number(item.LON ?? item.lon);
    const timestamp = String(item.TIMESTAMP ?? item.timestamp ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !Number.isFinite(Date.parse(timestamp))) return [];
    const rawSpeed = Number(item.SPEED ?? item.speed);
    const speedKnots = Number.isFinite(rawSpeed) ? rawSpeed / 10 : null;
    const course = Number(item.COURSE ?? item.course);
    return [{
      lat, lon, timestamp,
      speedKnots,
      course: Number.isFinite(course) ? course : null,
      shipName: String(item.SHIPNAME ?? item.shipName ?? "").trim(),
      imo: String(item.IMO ?? item.imo ?? imo),
      mmsi: String(item.MMSI ?? item.mmsi ?? mmsi),
    }];
  }).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (!positions.length) return reply(200, { source: "MarineTraffic", positions: [], latest: null }, origin);

  const cap = 400;
  const sampled = positions.length > cap
    ? Array.from({ length: cap }, (_, i) => positions[Math.round(i * (positions.length - 1) / (cap - 1))])
    : positions;
  return reply(200, { source: "MarineTraffic", positions: sampled, latest: positions[positions.length - 1] }, origin);
});

