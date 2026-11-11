import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = () => Deno.env.get("CUSTOMER_TRACKING_ALLOWED_ORIGIN") ?? "https://weirdofactory.github.io";
const PHOTO_BUCKET = "logistics-documents";

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
function parseDate(value: string): number | null {
  const s = value.trim();
  if (!s) return null;
  const dmy = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (dmy) {
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    const d = new Date(Date.UTC(year, Number(dmy[2]) - 1, Number(dmy[1])));
    return d.getUTCFullYear() === year && d.getUTCMonth() === Number(dmy[2]) - 1 && d.getUTCDate() === Number(dmy[1]) ? d.getTime() : null;
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}
function validationWarnings(row: Record<string, unknown>): string[] {
  const events = [
    ["Port arrival", field(row, ["PORT IN"])],
    ["Port release", field(row, ["PORT OUT"])],
    ["CFS received", field(row, ["CFS IN"])],
    ["Destuffing", field(row, ["DESTUFFING DATE", "DESTUFF DATE"])],
    ["Empty returned", field(row, ["CONTAINER RETURN DATE", "EMPTY RETURN DATE"])],
  ].map(([label, date]) => ({ label, date, value: parseDate(date) })).filter(item => item.value !== null);
  const warnings: string[] = [];
  for (let i = 1; i < events.length; i++) {
    if (events[i].value! < events[i - 1].value!) {
      warnings.push("Some recorded milestone dates appear out of order. Please confirm them with GML.");
      break;
    }
  }
  const eta = field(row, ["ETA", "ESTIMATED ARRIVAL"]);
  const etaValue = parseDate(eta);
  if (etaValue !== null && events.length && etaValue < Math.max(...events.map(item => item.value!))) {
    warnings.push("The ETA is earlier than a milestone already recorded. Please confirm the arrival date with GML.");
  }
  if (etaValue !== null && etaValue < Date.now() && !field(row, ["PORT IN"])) {
    warnings.push("The recorded ETA has passed and port arrival has not been recorded yet.");
  }
  return warnings;
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
  else if (etd) status = "Departure scheduled";
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
    warnings: validationWarnings(row),
    photos: [] as Array<Record<string, string>>,
    milestones: [
      { label: "Estimated departure", date: etd, estimate: true },
      { label: "Port arrival", date: portIn, estimate: false },
      { label: "Port release", date: portOut, estimate: false },
      { label: "CFS received", date: cfsIn, estimate: false },
      { label: "Destuffing", date: destuffing, estimate: false },
      { label: "Empty returned", date: emptyReturned, estimate: false },
    ],
  };
}
function safeForwardingJob(
  job: Record<string, unknown>,
  containerNo: string,
  events: Record<string, unknown>[],
  hblNoOverride: string | null = null,
) {
  const statusLabels: Record<string, string> = {
    draft: "Job created", booked: "Booking confirmed", origin_handling: "Origin handling",
    departed: "In transit", transshipment: "At transshipment", arrived: "Arrived at destination",
    customs: "Customs clearance", destination_handling: "Destination handling",
    out_for_delivery: "Out for delivery", delivered: "Delivered to consignee",
    closed: "Completed", on_hold: "On hold", cancelled: "Cancelled",
  };
  const milestones = events
    .filter(event => event.status !== "skipped")
    .map(event => ({
      label: field(event, ["milestone_name"]) || String(event.milestone_code || "Shipment update").replace(/_/g, " "),
      date: field(event, ["actual_at"]) || field(event, ["planned_at"]),
      estimate: !field(event, ["actual_at"]) && !!field(event, ["planned_at"]),
    }));
  const generated = [
    ["Vessel departed", field(job, ["actual_departure_at"])],
    ["Vessel arrived destination", field(job, ["actual_arrival_at"])],
    ["Delivered to consignee", field(job, ["delivered_at"])],
  ].filter((event): event is [string, string] => !!event[1])
    .map(([label, date]) => ({ label, date, estimate: false }));
  milestones.push(...generated);
  milestones.sort((a, b) => {
    const av = Date.parse(a.date || "");
    const bv = Date.parse(b.date || "");
    return (Number.isFinite(av) ? av : 0) - (Number.isFinite(bv) ? bv : 0);
  });
  return {
    jobNo: field(job, ["job_no"]),
    hblNo: hblNoOverride === null ? "" : hblNoOverride || field(job, ["hbl_no"]),
    mblNo: field(job, ["mbl_no"]),
    container: containerNo,
    type: field(job, ["service_type"]) || "Shipment",
    status: statusLabels[String(job.status || "")] || "Shipment in progress",
    vessel: [field(job, ["vessel_name"]), field(job, ["voyage_no"])].filter(Boolean).join(" / "),
    shippingLine: field(job, ["carrier"]),
    origin: field(job, ["pol"]),
    transshipmentPort: field(job, ["transshipment_port"]),
    gateway: field(job, ["pod"]),
    etd: field(job, ["etd"]),
    eta: field(job, ["eta"]),
    warnings: [] as string[],
    photos: [] as Array<Record<string, string>>,
    milestones,
  };
}
function safeAirWaybill(
  waybill: Record<string, unknown>,
  job: Record<string, unknown>,
  events: Record<string, unknown>[],
) {
  const snapshot = waybill.hawb_snapshot && typeof waybill.hawb_snapshot === "object"
    ? waybill.hawb_snapshot as Record<string, unknown> : {};
  const frozen = snapshot.waybill && typeof snapshot.waybill === "object"
    ? snapshot.waybill as Record<string, unknown> : waybill;
  const statusLabels: Record<string, string> = {
    planned: "Shipment planned", booked: "Flight booked", cargo_received: "Cargo received",
    departed: "Flight departed", in_transit: "In transit", arrived: "Flight arrived",
    customs: "Customs clearance", delivered: "Delivered", closed: "Completed",
    exception: "Exception reported", cancelled: "Cancelled",
  };
  const milestones = events
    .filter(event => event.customer_visible === true)
    .sort((a, b) => Date.parse(String(a.event_at || "")) - Date.parse(String(b.event_at || "")))
    .map(event => ({
      label: field(event, ["event_name"]) || "Air shipment update",
      date: field(event, ["event_at"]),
      estimate: false,
    }));
  return {
    mode: "air",
    jobNo: field(job, ["job_no"]),
    hblNo: "",
    mblNo: "",
    hawbNo: field(frozen, ["hawb_no"]),
    mawbNo: field(frozen, ["mawb_no"]),
    container: "",
    type: "Air Freight",
    status: statusLabels[String(waybill.status || "")] || "Air shipment in progress",
    vessel: [field(frozen, ["airline"]), field(frozen, ["flight_no"])].filter(Boolean).join(" / "),
    airline: field(frozen, ["airline"]),
    flightNo: field(frozen, ["flight_no"]),
    shippingLine: field(frozen, ["airline"]),
    origin: field(frozen, ["origin_airport"]),
    transshipmentPort: "",
    gateway: field(frozen, ["destination_airport"]),
    etd: field(frozen, ["etd"]),
    eta: field(frozen, ["eta"]),
    pieces: Number(frozen.pieces || 0),
    packageType: field(frozen, ["package_type"]),
    grossWeightKg: Number(frozen.gross_weight_kg || 0),
    volumeCbm: Number(frozen.volume_cbm || 0),
    chargeableWeightKg: Number(frozen.chargeable_weight_kg || 0),
    commodity: field(frozen, ["commodity"]),
    goodsDescription: field(frozen, ["goods_description"]),
    shipper: field(frozen, ["shipper"]),
    consignee: field(frozen, ["consignee"]),
    notifyParty: field(frozen, ["notify_party"]),
    freightTerms: field(frozen, ["freight_terms"]),
    warnings: [] as string[],
    photos: [] as Array<Record<string, string>>,
    milestones,
    updatedAt: field(waybill, ["updated_at"]),
  };
}
function clientAddress(req: Request): string {
  const direct = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip");
  if (direct) return direct.trim().slice(0, 100);
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim().slice(0, 100) : "unknown";
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
  if (reference.length < 4 || reference.length > 40 || !/^[A-Z0-9]+$/.test(reference)) {
    return reply(400, { error: "Enter a valid container, HBL, MBL, HAWB, MAWB or job number." }, origin);
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
    .select("data,updated_at").eq("id", "gml_tracking_records").maybeSingle();
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

  const { data: visibleJobs, error: jobsError } = await admin.from("forwarding_jobs")
    .select("*").eq("customer_visible", true).is("deleted_at", null).order("updated_at", { ascending: false }).limit(2500);
  if (jobsError || !Array.isArray(visibleJobs)) {
    return reply(503, { error: "Tracking service is temporarily unavailable." }, origin);
  }
  const visibleJobIds = visibleJobs.map((job: Record<string, unknown>) => String(job.id || "")).filter(Boolean);
  let visibleHbls: Record<string, unknown>[] = [];
  let jobLinks: Record<string, unknown>[] = [];
  let jobEvents: Record<string, unknown>[] = [];
  let visibleAirWaybills: Record<string, unknown>[] = [];
  // Batch ID filters to keep the PostgREST URL comfortably below gateway limits.
  for (let offset = 0; offset < visibleJobIds.length; offset += 200) {
    const idBatch = visibleJobIds.slice(offset, offset + 200);
    const [hblResult, linksResult, eventsResult, airWaybillResult] = await Promise.all([
      admin.from("forwarding_job_hbls").select("job_id,hbl_no").in("job_id", idBatch).eq("customer_visible", true).limit(10000),
      admin.from("job_container_links").select("job_id,container_no").in("job_id", idBatch).limit(10000),
      admin.from("shipment_milestones")
        .select("job_id,container_no,milestone_code,milestone_name,planned_at,actual_at,status,customer_visible,created_at,photo_path")
        .in("job_id", idBatch).eq("customer_visible", true)
        .order("created_at", { ascending: true }).limit(10000),
      admin.from("air_waybills")
        .select("id,job_id,hawb_no,mawb_no,airline,flight_no,origin_airport,destination_airport,etd,eta,pieces,package_type,gross_weight_kg,volume_cbm,chargeable_weight_kg,commodity,goods_description,shipper,consignee,notify_party,freight_terms,status,customer_visible,hawb_status,hawb_snapshot,updated_at")
        .in("job_id", idBatch).eq("customer_visible", true).eq("hawb_status", "issued").limit(10000),
    ]);
    if (hblResult.error || linksResult.error || eventsResult.error || airWaybillResult.error ||
        !Array.isArray(hblResult.data) || !Array.isArray(linksResult.data) ||
        !Array.isArray(eventsResult.data) || !Array.isArray(airWaybillResult.data)) {
      return reply(503, { error: "Tracking service is temporarily unavailable." }, origin);
    }
    visibleHbls.push(...hblResult.data as Record<string, unknown>[]);
    jobLinks.push(...linksResult.data as Record<string, unknown>[]);
    jobEvents.push(...eventsResult.data as Record<string, unknown>[]);
    visibleAirWaybills.push(...airWaybillResult.data as Record<string, unknown>[]);
  }

  const linksByJob = new Map<string, Record<string, unknown>[]>();
  const eventsByJob = new Map<string, Record<string, unknown>[]>();
  for (const link of jobLinks) {
    const key = String(link.job_id || "");
    const group = linksByJob.get(key) || [];
    group.push(link);
    linksByJob.set(key, group);
  }
  for (const event of jobEvents) {
    const key = String(event.job_id || "");
    const group = eventsByJob.get(key) || [];
    group.push(event);
    eventsByJob.set(key, group);
  }
  const matchedJobs = (visibleJobs as Record<string, unknown>[]).filter(job => {
    const jobMatches = [job.job_no, job.mbl_no].some(value => normalize(value) === reference);
    const hblMatches = visibleHbls.some(h => String(h.job_id) === String(job.id) && normalize(h.hbl_no) === reference);
    const containerMatches = (linksByJob.get(String(job.id)) || []).some(link => normalize(link.container_no) === reference);
    return jobMatches || hblMatches || containerMatches;
  });
  const matchedJobIds = new Set(matchedJobs.map(job => String(job.id || "")));
  const selectedAirWaybills = visibleAirWaybills.filter(row =>
    normalize(row.hawb_no) === reference || normalize(row.mawb_no) === reference || matchedJobIds.has(String(row.job_id || ""))
  );
  const selectedAirIds = selectedAirWaybills.map(row => String(row.id || "")).filter(Boolean);
  let airWaybillEvents: Record<string, unknown>[] = [];
  for (let offset = 0; offset < selectedAirIds.length; offset += 200) {
    const idBatch = selectedAirIds.slice(offset, offset + 200);
    const { data, error } = await admin.from("air_waybill_events")
      .select("air_waybill_id,event_code,event_name,location,event_at,customer_visible")
      .in("air_waybill_id", idBatch).eq("customer_visible", true)
      .order("event_at", { ascending: true }).limit(10000);
    if (error || !Array.isArray(data)) return reply(503, { error: "Tracking service is temporarily unavailable." }, origin);
    airWaybillEvents.push(...data as Record<string, unknown>[]);
  }
  const airEventsByWaybill = new Map<string, Record<string, unknown>[]>();
  for (const event of airWaybillEvents) {
    const key = String(event.air_waybill_id || "");
    const group = airEventsByWaybill.get(key) || [];
    group.push(event);
    airEventsByWaybill.set(key, group);
  }
  const jobsById = new Map((visibleJobs as Record<string, unknown>[]).map(job => [String(job.id || ""), job]));
  const airResults = selectedAirWaybills.map(waybill => {
    const job = jobsById.get(String(waybill.job_id || ""));
    if (!job) return null;
    return safeAirWaybill(waybill, job, airEventsByWaybill.get(String(waybill.id || "")) || []);
  }).filter((item): item is NonNullable<typeof item> => item !== null);
  const jobResults: ReturnType<typeof safeForwardingJob>[] = [];
  for (const job of matchedJobs) {
    const visibleJobHbls = visibleHbls.filter(h => String(h.job_id) === String(job.id));
    const exactHbl = visibleJobHbls.find(h => normalize(h.hbl_no) === reference);
    const displayHbl = exactHbl ? String(exactHbl.hbl_no) : (visibleJobHbls[0] ? String(visibleJobHbls[0].hbl_no) : null);
    const links = linksByJob.get(String(job.id)) || [];
    const matchedByContainer = links.some(link => normalize(link.container_no) === reference);
    const targetContainers = matchedByContainer
      ? links.filter(link => normalize(link.container_no) === reference).map(link => String(link.container_no || ""))
      : links.map(link => String(link.container_no || ""));
    const containers = targetContainers.length ? Array.from(new Set(targetContainers)) : [""];
    for (const containerNo of containers) {
      const events = (eventsByJob.get(String(job.id)) || []).filter(event =>
        (!String(event.container_no || "").trim() || !containerNo || normalize(event.container_no) === normalize(containerNo))
      );
      const shipment = safeForwardingJob(job, containerNo, events, displayHbl);
      const photoEvents = events.filter(event => typeof event.photo_path === "string" && event.photo_path);
      const photos = await Promise.all(photoEvents.slice(0, 8).map(async event => {
        const { data: signed } = await admin.storage.from(PHOTO_BUCKET)
          .createSignedUrl(String(event.photo_path), 600);
        if (!signed?.signedUrl) return null;
        return {
          url: signed.signedUrl,
          milestone: field(event, ["milestone_name"]) || String(event.milestone_code || "Shipment update").replace(/_/g, " "),
          caption: field(event, ["milestone_name"]) || "Shipment status photo",
          createdAt: field(event, ["actual_at"]) || field(event, ["created_at"]),
        };
      }));
      shipment.photos = photos.filter((photo): photo is NonNullable<typeof photo> => photo !== null);
      jobResults.push(shipment);
    }
  }

  const totalMatches = matches.length + jobResults.length + airResults.length;
  const results = [...airResults, ...jobResults, ...matches.map(safeShipment)].slice(0, 12);
  if (results.length) {
    const containerNumbers = Array.from(new Set(results.map(item => normalize(item.container)).filter(Boolean)));
    if (containerNumbers.length) {
      const { data: photoRows } = await admin.from("shipment_photos")
        .select("container_no,milestone,caption,created_at,storage_path")
        .in("container_no", containerNumbers).eq("customer_visible", true)
        .order("created_at", { ascending: false }).limit(containerNumbers.length * 8);
      if (Array.isArray(photoRows) && photoRows.length) {
        const grouped = new Map<string, Array<Record<string, string>>>();
        await Promise.all(photoRows.map(async (photo: Record<string, unknown>) => {
          const { data: signed } = await admin.storage.from(PHOTO_BUCKET).createSignedUrl(String(photo.storage_path), 600);
          if (!signed?.signedUrl) return;
          const key = normalize(photo.container_no);
          const bucket = grouped.get(key) || [];
          if (bucket.length >= 8) return;
          bucket.push({
            url: signed.signedUrl,
            milestone: String(photo.milestone || ""),
            caption: String(photo.caption || ""),
            createdAt: String(photo.created_at || ""),
          });
          grouped.set(key, bucket);
        }));
        for (const item of results) {
          if (item.container) item.photos = grouped.get(normalize(item.container)) || [];
        }
      }
    }
  }
  const updateCandidates = [source.updated_at, ...matchedJobs.map(job => job.updated_at), ...selectedAirWaybills.map(waybill => waybill.updated_at)]
    .filter(value => typeof value === "string" && Number.isFinite(Date.parse(value as string)));
  const sourceUpdatedAt = updateCandidates.length
    ? updateCandidates.sort((a, b) => Date.parse(String(b)) - Date.parse(String(a)))[0]
    : null;
  return reply(200, { results, truncated: totalMatches > results.length, sourceUpdatedAt }, origin);
});
