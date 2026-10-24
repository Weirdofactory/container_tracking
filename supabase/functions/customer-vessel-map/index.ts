import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = () => Deno.env.get("CUSTOMER_TRACKING_ALLOWED_ORIGIN") ?? "https://weirdofactory.github.io";
const positionCache = new Map<string, { expiresAt: number; body: Record<string, unknown> }>();
const headersFor = (origin: string | null) => {
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
};
function reply(status: number, body: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: headersFor(origin) });
}
function normalize(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function field(record: Record<string, unknown>, names: string[]): string {
  const wanted = new Set(names.map(name => name.toLowerCase().replace(/[^a-z0-9]/g, "")));
  for (const key of Object.keys(record)) {
    if (!wanted.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) continue;
    const value = record[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return "";
}
function validIMO(value: string) {
  if (!/^\d{7}$/.test(value)) return false;
  const sum = [...value.slice(0, 6)].reduce((total, digit, index) => total + Number(digit) * (7 - index), 0);
  return sum % 10 === Number(value[6]);
}
function validMMSI(value: string) {
  return /^\d{9}$/.test(value);
}
function vesselSearchName(value: string): string {
  return value.replace(/\s+V\.?\s+[A-Z0-9-]*\d[A-Z0-9-]*(?:\s+\(\d+\))?\s*$/i, "").trim() || value.trim();
}
function safePositionData(raw: unknown, imo: string, mmsi: string) {
  const records: unknown[] = Array.isArray(raw) ? raw :
    raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).DATA)
      ? (raw as { DATA: unknown[] }).DATA : [];
  const positions = records.flatMap(record => {
    if (!record || typeof record !== "object") return [];
    const item = record as Record<string, unknown>;
    const lat = Number(item.LAT ?? item.lat), lon = Number(item.LON ?? item.lon);
    const timestamp = String(item.TIMESTAMP ?? item.timestamp ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !Number.isFinite(Date.parse(timestamp))) return [];
    const rawSpeed = Number(item.SPEED ?? item.speed);
    const course = Number(item.COURSE ?? item.course);
    return [{
      lat, lon, timestamp,
      speedKnots: Number.isFinite(rawSpeed) ? rawSpeed / 10 : null,
      course: Number.isFinite(course) ? course : null,
      shipName: String(item.SHIPNAME ?? item.shipName ?? "").trim(),
    }];
  }).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const cap = 180;
  const sampled = positions.length > cap
    ? Array.from({ length: cap }, (_, i) => positions[Math.round(i * (positions.length - 1) / (cap - 1))])
    : positions;
  return { positions: sampled, latest: positions.length ? positions[positions.length - 1] : null };
}
function clientAddress(req: Request): string {
  const direct = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip");
  if (direct) return direct.trim().slice(0, 100);
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim().slice(0, 100) : "unknown";
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
async function consumeProviderSlot(admin: ReturnType<typeof createClient>, serviceKey: string, endpoint: string): Promise<boolean> {
  const bucketKey = await sha256Hex("customer-vessel-map:provider:" + endpoint + ":" + serviceKey);
  const { data, error } = await admin.rpc("consume_edge_rate_limit", {
    p_bucket_key: bucketKey, p_window_seconds: 60, p_limit: 2,
  });
  return !error && Array.isArray(data) && !!data[0]?.allowed;
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
  const reference = normalize(typeof payload.reference === "string" ? payload.reference : "");
  if (reference.length < 5 || reference.length > 24 || !/^[A-Z0-9]+$/.test(reference)) {
    return reply(400, { error: "Use the shipment's container number to load its vessel map." }, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return reply(503, { error: "Vessel map is temporarily unavailable." }, origin);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const bucketKey = await sha256Hex("customer-vessel-map:" + clientAddress(req) + ":" + serviceKey);
  const { data: rateRows, error: rateError } = await admin.rpc("consume_edge_rate_limit", {
    p_bucket_key: bucketKey, p_window_seconds: 60, p_limit: 6,
  });
  if (rateError || !Array.isArray(rateRows) || !rateRows[0]) return reply(503, { error: "Vessel map is temporarily unavailable." }, origin);
  if (!rateRows[0].allowed) {
    return new Response(JSON.stringify({ error: "Live vessel map refresh limit reached. Please try again shortly." }), {
      status: 429,
      headers: { ...headersFor(origin), "Retry-After": String(rateRows[0].retry_after_seconds || 60) },
    });
  }

  const { data: source, error: sourceError } = await admin.from("containers")
    .select("data").eq("id", "gml_tracking_records").maybeSingle();
  if (sourceError || !Array.isArray(source?.data)) return reply(503, { error: "Vessel map is temporarily unavailable." }, origin);
  const row = source.data.find((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    return normalize(field(item as Record<string, unknown>, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO", "CONTAINER NUMBER"])) === reference;
  }) as Record<string, unknown> | undefined;
  if (!row) return reply(404, { error: "Shipment not found." }, origin);

  const cached = positionCache.get(reference);
  if (cached && cached.expiresAt > Date.now()) return reply(200, cached.body, origin);

  const apiKey = Deno.env.get("MARINETRAFFIC_API_KEY");
  if (!apiKey || !/^[a-f0-9]{40}$/i.test(apiKey)) {
    return reply(200, { source: "MarineTraffic", status: "not_configured", positions: [], latest: null }, origin);
  }
  const vesselValue = field(row, ["VESSEL NAME", "VESSEL", "VESSEL & VOY"]);
  if (!vesselValue) return reply(200, { source: "MarineTraffic", status: "vessel_missing", positions: [], latest: null }, origin);
  const vesselName = vesselSearchName(vesselValue);
  let imo = field(row, ["IMO", "IMO NO.", "IMO NUMBER"]).replace(/\D/g, "");
  let mmsi = field(row, ["MMSI", "MMSI NO."]).replace(/\D/g, "");
  if (!validIMO(imo)) imo = "";
  if (!validMMSI(mmsi)) mmsi = "";

  if (!imo && !mmsi) {
    const searchUrl = new URL("https://services.marinetraffic.com/api/shipsearch/" + encodeURIComponent(apiKey));
    searchUrl.searchParams.set("shipname", vesselName);
    searchUrl.searchParams.set("shiptype", "7");
    searchUrl.searchParams.set("protocol", "json");
    if (!await consumeProviderSlot(admin, serviceKey, "search")) {
      return reply(200, { source: "MarineTraffic", status: "provider_limit", positions: [], latest: null }, origin);
    }
    let searchResponse: Response;
    try {
      searchResponse = await fetch(searchUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    } catch {
      return reply(200, { source: "MarineTraffic", status: "temporarily_unavailable", positions: [], latest: null }, origin);
    }
    if (searchResponse.status === 429) return reply(200, { source: "MarineTraffic", status: "provider_limit", positions: [], latest: null }, origin);
    if (!searchResponse.ok) return reply(200, { source: "MarineTraffic", status: "temporarily_unavailable", positions: [], latest: null }, origin);
    let searchRaw: unknown;
    try { searchRaw = await searchResponse.json(); } catch {
      return reply(200, { source: "MarineTraffic", status: "temporarily_unavailable", positions: [], latest: null }, origin);
    }
    const searchRows: unknown[] = Array.isArray(searchRaw) ? searchRaw :
      searchRaw && typeof searchRaw === "object" && Array.isArray((searchRaw as Record<string, unknown>).DATA)
        ? (searchRaw as { DATA: unknown[] }).DATA : [];
    const requestedName = normalize(vesselName);
    const exactMatches = searchRows.flatMap((item: unknown) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const name = String(record.SHIPNAME ?? record.shipName ?? "").trim();
      if (!name || normalize(name) !== requestedName) return [];
      const candidateIMO = String(record.IMO ?? record.imo ?? "").replace(/\D/g, "");
      const candidateMMSI = String(record.MMSI ?? record.mmsi ?? "").replace(/\D/g, "");
      const foundIMO = validIMO(candidateIMO) ? candidateIMO : "";
      const foundMMSI = validMMSI(candidateMMSI) ? candidateMMSI : "";
      if (!foundIMO && !foundMMSI) return [];
      return [{ name, imo: foundIMO, mmsi: foundMMSI }];
    });
    const unique = new Map<string, typeof exactMatches[number]>();
    for (const item of exactMatches) unique.set(item.imo || item.mmsi, item);
    const matches = Array.from(unique.values());
    if (matches.length !== 1) {
      return reply(200, { source: "MarineTraffic", status: matches.length ? "ambiguous" : "vessel_not_found", positions: [], latest: null }, origin);
    }
    imo = matches[0].imo;
    mmsi = matches[0].mmsi;
  }

  const trackUrl = new URL("https://services.marinetraffic.com/api/exportvesseltrack/" + encodeURIComponent(apiKey));
  trackUrl.searchParams.set("v", "3");
  trackUrl.searchParams.set("days", "1");
  trackUrl.searchParams.set("msgtype", "simple");
  trackUrl.searchParams.set("protocol", "json");
  trackUrl.searchParams.set(imo ? "imo" : "mmsi", imo || mmsi);
  if (!await consumeProviderSlot(admin, serviceKey, "track")) {
    return reply(200, { source: "MarineTraffic", status: "provider_limit", positions: [], latest: null }, origin);
  }
  let providerResponse: Response;
  try {
    providerResponse = await fetch(trackUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  } catch {
    return reply(200, { source: "MarineTraffic", status: "temporarily_unavailable", positions: [], latest: null }, origin);
  }
  if (!providerResponse.ok) return reply(200, { source: "MarineTraffic", status: providerResponse.status === 429 ? "provider_limit" : "temporarily_unavailable", positions: [], latest: null }, origin);
  let raw: unknown;
  try { raw = await providerResponse.json(); } catch {
    return reply(200, { source: "MarineTraffic", status: "temporarily_unavailable", positions: [], latest: null }, origin);
  }
  const positionData = safePositionData(raw, imo, mmsi);
  const result: Record<string, unknown> = {
    source: "MarineTraffic",
    status: positionData.latest ? "ok" : "no_positions",
    vesselName,
    positions: positionData.positions,
    latest: positionData.latest,
  };
  positionCache.set(reference, { expiresAt: Date.now() + 5 * 60 * 1000, body: result });
  return reply(200, result, origin);
});
