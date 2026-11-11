import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const normalizeOrigin = (value: string | null) => {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
};
const allowedOrigins = () => {
  const configured = normalizeOrigin(Deno.env.get("CUSTOMER_TRACKING_ALLOWED_ORIGIN"));
  return new Set(["https://weirdofactory.github.io", ...(configured ? [configured] : [])]);
};
const isAllowedOrigin = (origin: string | null) => !!origin && allowedOrigins().has(origin);
const replyHeaders = (origin: string | null) => {
  const h: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, private",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (isAllowedOrigin(origin)) h["Access-Control-Allow-Origin"] = origin!;
  return h;
};
const reply = (status: number, body: Record<string, unknown>, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: replyHeaders(origin) });
const norm = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const text = (v: unknown, max = 240) => String(v ?? "").trim().slice(0, max);
const number = (v: unknown, label: string, min = 0) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw new Error(label + " must be a valid number.");
  return n;
};
const date = (v: unknown) => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const value = String(v).trim();
  const parsed = new Date(value + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(+parsed) || parsed.toISOString().slice(0, 10) !== value) throw new Error("Enter a valid date.");
  return value;
};
const timestamp = (v: unknown) => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const value = String(v).trim();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Enter a valid date and time.");
  return new Date(parsed).toISOString();
};
const optionalNumber = (v: unknown, label: string, min = 0) =>
  v === null || v === undefined || String(v).trim() === "" ? null : number(v, label, min);
const uuid = (v: unknown) => {
  const value = String(v ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error("Invalid record ID.");
  return value;
};
async function sha256Hex(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
const allowed = {
  job: new Set(["Admin", "Editor"]),
  jobOps: new Set(["Admin", "Editor", "Operator"]),
  sailing: new Set(["Admin", "Editor", "Operator"]),
  consolidation: new Set(["Admin", "Editor", "Operator"]),
  transport: new Set(["Admin", "Editor", "Operator"]),
  filing: new Set(["Admin", "Editor", "Operator"]),
  alert: new Set(["Admin", "Editor", "Operator"]),
  finance: new Set(["Admin", "Editor"]),
  staffAdmin: new Set(["Admin"]),
};
function roleCheck(role: string, group: keyof typeof allowed) {
  if (!allowed[group].has(role)) throw new Error("Your staff role cannot make this change.");
}
function val(v: unknown, values: string[], label: string) {
  const value = String(v ?? "");
  if (!values.includes(value)) throw new Error("Invalid " + label + ".");
  return value;
}
function errorMessage(e: unknown) { return String((e as { message?: string })?.message ?? "Request failed").slice(0, 260); }

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    if (origin && !isAllowedOrigin(origin)) return new Response(null, { status: 403, headers: replyHeaders(null) });
    return new Response(null, { status: 204, headers: replyHeaders(origin) });
  }
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" }, origin);
  if (origin && !isAllowedOrigin(origin)) return reply(403, { error: "Forbidden" }, null);
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
  const { data: profile, error: profileError } = await admin.from("staff_profiles")
    .select("display_name, role, is_active").eq("user_id", userData.user.id).maybeSingle();
  if (profileError || !profile || !profile.is_active) return reply(403, { error: "Active staff profile required" }, origin);

  try {
    const { data: rateRows, error: rateError } = await admin.rpc("consume_edge_rate_limit", {
      p_bucket_key: await sha256Hex("logistics-workspace:" + userData.user.id),
      p_window_seconds: 60,
      p_limit: 120,
    });
    if (rateError || !Array.isArray(rateRows) || !rateRows[0]) return reply(503, { error: "Service unavailable" }, origin);
    if (!rateRows[0].allowed) return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429, headers: { ...replyHeaders(origin), "Retry-After": String(rateRows[0].retry_after_seconds || 60) },
    });

    const size = Number(req.headers.get("content-length") || 0);
    if (size > 11_500_000) return reply(413, { error: "Request is too large. Documents are limited to 8 MB." }, origin);
    const payload = await req.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return reply(400, { error: "Invalid request." }, origin);
    const action = String(payload.action ?? "");
    const actorId = userData.user.id;
    const actorEmail = userData.user.email ?? "";

    const recordAudit = async (actionName: string, entity: string, id: string, before: unknown, after: unknown) => {
      const { error } = await admin.from("logistics_module_audit").insert({
        actor_id: actorId, actor_email: actorEmail, action: actionName, entity_type: entity,
        entity_id: id, before_data: before ?? null, after_data: after ?? null,
      });
      if (error) console.error("Module audit write failed:", error.message);
    };

    let containerSet: Set<string> | null = null;
    const assertContainer = async (value: unknown) => {
      const key = norm(value);
      if (!key) throw new Error("Container number is required.");
      if (!containerSet) {
        const { data, error } = await admin.from("containers").select("data").eq("id", "gml_tracking_records").maybeSingle();
        if (error || !Array.isArray(data?.data)) throw new Error("Shipment register could not be verified.");
        containerSet = new Set(data.data.map((row: Record<string, unknown>) => {
          const k = Object.keys(row).find((name) => name.toLowerCase().replace(/[^a-z0-9]/g, "") === "containerno");
          return norm(k ? row[k] : "");
        }).filter(Boolean));
      }
      if (!containerSet.has(key)) throw new Error("That container is not in the current Supabase shipment register.");
      return text(value, 40).toUpperCase();
    };

    const assertJob = async (value: unknown) => {
      if (!value) return null;
      const id = uuid(value);
      const { data, error } = await admin.from("forwarding_jobs").select("id,job_no,hbl_no,mbl_no").eq("id", id).is("deleted_at", null).maybeSingle();
      if (error || !data) throw new Error("Forwarding job not found or it has been deleted.");
      return data;
    };
    const assertJobHbl = async (value: unknown, expectedJobId?: string) => {
      if (!value) return null;
      const id = uuid(value);
      const { data, error } = await admin.from("forwarding_job_hbls").select("*").eq("id", id).maybeSingle();
      if (error || !data) throw new Error("House bill of lading record not found.");
      if (expectedJobId && data.job_id !== expectedJobId) throw new Error("Selected HBL does not belong to this forwarding job.");
      const { data: parent, error: parentError } = await admin.from("forwarding_jobs").select("id").eq("id", data.job_id).is("deleted_at", null).maybeSingle();
      if (parentError || !parent) throw new Error("The forwarding job for this HBL is not active.");
      return data;
    };
    const assertJobContainer = async (jobId: string, containerNo: string) => {
      const { data, error } = await admin.from("job_container_links").select("id")
        .eq("job_id", jobId).eq("container_no", containerNo).maybeSingle();
      if (error || !data) throw new Error("Link this container to the selected forwarding job first.");
    };

    if (action === "listStaffUsers") {
      roleCheck(profile.role, "staffAdmin");
      const [{ data: profiles, error: profilesError }, { data: authUsers, error: authError }] = await Promise.all([
        admin.from("staff_profiles").select("user_id,display_name,role,is_active,created_at").order("created_at", { ascending: false }).limit(500),
        admin.auth.admin.listUsers({ page: 1, perPage: 500 }),
      ]);
      if (profilesError || authError) throw new Error("Could not load staff accounts.");
      const emailById = new Map((authUsers?.users || []).map((u: any) => [u.id, u.email || ""]));
      const users = (profiles || []).map((p: any) => ({ ...p, email: emailById.get(p.user_id) || "" }));
      return reply(200, { users }, origin);
    }

    if (action === "deleteStaffUser") {
      roleCheck(profile.role, "staffAdmin");
      const targetId = uuid(payload.data?.user_id);
      if (targetId === actorId) throw new Error("You cannot delete your own signed-in account.");
      const { data: target, error: targetError } = await admin.from("staff_profiles")
        .select("user_id,display_name,role,is_active").eq("user_id", targetId).maybeSingle();
      if (targetError || !target) throw new Error("Staff account not found.");
      if (target.is_active && target.role === "Admin") {
        const { count, error: countError } = await admin.from("staff_profiles")
          .select("user_id", { count: "exact", head: true }).eq("role", "Admin").eq("is_active", true);
        if (countError) throw new Error("Could not verify active administrator count.");
        if ((count ?? 0) <= 1) throw new Error("The last active Admin account cannot be deleted.");
      }
      const { error: deleteAuthError } = await admin.auth.admin.deleteUser(targetId);
      if (deleteAuthError) throw new Error(deleteAuthError.message || "Could not delete authentication login.");
      const { error: deleteProfileError } = await admin.from("staff_profiles").delete().eq("user_id", targetId);
      if (deleteProfileError) throw new Error("Login was deleted, but the staff profile could not be removed. Contact system support.");
      await recordAudit("delete", "staff_profile", targetId, target, null);
      return reply(200, { deleted: true }, origin);
    }

    if (action === "createStaffUser") {
      roleCheck(profile.role, "staffAdmin");
      const d = payload.data ?? {};
      const email = String(d.email ?? "").trim().toLowerCase();
      const displayName = text(d.display_name, 120);
      const password = String(d.password ?? "");
      const role = val(d.role || "Operator", ["Admin", "Editor", "Operator", "Viewer"], "staff role");
      if (!displayName) throw new Error("Full name is required.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("Enter a valid email address.");
      if (password.length < 8 || password.length > 128) throw new Error("Password must be between 8 and 128 characters.");
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { display_name: displayName },
      });
      if (createError || !created.user) throw new Error(createError?.message || "Could not create login.");
      const { data: staff, error: profileCreateError } = await admin.from("staff_profiles").insert({
        user_id: created.user.id, display_name: displayName, role, is_active: true,
      }).select("user_id,display_name,role,is_active,created_at").single();
      if (profileCreateError || !staff) {
        await admin.auth.admin.deleteUser(created.user.id);
        throw new Error(profileCreateError?.message || "Could not create staff profile. Login creation was rolled back.");
      }
      await recordAudit("create", "staff_profile", created.user.id, null, { ...staff, email });
      return reply(200, { user: { ...staff, email } }, origin);
    }

    if (action === "read") {
      const tables = [
        ["jobContainers", "job_container_links", "created_at"],
        ["milestones", "shipment_milestones", "created_at"],
        ["sailings", "logistics_sailings", "created_at"],
        ["sailingShipments", "sailing_schedule_shipments", "created_at"],
        ["consolidations", "lcl_consolidations", "created_at"],
        ["consolidationItems", "lcl_consolidation_items", "created_at"],
        ["charges", "shipment_charges", "created_at"],
        ["transportDispatches", "transport_dispatches", "created_at"],
        ["filings", "shipment_filings", "created_at"],
        ["documents", "filing_documents", "created_at"],
        ["alertActions", "logistics_alert_actions", "updated_at"],
      ] as const;
      const [results, jobsResult] = await Promise.all([
        Promise.all(tables.map(async ([key, table, orderColumn]) => {
          const { data, error } = await admin.from(table).select("*").order(orderColumn, { ascending: false }).limit(2500);
          if (error) throw new Error("Could not load " + key + ".");
          return [key, data ?? []] as const;
        })),
        admin.from("forwarding_jobs").select("*").is("deleted_at", null).order("created_at", { ascending: false }).limit(2500),
      ]);
      if (jobsResult.error) throw new Error("Could not load forwarding jobs.");
      const jobs = jobsResult.data ?? [];
      const jobIds = jobs.map((job: Record<string, unknown>) => String(job.id));
      let jobHbls: Record<string, unknown>[] = [];
      if (jobIds.length) {
        const { data, error } = await admin.from("forwarding_job_hbls").select("*").in("job_id", jobIds).order("created_at", { ascending: true }).limit(10000);
        if (error) throw new Error("Could not load house bills of lading.");
        jobHbls = data ?? [];
      }
      return reply(200, { ...Object.fromEntries(results), jobs, jobHbls, profile: { displayName: profile.display_name, role: profile.role } }, origin);
    }


    if (action === "listTransportVendors") {
      const { data, error } = await admin.from("vendor_accounts")
        .select("id,vendor_code,legal_name,display_name,is_active").order("legal_name", { ascending: true }).limit(2500);
      if (error) throw new Error("Transport vendors could not be loaded.");
      return reply(200, { vendors: data ?? [] }, origin);
    }

    if (action === "upsertTransportDispatch") {
      roleCheck(profile.role, "transport");
      const d = payload.data ?? {};
      const id = d.id ? uuid(d.id) : undefined;
      let before: Record<string, unknown> | null = null;
      if (id) {
        const result = await admin.from("transport_dispatches").select("*").eq("id", id).maybeSingle();
        if (result.error || !result.data) throw new Error("Transport dispatch not found.");
        before = result.data;
      }
      const job = await assertJob(d.job_id ?? before?.job_id);
      if (!job) throw new Error("Select an active forwarding job.");
      const containerNo = text(d.container_no ?? before?.container_no, 40)
        ? await assertContainer(d.container_no ?? before?.container_no) : null;
      if (containerNo) await assertJobContainer(job.id, containerNo);
      const carrierVendorId = d.carrier_vendor_id ? uuid(d.carrier_vendor_id) : null;
      let carrierVendorLabel = "";
      if (carrierVendorId) {
        const vendorResult = await admin.from("vendor_accounts").select("id,legal_name,display_name,is_active").eq("id", carrierVendorId).maybeSingle();
        if (vendorResult.error || !vendorResult.data) throw new Error("Selected transport vendor account was not found.");
        if (!vendorResult.data.is_active && carrierVendorId !== before?.carrier_vendor_id) throw new Error("Select an active transport vendor.");
        carrierVendorLabel = text(vendorResult.data.display_name || vendorResult.data.legal_name, 180);
      }
      const carrierName = text(d.carrier_name ?? before?.carrier_name, 180) || carrierVendorLabel;
      const movementType = val(d.movement_type || before?.movement_type || "delivery",
        ["pickup","delivery","haulage","empty_return","customs_transfer","other"], "transport movement");
      const status = val(d.status || before?.status || "planned",
        ["planned","assigned","in_transit","completed","exception","cancelled"], "transport status");
      const plannedPickupDate = date(d.planned_pickup_date ?? before?.planned_pickup_date);
      const actualPickupDate = date(d.actual_pickup_date ?? before?.actual_pickup_date);
      const plannedDeliveryDate = date(d.planned_delivery_date ?? before?.planned_delivery_date);
      const actualDeliveryDate = date(d.actual_delivery_date ?? before?.actual_delivery_date);
      if (status === "assigned" && !carrierName &&
          !text(d.vehicle_no ?? before?.vehicle_no, 60) && !text(d.driver_name ?? before?.driver_name, 160)) {
        throw new Error("Add a carrier, vehicle or driver before assigning this move.");
      }
      if (status === "in_transit" && !actualPickupDate) throw new Error("Enter the actual pickup date before marking this move in transit.");
      if (status === "completed" && !(actualDeliveryDate || (movementType === "pickup" && actualPickupDate))) {
        throw new Error("Enter the actual completion date before completing this move.");
      }
      if (before?.status === "completed" && status !== "completed") throw new Error("A completed transport move cannot be reopened.");
      if (before?.status === "cancelled" && status !== "cancelled") throw new Error("A cancelled transport move cannot be reopened; create a new move.");
      const pickupLocation = text(d.pickup_location ?? before?.pickup_location, 240);
      const deliveryLocation = text(d.delivery_location ?? before?.delivery_location, 240);
      if (!pickupLocation && !deliveryLocation) throw new Error("Enter a pickup or delivery location.");
      const row = {
        job_id: job.id, container_no: containerNo, movement_type: movementType, status,
        pickup_location: pickupLocation, delivery_location: deliveryLocation,
        planned_pickup_date: plannedPickupDate, actual_pickup_date: actualPickupDate,
        planned_delivery_date: plannedDeliveryDate, actual_delivery_date: actualDeliveryDate,
        carrier_vendor_id: carrierVendorId, carrier_name: carrierName,
        vehicle_no: text(d.vehicle_no ?? before?.vehicle_no, 60).toUpperCase(),
        driver_name: text(d.driver_name ?? before?.driver_name, 160),
        driver_phone: text(d.driver_phone ?? before?.driver_phone, 60),
        pod_reference: text(d.pod_reference ?? before?.pod_reference, 120),
        instructions: text(d.instructions ?? before?.instructions, 3000),
        notes: text(d.notes ?? before?.notes, 3000),
        updated_by: actorId, updated_at: new Date().toISOString(),
      };
      const result = id
        ? await admin.from("transport_dispatches").update(row).eq("id", id).select("*").single()
        : await admin.from("transport_dispatches").insert({ ...row, created_by: actorId }).select("*").single();
      if (result.error || !result.data) throw new Error(result.error?.message || "Could not save transport dispatch.");
      const saved = result.data;
      await recordAudit(id ? "update" : "create", "transport_dispatch", saved.id, before, saved);
      if (status === "completed") {
        const source = "trn:" + saved.id;
        const milestoneResult = await admin.from("shipment_milestones").select("*")
          .eq("job_id", saved.job_id).eq("source", source).maybeSingle();
        if (milestoneResult.error) throw new Error("Transport dispatch saved, but its shipment event could not be checked.");
        const prior = milestoneResult.data;
        const completedDate = actualDeliveryDate || actualPickupDate;
        const completedAt = new Date(completedDate + "T12:00:00Z").toISOString();
        const plannedAt = plannedDeliveryDate || plannedPickupDate
          ? new Date((plannedDeliveryDate || plannedPickupDate) + "T12:00:00Z").toISOString() : null;
        const event = {
          ...(prior?.id ? { id: prior.id } : {}),
          job_id: saved.job_id, container_no: saved.container_no,
          milestone_code: movementType === "delivery" ? "delivered_to_consignee" : "other",
          milestone_name: movementType === "delivery" ? "Delivery completed" : "Transport " + movementType.replace(/_/g, " ") + " completed",
          location: deliveryLocation || pickupLocation, planned_at: plannedAt, actual_at: completedAt,
          status: "completed", customer_visible: prior?.customer_visible === true,
          source, notes: "", updated_by: actorId, updated_at: new Date().toISOString(),
          ...(!prior?.id ? { created_by: actorId } : {}),
        };
        const eventResult = await admin.from("shipment_milestones").upsert(event).select("*").single();
        if (eventResult.error) throw new Error("Transport dispatch saved, but its shipment event could not be updated.");
        await recordAudit(prior ? "update" : "create", "shipment_milestone", eventResult.data.id, prior, eventResult.data);
      }
      return reply(200, { record: saved }, origin);
    }

    if (action === "uploadTransportPod") {
      roleCheck(profile.role, "transport");
      const dispatchId = uuid(payload.dispatch_id);
      const { data: dispatch, error: dispatchError } = await admin.from("transport_dispatches")
        .select("id,dispatch_no,pod_object_path,pod_document_name").eq("id", dispatchId).maybeSingle();
      if (dispatchError || !dispatch) throw new Error("Transport dispatch not found.");
      const filename = text(payload.filename, 180).replaceAll("/", "_").replaceAll(String.fromCharCode(92), "_");
      const contentType = text(payload.content_type, 120).toLowerCase();
      const extension = contentType === "application/pdf" ? "pdf" : contentType === "image/jpeg" ? "jpg" : contentType === "image/png" ? "png" : "";
      if (!filename || !extension) throw new Error("Upload a PDF, JPG or PNG proof-of-delivery file.");
      const encoded = String(payload.base64 ?? "").replace(/^data:[^,]*;base64,/, "");
      if (!encoded || encoded.length > 11_200_000) throw new Error("POD document exceeds the 8 MB upload limit.");
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      if (!bytes.length || bytes.length > 8_388_608) throw new Error("POD document exceeds the 8 MB upload limit.");
      const objectPath = "transport/" + dispatchId + "/" + crypto.randomUUID() + "." + extension;
      const { error: storageError } = await admin.storage.from("logistics-documents").upload(objectPath, bytes, {
        contentType, cacheControl: "60", upsert: false,
      });
      if (storageError) throw new Error("POD upload failed: " + storageError.message);
      const { data, error } = await admin.from("transport_dispatches").update({
        pod_object_path: objectPath, pod_document_name: filename, pod_content_type: contentType,
        pod_file_size: bytes.length, updated_by: actorId, updated_at: new Date().toISOString(),
      }).eq("id", dispatchId).select("*").single();
      if (error || !data) {
        await admin.storage.from("logistics-documents").remove([objectPath]);
        throw new Error("POD record could not be saved: " + (error?.message || "record not found"));
      }
      if (dispatch.pod_object_path) await admin.storage.from("logistics-documents").remove([dispatch.pod_object_path]);
      await recordAudit("upload_pod", "transport_dispatch", dispatchId, dispatch, {
        dispatch_no: dispatch.dispatch_no, pod_document_name: filename, pod_file_size: bytes.length,
      });
      return reply(200, { record: data }, origin);
    }

    if (action === "upsertForwardingJob") {
      roleCheck(profile.role, "job");
      const d = payload.data ?? {};
      const id = d.id ? uuid(d.id) : undefined;
      const before = id ? (await admin.from("forwarding_jobs").select("*").eq("id", id).maybeSingle()).data : null;
      const jobNo = text(d.job_no, 80);
      if (!jobNo) throw new Error("Job number is required.");
      const packageCount = optionalNumber(d.package_count, "Package count", 1);
      if (packageCount !== null && !Number.isInteger(packageCount)) throw new Error("Package count must be a whole number.");
      const row = {
        ...(id ? { id } : {}),
        job_no: jobNo,
        customer_reference: text(d.customer_reference, 100),
        service_type: val(d.service_type || "FCL", ["FCL","LCL","AIR","OTHER"], "service type"),
        direction: val(d.direction || "import", ["import","export","cross_trade","transshipment"], "shipment direction"),
        status: val(d.status || "draft", ["draft","booked","origin_handling","departed","transshipment","arrived","customs","destination_handling","out_for_delivery","delivered","closed","on_hold","cancelled"], "job status"),
        hbl_no: text(d.hbl_no, 120), mbl_no: text(d.mbl_no, 120), booking_no: text(d.booking_no, 120),
        customer_name: text(d.customer_name, 180), customer_id: d.customer_id ? uuid(d.customer_id) : null, shipper: text(d.shipper, 180),
        consignee: text(d.consignee, 180), notify_party: text(d.notify_party, 180),
        origin_agent: text(d.origin_agent, 180), destination_agent: text(d.destination_agent, 180),
        carrier: text(d.carrier, 120), vessel_name: text(d.vessel_name, 160), voyage_no: text(d.voyage_no, 80),
        pol: text(d.pol, 120), transshipment_port: text(d.transshipment_port, 120),
        pod: text(d.pod, 120), final_delivery_place: text(d.final_delivery_place, 160),
        incoterm: text(d.incoterm, 20).toUpperCase(), commodity: text(d.commodity, 240),
        package_count: packageCount, package_type: text(d.package_type, 80),
        gross_weight_kg: optionalNumber(d.gross_weight_kg, "Gross weight"),
        volume_cbm: optionalNumber(d.volume_cbm, "Volume"),
        cargo_ready_date: date(d.cargo_ready_date), etd: date(d.etd), eta: date(d.eta),
        actual_departure_at: timestamp(d.actual_departure_at), actual_arrival_at: timestamp(d.actual_arrival_at),
        delivered_at: timestamp(d.delivered_at), branch: text(d.branch, 80),
        sales_owner: text(d.sales_owner, 120), operations_owner: text(d.operations_owner, 120),
        customer_visible: d.customer_visible === true || d.customer_visible === "true",
        notes: text(d.notes, 3000), updated_by: actorId, updated_at: new Date().toISOString(),
        ...(!id ? { created_by: actorId } : {}),
      };
      if (row.customer_id) {
        const { data: customer, error: customerError } = await admin.from("customer_accounts").select("id,legal_name,is_active").eq("id", row.customer_id).maybeSingle();
        if (customerError || !customer) throw new Error("Customer account not found.");
        if (!customer.is_active && before?.customer_id !== customer.id) throw new Error("Reactivate this customer account before assigning it to a new job.");
        row.customer_name = customer.legal_name;
      }
      const { data, error } = await admin.from("forwarding_jobs").upsert(row).select("*").single();
      if (error?.code === "23505") throw new Error("That job number is already in use.");
      if (error) throw new Error(error.message);
      const primaryHbl = text(data.hbl_no, 120).toUpperCase();
      if (primaryHbl) {
        const { data: existingHbl, error: existingHblError } = await admin.from("forwarding_job_hbls")
          .select("id").eq("job_id", data.id).eq("hbl_no", primaryHbl).maybeSingle();
        if (existingHblError) throw new Error("Could not verify the primary HBL record.");
        if (!existingHbl) {
          const { error: hblInsertError } = await admin.from("forwarding_job_hbls").insert({
            job_id: data.id, hbl_no: primaryHbl, customer_reference: data.customer_reference,
            shipper: data.shipper, consignee: data.consignee, notify_party: data.notify_party,
            package_count: data.package_count, package_type: data.package_type,
            gross_weight_kg: data.gross_weight_kg, volume_cbm: data.volume_cbm,
            commodity: data.commodity, customer_visible: data.customer_visible,
            notes: data.notes, created_by: actorId, updated_by: actorId,
          });
          if (hblInsertError) throw new Error("Job saved, but the primary HBL record could not be created: " + hblInsertError.message);
        }
      }
      await recordAudit(id ? "update" : "create", "forwarding_job", data.id, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "upsertJobHbl") {
      roleCheck(profile.role, "job");
      const d = payload.data ?? {};
      const jobId = uuid(d.job_id);
      const job = await assertJob(jobId);
      const hblId = d.id ? uuid(d.id) : undefined;
      const before = hblId ? (await admin.from("forwarding_job_hbls").select("*").eq("id", hblId).maybeSingle()).data : null;
      if (hblId && (!before || before.job_id !== jobId)) throw new Error("HBL record does not belong to this forwarding job.");
      const hblNo = text(d.hbl_no, 120).toUpperCase();
      if (!hblNo) throw new Error("HBL number is required.");
      const packageCount = optionalNumber(d.package_count, "HBL package count", 1);
      if (packageCount !== null && !Number.isInteger(packageCount)) throw new Error("HBL package count must be a whole number.");
      const row = {
        ...(hblId ? { id: hblId } : {}), job_id: jobId, hbl_no: hblNo,
        customer_reference: text(d.customer_reference, 100),
        shipper: text(d.shipper, 180), consignee: text(d.consignee, 180), notify_party: text(d.notify_party, 180),
        package_count: packageCount, package_type: text(d.package_type, 80),
        gross_weight_kg: optionalNumber(d.gross_weight_kg, "HBL gross weight"),
        volume_cbm: optionalNumber(d.volume_cbm, "HBL volume"),
        commodity: text(d.commodity, 240),
        customer_visible: d.customer_visible === true || d.customer_visible === "true",
        notes: text(d.notes, 2000), updated_by: actorId, updated_at: new Date().toISOString(),
        ...(!hblId ? { created_by: actorId } : {}),
      };
      const { data, error } = await admin.from("forwarding_job_hbls").upsert(row).select("*").single();
      if (error?.code === "23505") throw new Error("This HBL number is already entered under this forwarding job.");
      if (error) throw new Error(error.message);
      if ((before && before.hbl_no === job.hbl_no) || !job.hbl_no) {
        await admin.from("forwarding_jobs").update({
          hbl_no: data.hbl_no, shipper: data.shipper, consignee: data.consignee, notify_party: data.notify_party,
          package_count: data.package_count, package_type: data.package_type,
          gross_weight_kg: data.gross_weight_kg, volume_cbm: data.volume_cbm, commodity: data.commodity,
          updated_by: actorId, updated_at: new Date().toISOString(),
        }).eq("id", jobId);
      }
      await recordAudit(hblId ? "update" : "create", "forwarding_job_hbl", data.id, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "deleteJobHbl") {
      roleCheck(profile.role, "job");
      const hblId = uuid(payload.id);
      const { data: hbl, error: hblError } = await admin.from("forwarding_job_hbls").select("*").eq("id", hblId).maybeSingle();
      if (hblError || !hbl) throw new Error("HBL record not found.");
      const refs = await Promise.all([
        admin.from("lcl_consolidation_items").select("id", { count: "exact", head: true }).eq("hbl_id", hblId),
        admin.from("shipment_filings").select("id", { count: "exact", head: true }).eq("hbl_id", hblId),
        admin.from("shipment_charges").select("id", { count: "exact", head: true }).eq("hbl_id", hblId),
      ]);
      if (refs.some(x => x.error)) throw new Error("Could not verify whether this HBL is used by other shipment records.");
      if (refs.some(x => (x.count ?? 0) > 0)) throw new Error("This HBL is already used by LCL, customs or charge records. Keep it and edit the details instead.");
      const { error } = await admin.from("forwarding_job_hbls").delete().eq("id", hblId);
      if (error) throw new Error(error.message);
      const { data: parentJob, error: parentError } = await admin.from("forwarding_jobs")
        .select("hbl_no").eq("id", hbl.job_id).maybeSingle();
      if (parentError) throw new Error("HBL was deleted but the job's primary HBL could not be refreshed.");
      if (String(hbl.hbl_no) === String(parentJob?.hbl_no)) {
        const { data: nextHbl, error: nextError } = await admin.from("forwarding_job_hbls")
          .select("*").eq("job_id", hbl.job_id).order("created_at", { ascending: true }).limit(1).maybeSingle();
        if (nextError) throw new Error("HBL was deleted but the next primary HBL could not be selected.");
        const { error: syncError } = await admin.from("forwarding_jobs").update({
          hbl_no: nextHbl?.hbl_no || "", shipper: nextHbl?.shipper || "", consignee: nextHbl?.consignee || "",
          notify_party: nextHbl?.notify_party || "", package_count: nextHbl?.package_count ?? null,
          package_type: nextHbl?.package_type || "", gross_weight_kg: nextHbl?.gross_weight_kg ?? null,
          volume_cbm: nextHbl?.volume_cbm ?? null, commodity: nextHbl?.commodity || "",
          updated_by: actorId, updated_at: new Date().toISOString(),
        }).eq("id", hbl.job_id);
        if (syncError) throw new Error("HBL was deleted but the job's primary HBL could not be refreshed.");
      }
      await recordAudit("delete", "forwarding_job_hbl", hblId, hbl, null);
      return reply(200, { deleted: true }, origin);
    }

    if (action === "deleteForwardingJob") {
      if (profile.role !== "Admin") throw new Error("Only Admin can delete a forwarding job.");
      const jobId = uuid(payload.id);
      const { data: before, error: readError } = await admin.from("forwarding_jobs").select("*").eq("id", jobId).is("deleted_at", null).maybeSingle();
      if (readError || !before) throw new Error("Active forwarding job not found.");
      const now = new Date().toISOString();
      const { data, error } = await admin.from("forwarding_jobs").update({ deleted_at: now, deleted_by: actorId, updated_by: actorId, updated_at: now })
        .eq("id", jobId).is("deleted_at", null).select("*").single();
      if (error) throw new Error(error.message);
      await recordAudit("soft_delete", "forwarding_job", jobId, before, data);
      return reply(200, { deleted: true, recoverable: true }, origin);
    }

    if (action === "deleteJobContainer") {
      if (profile.role !== "Admin") throw new Error("Only Admin can remove a container from a forwarding job.");
      const linkId = uuid(payload.id);
      const { data: before, error: readError } = await admin.from("job_container_links").select("*").eq("id", linkId).maybeSingle();
      if (readError || !before) throw new Error("Forwarding job container link not found.");
      const { error } = await admin.from("job_container_links").delete().eq("id", linkId);
      if (error) throw new Error(error.message);
      await recordAudit("unlink_container", "job_container_link", linkId, before, null);
      return reply(200, { deleted: true, container_retained: true }, origin);
    }

    if (action === "linkJobContainer") {
      roleCheck(profile.role, "jobOps");
      const d = payload.data ?? {};
      const jobId = uuid(d.job_id);
      const containerNo = await assertContainer(d.container_no);
      const { data: job, error: jobError } = await admin.from("forwarding_jobs").select("id").eq("id", jobId).maybeSingle();
      if (jobError || !job) throw new Error("Forwarding job not found.");
      const before = (await admin.from("job_container_links").select("*").eq("job_id", jobId).eq("container_no", containerNo).maybeSingle()).data;
      const packageCount = optionalNumber(d.package_count, "Allocated package count", 1);
      if (packageCount !== null && !Number.isInteger(packageCount)) throw new Error("Allocated package count must be a whole number.");
      const row = {
        job_id: jobId, container_no: containerNo,
        allocation_role: val(d.allocation_role || "primary", ["primary","split","shared"], "container allocation"),
        package_count: packageCount,
        gross_weight_kg: optionalNumber(d.gross_weight_kg, "Allocated gross weight"),
        volume_cbm: optionalNumber(d.volume_cbm, "Allocated volume"),
        notes: text(d.notes, 1200), created_by: before?.created_by || actorId,
      };
      const { data, error } = await admin.from("job_container_links")
        .upsert(row, { onConflict: "job_id,container_no" }).select("*").single();
      if (error) throw new Error(error.message);
      await recordAudit(before ? "update" : "link_container", "job_container_link", data.id, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "upsertShipmentMilestone") {
      roleCheck(profile.role, "jobOps");
      const d = payload.data ?? {};
      const id = d.id ? uuid(d.id) : undefined;
      const jobId = uuid(d.job_id);
      const before = id ? (await admin.from("shipment_milestones").select("*").eq("id", id).maybeSingle()).data : null;
      if (id && (!before || before.job_id !== jobId)) throw new Error("Milestone does not belong to this forwarding job.");
      const containerNo = text(d.container_no, 40) ? await assertContainer(d.container_no) : "";
      if (containerNo) {
        const { data: link, error: linkError } = await admin.from("job_container_links").select("id")
          .eq("job_id", jobId).eq("container_no", containerNo).maybeSingle();
        if (linkError || !link) throw new Error("Link this container to the job before recording a container-level milestone.");
      }
      const milestoneCode = val(d.milestone_code,
        ["booking_confirmed","cargo_received_origin","export_customs_cleared","gate_in_origin","vessel_departed","transshipment_arrived","transshipment_departed","vessel_arrived_destination","port_discharged","import_customs_cleared","port_released","cfs_received","destuffed","out_for_delivery","delivered_to_consignee","empty_returned","other"],
        "milestone");
      const status = val(d.status || "planned", ["planned","completed","skipped","delayed"], "milestone status");
      const plannedAt = timestamp(d.planned_at);
      const actualAt = timestamp(d.actual_at);
      if (status === "completed" && !actualAt) throw new Error("Enter the actual date and time for a completed milestone.");
      const customerVisible = d.customer_visible === true || d.customer_visible === "true";
      if (customerVisible && profile.role === "Operator") throw new Error("Only Admin or Editor roles can publish a customer-visible milestone.");
      const row = {
        ...(id ? { id } : {}), job_id: jobId, container_no: containerNo,
        milestone_code: milestoneCode,
        milestone_name: text(d.milestone_name, 120) || milestoneCode.replace(/_/g, " "),
        location: text(d.location, 160), planned_at: plannedAt, actual_at: actualAt,
        status, customer_visible: customerVisible, source: text(d.source || "manual", 40),
        notes: text(d.notes, 2000), updated_by: actorId, updated_at: new Date().toISOString(),
        ...(!id ? { created_by: actorId } : {}),
      };
      const { data, error } = await admin.from("shipment_milestones").upsert(row).select("*").single();
      if (error) throw new Error(error.message);
      await recordAudit(id ? "update" : "create", "shipment_milestone", data.id, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "upsertSailing") {
      roleCheck(profile.role, "sailing");
      const d = payload.data ?? {};
      const id = d.id ? uuid(d.id) : undefined;
      const before = id ? (await admin.from("logistics_sailings").select("*").eq("id", id).maybeSingle()).data : null;
      const row = {
        ...(id ? { id } : {}),
        carrier: text(d.carrier, 100), vessel_name: text(d.vessel_name, 160),
        voyage_no: text(d.voyage_no, 80), pol: text(d.pol, 120), pod: text(d.pod, 120),
        etd: date(d.etd), eta: date(d.eta), si_cutoff: date(d.si_cutoff), vgm_cutoff: date(d.vgm_cutoff),
        cy_cutoff: date(d.cy_cutoff), document_cutoff: date(d.document_cutoff),
        status: val(d.status || "planned", ["planned","booking_confirmed","in_transit","arrived","cancelled"], "sailing status"),
        notes: text(d.notes, 2000), updated_by: actorId, updated_at: new Date().toISOString(),
        ...(!id ? { created_by: actorId } : {}),
      };
      if (!row.vessel_name) throw new Error("Vessel name is required.");
      const { data, error } = await admin.from("logistics_sailings").upsert(row).select("*").single();
      if (error) throw new Error(error.message);
      await recordAudit(id ? "update" : "create", "sailing", data.id, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "linkSailingShipment") {
      roleCheck(profile.role, "sailing");
      const sailingId = uuid(payload.sailing_id);
      const containerNo = await assertContainer(payload.container_no);
      const { data: sailing, error: sailingError } = await admin.from("logistics_sailings").select("id").eq("id", sailingId).maybeSingle();
      if (sailingError || !sailing) throw new Error("Sailing schedule not found.");
      const { data, error } = await admin.from("sailing_schedule_shipments").insert({ sailing_id: sailingId, container_no: containerNo, created_by: actorId }).select("*").single();
      if (error?.code === "23505") throw new Error("This container is already linked to the sailing.");
      if (error) throw new Error(error.message);
      await recordAudit("link_shipment", "sailing", sailingId, null, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "upsertConsolidation") {
      roleCheck(profile.role, "consolidation");
      const d = payload.data ?? {};
      const id = d.id ? uuid(d.id) : undefined;
      const before = id ? (await admin.from("lcl_consolidations").select("*").eq("id", id).maybeSingle()).data : null;
      const cbm = d.capacity_cbm === "" || d.capacity_cbm == null ? null : number(d.capacity_cbm, "CBM capacity", 0.0001);
      const kg = d.capacity_weight_kg === "" || d.capacity_weight_kg == null ? null : number(d.capacity_weight_kg, "Weight capacity", 0.01);
      if (cbm === null && kg === null) throw new Error("Enter the actual container CBM or weight capacity.");
      if (id) {
        const { data: items, error: itemError } = await admin.from("lcl_consolidation_items").select("gross_weight_kg,volume_cbm").eq("consolidation_id", id);
        if (itemError) throw new Error("Could not verify cargo before changing consolidation capacity.");
        const loaded = (items ?? []).reduce((sum: { kg: number; cbm: number }, item: Record<string, unknown>) => ({ kg: sum.kg + Number(item.gross_weight_kg || 0), cbm: sum.cbm + Number(item.volume_cbm || 0) }), { kg: 0, cbm: 0 });
        if (cbm !== null && loaded.cbm > cbm + 0.0005) throw new Error("New CBM capacity is below the volume already loaded.");
        if (kg !== null && loaded.kg > kg + 0.01) throw new Error("New weight capacity is below the weight already loaded.");
      }
      const row = {
        ...(id ? { id } : {}),
        reference: text(d.reference, 80), origin: text(d.origin, 120), destination: text(d.destination, 120),
        carrier: text(d.carrier, 100), vessel_name: text(d.vessel_name, 160), voyage_no: text(d.voyage_no, 80),
        container_type: text(d.container_type, 80), capacity_cbm: cbm, capacity_weight_kg: kg,
        status: val(d.status || "open", ["planned","open","closed","cancelled"], "consolidation status"),
        etd: date(d.etd), eta: date(d.eta), notes: text(d.notes, 2000), updated_by: actorId, updated_at: new Date().toISOString(),
        ...(!id ? { created_by: actorId } : {}),
      };
      if (!row.reference) throw new Error("Consolidation reference is required.");
      const { data, error } = await admin.from("lcl_consolidations").upsert(row).select("*").single();
      if (error?.code === "23505") throw new Error("That consolidation reference already exists.");
      if (error) throw new Error(error.message);
      await recordAudit(id ? "update" : "create", "consolidation", data.id, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "upsertConsolidationItem") {
      roleCheck(profile.role, "consolidation");
      const d = payload.data ?? {};
      const consolidationId = uuid(d.consolidation_id);
      const itemId = d.id ? uuid(d.id) : undefined;
      const { data: group, error: groupError } = await admin.from("lcl_consolidations").select("*").eq("id", consolidationId).maybeSingle();
      if (groupError || !group) throw new Error("Consolidation not found.");
      if (["closed","cancelled"].includes(group.status)) throw new Error("Cargo cannot be changed in a closed or cancelled consolidation.");
      const before = itemId ? (await admin.from("lcl_consolidation_items").select("*").eq("id", itemId).maybeSingle()).data : null;
      if (itemId && (!before || before.consolidation_id !== consolidationId)) throw new Error("Cargo can only be edited within its existing consolidation.");
      const linkedJob = d.job_id ? await assertJob(d.job_id) : null;
      const linkedHbl = d.hbl_id ? await assertJobHbl(d.hbl_id, linkedJob?.id) : null;
      const linkedJobId = linkedHbl?.job_id ?? linkedJob?.id ?? null;
      const hblNo = text(linkedHbl?.hbl_no || d.hbl_no, 100);
      if (linkedJob && !linkedHbl && norm(linkedJob.hbl_no) !== norm(hblNo)) {
        throw new Error("Select an HBL belonging to the forwarding job.");
      }
      const packageCount = number(d.package_count || 1, "Package count", 1);
      if (!Number.isInteger(packageCount)) throw new Error("Package count must be a whole number.");
      const grossWeight = number(d.gross_weight_kg || 0, "Gross weight");
      const volume = number(d.volume_cbm || 0, "Volume");
      if (grossWeight === 0 && volume === 0) throw new Error("Enter cargo weight or volume to calculate utilization.");
      const { data: priorItems, error: itemsError } = await admin.from("lcl_consolidation_items")
        .select("id,gross_weight_kg,volume_cbm").eq("consolidation_id", consolidationId);
      if (itemsError) throw new Error("Could not verify current consolidation utilization.");
      const totals = (priorItems ?? []).filter((item: Record<string, unknown>) => item.id !== itemId).reduce((acc: { kg: number; cbm: number }, item: Record<string, unknown>) => ({
        kg: acc.kg + Number(item.gross_weight_kg || 0), cbm: acc.cbm + Number(item.volume_cbm || 0),
      }), { kg: 0, cbm: 0 });
      if (group.capacity_cbm && totals.cbm + volume > Number(group.capacity_cbm) + 0.0005) throw new Error("This cargo would exceed the entered CBM capacity.");
      if (group.capacity_weight_kg && totals.kg + grossWeight > Number(group.capacity_weight_kg) + 0.01) throw new Error("This cargo would exceed the entered weight capacity.");
      const row = {
        ...(itemId ? { id: itemId } : {}), consolidation_id: consolidationId, job_id: linkedJobId, hbl_id: linkedHbl?.id ?? null,
        hbl_no: hblNo, shipper: text(d.shipper || linkedHbl?.shipper, 160), consignee: text(d.consignee || linkedHbl?.consignee, 160),
        package_count: packageCount, package_type: text(d.package_type, 80), gross_weight_kg: grossWeight,
        volume_cbm: volume, notes: text(d.notes, 1500), updated_by: actorId, updated_at: new Date().toISOString(),
        ...(!itemId ? { created_by: actorId } : {}),
      };
      if (!row.hbl_no) throw new Error("HBL number is required for each LCL cargo item.");
      const { data, error } = await admin.from("lcl_consolidation_items").upsert(row).select("*").single();
      if (error?.code === "23505") throw new Error("This HBL is already included in a consolidation.");
      if (error) throw new Error(error.message);
      await recordAudit(itemId ? "update" : "create", "consolidation_item", data.id, before, data);
      return reply(200, { record: data }, origin);
    }


    if (action === "upsertCustomer") {
      roleCheck(profile.role, "finance");
      const d = payload.data ?? {};
      const id = d.id ? uuid(d.id) : undefined;
      const before = id ? (await admin.from("customer_accounts").select("*").eq("id", id).maybeSingle()).data : null;
      if (id && !before) throw new Error("Customer account not found.");
      const legalName = text(d.legal_name, 180);
      if (!legalName) throw new Error("Customer legal name is required.");
      const country = text(d.country || "India", 80);
      const gstin = text(d.gstin, 20).toUpperCase();
      if (gstin && /^india$/i.test(country) && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) throw new Error("Enter a valid 15-character GSTIN or leave the tax ID blank.");
      const stateCode = text(d.state_code, 2);
      if (stateCode && !/^\d{2}$/.test(stateCode)) throw new Error("GST state code must contain two digits.");
      const currency = text(d.default_currency || "INR", 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Use a three-letter ISO currency code.");
      const row = {
        ...(id ? { id } : {}),
        customer_code: text(d.customer_code, 40) || before?.customer_code || "CUST-" + crypto.randomUUID().slice(0, 8).toUpperCase(),
        legal_name: legalName, display_name: text(d.display_name, 140), gstin,
        billing_address: text(d.billing_address, 700), city: text(d.city, 120), state: text(d.state, 100),
        state_code: stateCode, postal_code: text(d.postal_code, 20), country,
        contact_name: text(d.contact_name, 140), email: text(d.email, 254).toLowerCase(), phone: text(d.phone, 60), default_currency: currency,
        payment_terms: text(d.payment_terms || "Due within 30 days", 500),
        credit_limit_inr: number(d.credit_limit_inr || 0, "Credit limit", 0),
        is_active: before?.is_active ?? true, notes: text(d.notes, 2000),
        updated_by: actorId, updated_at: new Date().toISOString(),
        ...(!id ? { created_by: actorId } : {}),
      };
      const { data, error } = await admin.from("customer_accounts").upsert(row).select("*").single();
      if (error?.code === "23505") throw new Error("That customer account code is already in use.");
      if (error) throw new Error(error.message);
      await recordAudit(id ? "update" : "create", "customer_account", data.id, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "setCustomerStatus") {
      roleCheck(profile.role, "finance");
      const id = uuid(payload.id);
      const { data: before, error: readError } = await admin.from("customer_accounts").select("*").eq("id", id).maybeSingle();
      if (readError || !before) throw new Error("Customer account not found.");
      const isActive = payload.is_active === true || payload.is_active === "true";
      const { data, error } = await admin.from("customer_accounts").update({
        is_active: isActive, updated_by: actorId, updated_at: new Date().toISOString(),
      }).eq("id", id).select("*").single();
      if (error) throw new Error(error.message);
      await recordAudit(isActive ? "reactivate" : "deactivate", "customer_account", id, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "upsertCustomer") {
      roleCheck(profile.role, "finance");
      const d = payload.data ?? {};
      const id = d.id ? uuid(d.id) : undefined;
      const before = id ? (await admin.from("customer_accounts").select("*").eq("id", id).maybeSingle()).data : null;
      if (id && !before) throw new Error("Customer account not found.");
      const legalName = text(d.legal_name, 180);
      if (!legalName) throw new Error("Customer legal name is required.");
      const country = text(d.country || "India", 80);
      const gstin = text(d.gstin, 20).toUpperCase();
      if (gstin && /^india$/i.test(country) && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) throw new Error("Enter a valid 15-character GSTIN or leave the tax ID blank.");
      const stateCode = text(d.state_code, 2);
      if (stateCode && !/^\d{2}$/.test(stateCode)) throw new Error("GST state code must contain two digits.");
      const currency = text(d.default_currency || "INR", 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Use a three-letter ISO currency code.");
      const row = {
        ...(id ? { id } : {}),
        customer_code: text(d.customer_code, 40) || before?.customer_code || "CUST-" + crypto.randomUUID().slice(0, 8).toUpperCase(),
        legal_name: legalName, display_name: text(d.display_name, 140), gstin,
        billing_address: text(d.billing_address, 700), city: text(d.city, 120), state: text(d.state, 100),
        state_code: stateCode, postal_code: text(d.postal_code, 20), country,
        email: text(d.email, 254).toLowerCase(), phone: text(d.phone, 60), default_currency: currency,
        payment_terms: text(d.payment_terms || "Due within 30 days", 500),
        credit_limit_inr: number(d.credit_limit_inr || 0, "Credit limit", 0),
        is_active: before?.is_active ?? true, notes: text(d.notes, 2000),
        updated_by: actorId, updated_at: new Date().toISOString(),
        ...(!id ? { created_by: actorId } : {}),
      };
      const { data, error } = await admin.from("customer_accounts").upsert(row).select("*").single();
      if (error?.code === "23505") throw new Error("That customer account code is already in use.");
      if (error) throw new Error(error.message);
      await recordAudit(id ? "update" : "create", "customer_account", data.id, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "setCustomerStatus") {
      roleCheck(profile.role, "finance");
      const id = uuid(payload.id);
      const { data: before, error: readError } = await admin.from("customer_accounts").select("*").eq("id", id).maybeSingle();
      if (readError || !before) throw new Error("Customer account not found.");
      const isActive = payload.is_active === true || payload.is_active === "true";
      const { data, error } = await admin.from("customer_accounts").update({
        is_active: isActive, updated_by: actorId, updated_at: new Date().toISOString(),
      }).eq("id", id).select("*").single();
      if (error) throw new Error(error.message);
      await recordAudit(isActive ? "reactivate" : "deactivate", "customer_account", id, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "upsertFreightRateCardDraft") {
      roleCheck(profile.role, "finance");
      const d = payload.data ?? {};
      const cardId = d.id ? uuid(d.id) : null;
      const before = cardId ? (await admin.from("freight_rate_cards").select("*").eq("id", cardId).maybeSingle()).data : null;
      if (cardId && (!before || before.status !== "draft")) throw new Error("Only draft rate cards can be edited.");
      const customerId = d.customer_id ? uuid(d.customer_id) : null;
      const currency = text(d.currency || "INR", 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Use a three-letter ISO currency code.");
      const rawLines = Array.isArray(d.lines) ? d.lines : [];
      if (!rawLines.length || rawLines.length > 50) throw new Error("Add between 1 and 50 rate lines.");
      const lines = rawLines.map((line: Record<string, unknown>) => {
        const description = text(line.description, 240);
        const rate = number(line.unit_rate, "Unit rate", Number.MIN_VALUE);
        const gst = number(line.gst_rate ?? 0, "GST rate", 0);
        if (!description || gst > 100) throw new Error("Check the rate line description and GST rate.");
        return { charge_code: text(line.charge_code || "FREIGHT", 40) || "FREIGHT",
          description, unit: text(line.unit || "shipment", 40) || "shipment", unit_rate: rate, gst_rate: gst };
      });
      const { data, error } = await admin.rpc("save_freight_rate_card_draft", {
        p_card_id: cardId, p_rate_code: text(d.rate_code, 50) || "RATE-" + crypto.randomUUID().slice(0, 8).toUpperCase(),
        p_title: text(d.title, 180), p_customer_id: customerId,
        p_service_type: val(d.service_type || "FCL", ["FCL","LCL","AIR","OTHER"], "service type"),
        p_direction: val(d.direction || "import", ["import","export","cross_trade","transshipment"], "shipment direction"),
        p_origin: text(d.origin, 160), p_destination: text(d.destination, 160), p_carrier: text(d.carrier, 160),
        p_valid_from: date(d.valid_from) || new Date().toISOString().slice(0, 10), p_valid_to: date(d.valid_to),
        p_currency: currency, p_notes: text(d.notes, 3000), p_lines: lines, p_actor: actorId,
      });
      if (error) throw new Error(error.message || "Could not save rate card.");
      await recordAudit(cardId ? "update" : "create", "freight_rate_card", data.id, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "publishFreightRateCard") {
      roleCheck(profile.role, "finance");
      const cardId = uuid(payload.id);
      const before = (await admin.from("freight_rate_cards").select("*").eq("id", cardId).maybeSingle()).data;
      if (!before) throw new Error("Rate card not found.");
      const { data, error } = await admin.rpc("publish_freight_rate_card", { p_card_id: cardId, p_actor: actorId });
      if (error) throw new Error(error.message || "Could not publish rate card.");
      await recordAudit("publish", "freight_rate_card", cardId, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "retireFreightRateCard") {
      roleCheck(profile.role, "finance");
      const cardId = uuid(payload.id);
      const before = (await admin.from("freight_rate_cards").select("*").eq("id", cardId).maybeSingle()).data;
      if (!before) throw new Error("Rate card not found.");
      const { data, error } = await admin.rpc("retire_freight_rate_card", { p_card_id: cardId, p_actor: actorId });
      if (error) throw new Error(error.message || "Could not retire rate card.");
      await recordAudit("retire", "freight_rate_card", cardId, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "deleteFreightRateCardDraft") {
      roleCheck(profile.role, "finance");
      const cardId = uuid(payload.id);
      const { data: before, error: readError } = await admin.from("freight_rate_cards").select("*").eq("id", cardId).maybeSingle();
      if (readError || !before) throw new Error("Rate card not found.");
      if (before.status !== "draft") throw new Error("Only draft rate cards can be deleted.");
      const { error } = await admin.from("freight_rate_cards").delete().eq("id", cardId);
      if (error) throw new Error("Could not delete draft rate card.");
      await recordAudit("delete", "freight_rate_card", cardId, before, null);
      return reply(200, { deleted: true }, origin);
    }

    if (action === "listPayables") {
      roleCheck(profile.role, "finance");
      const [vendorResult, billResult, lineResult, paymentResult] = await Promise.all([
        admin.from("vendor_accounts").select("*").order("legal_name", { ascending: true }).limit(2500),
        admin.from("vendor_bills").select("*").order("bill_date", { ascending: false }).limit(5000),
        admin.from("vendor_bill_lines").select("*").order("line_no", { ascending: true }).limit(20000),
        admin.from("vendor_bill_payments").select("*").order("paid_at", { ascending: false }).limit(10000),
      ]);
      if (vendorResult.error || billResult.error || lineResult.error || paymentResult.error) throw new Error("Supplier accounts and payable bills could not be loaded.");
      return reply(200, { vendors: vendorResult.data ?? [], bills: billResult.data ?? [], lines: lineResult.data ?? [], payments: paymentResult.data ?? [] }, origin);
    }

    if (action === "upsertVendorAccount") {
      roleCheck(profile.role, "finance");
      const d = payload.data ?? {};
      const id = d.id ? uuid(d.id) : undefined;
      const before = id ? (await admin.from("vendor_accounts").select("*").eq("id", id).maybeSingle()).data : null;
      if (id && !before) throw new Error("Supplier account not found.");
      const legalName = text(d.legal_name, 180);
      if (!legalName) throw new Error("Supplier legal name is required.");
      const country = text(d.country || "India", 80);
      const gstin = text(d.gstin, 20).toUpperCase();
      if (gstin && /^india$/i.test(country) && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) throw new Error("Enter a valid 15-character GSTIN or leave the tax ID blank.");
      const stateCode = text(d.state_code, 2);
      if (stateCode && !/^\d{2}$/.test(stateCode)) throw new Error("GST state code must contain two digits.");
      const currency = text(d.default_currency || "INR", 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Use a three-letter ISO currency code.");
      const row = {
        ...(id ? { id, vendor_code: text(d.vendor_code, 40) || before.vendor_code } : { vendor_code: text(d.vendor_code, 40) || "VEN-" + crypto.randomUUID().slice(0, 8).toUpperCase(), created_by: actorId }),
        legal_name: legalName, display_name: text(d.display_name, 180), gstin,
        billing_address: text(d.billing_address, 700), city: text(d.city, 120), state: text(d.state, 100),
        state_code: stateCode, postal_code: text(d.postal_code, 20), country,
        email: text(d.email, 180).toLowerCase(), phone: text(d.phone, 60),
        default_currency: currency, payment_terms: text(d.payment_terms || "Due within 30 days", 80),
        is_active: d.is_active === undefined ? (before?.is_active ?? true) : d.is_active === true || d.is_active === "true",
        notes: text(d.notes, 3000), updated_by: actorId, updated_at: new Date().toISOString(),
      };
      const { data, error } = id
        ? await admin.from("vendor_accounts").update(row).eq("id", id).select("*").single()
        : await admin.from("vendor_accounts").insert(row).select("*").single();
      if (error) throw new Error(error.message || "Could not save supplier account.");
      await recordAudit(id ? "update" : "create", "vendor_account", data.id, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "saveVendorBillDraft") {
      roleCheck(profile.role, "finance");
      const d = payload.data ?? {};
      const billId = d.id ? uuid(d.id) : null;
      const before = billId ? (await admin.from("vendor_bills").select("*").eq("id", billId).maybeSingle()).data : null;
      if (billId && (!before || before.status !== "draft")) throw new Error("Only draft supplier bills can be edited.");
      const vendorId = uuid(d.vendor_id);
      const jobId = d.job_id ? (await assertJob(d.job_id)).id : null;
      const currency = text(d.currency || "INR", 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Use a three-letter ISO currency code.");
      const exchangeRate = number(d.exchange_rate_to_inr ?? 1, "Exchange rate", Number.MIN_VALUE);
      const rawLines = Array.isArray(d.lines) ? d.lines : [];
      if (!rawLines.length || rawLines.length > 50) throw new Error("Add between 1 and 50 supplier bill lines.");
      const lines = rawLines.map((line: Record<string, unknown>) => {
        const quantity = number(line.quantity, "Quantity", Number.MIN_VALUE);
        const unitPrice = number(line.unit_price, "Unit price", Number.MIN_VALUE);
        const gstRate = number(line.gst_rate ?? 0, "GST rate", 0);
        if (gstRate > 100) throw new Error("GST rate cannot exceed 100%.");
        const description = text(line.description, 240);
        if (!description) throw new Error("Every supplier bill line needs a description.");
        return { charge_code: text(line.charge_code || "OTHER", 40) || "OTHER", description,
          hsn_sac: text(line.hsn_sac, 30), quantity, unit: text(line.unit || "service", 40) || "service",
          unit_price: unitPrice, gst_rate: gstRate };
      });
      const { data, error } = await admin.rpc("save_vendor_bill_draft", {
        p_bill_id: billId, p_vendor_id: vendorId, p_job_id: jobId,
        p_supplier_invoice_no: text(d.supplier_invoice_no, 120),
        p_bill_date: date(d.bill_date), p_due_date: date(d.due_date), p_currency: currency,
        p_exchange_rate_to_inr: exchangeRate, p_fx_rate_date: date(d.fx_rate_date),
        p_fx_rate_source: text(d.fx_rate_source, 80),
        p_tax_mode: val(d.tax_mode || "exclusive", ["exclusive","inclusive"], "tax mode"),
        p_supply_type: val(d.supply_type || "intra_state", ["intra_state","inter_state","not_applicable"], "GST supply type"),
        p_notes: text(d.notes, 3000), p_lines: lines, p_actor: actorId,
      });
      if (error) throw new Error(error.message || "Could not save supplier bill.");
      await recordAudit(billId ? "update" : "create", "vendor_bill", data.id, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "postVendorBill") {
      roleCheck(profile.role, "finance");
      const billId = uuid(payload.id);
      const before = (await admin.from("vendor_bills").select("*").eq("id", billId).maybeSingle()).data;
      if (!before) throw new Error("Supplier bill not found.");
      const { data, error } = await admin.rpc("post_vendor_bill", { p_bill_id: billId, p_actor: actorId });
      if (error) throw new Error(error.message || "Could not post supplier bill.");
      await recordAudit("post", "vendor_bill", billId, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "deleteVendorBillDraft") {
      roleCheck(profile.role, "finance");
      const billId = uuid(payload.id);
      const { data: before, error: fetchError } = await admin.from("vendor_bills").select("*").eq("id", billId).maybeSingle();
      if (fetchError || !before) throw new Error("Supplier bill not found.");
      if (before.status !== "draft") throw new Error("Only draft supplier bills can be deleted.");
      const { error } = await admin.from("vendor_bills").delete().eq("id", billId);
      if (error) throw new Error("Could not delete supplier bill draft.");
      await recordAudit("delete", "vendor_bill", billId, before, null);
      return reply(200, { deleted: true }, origin);
    }

    if (action === "recordVendorBillPayment") {
      roleCheck(profile.role, "finance");
      const d = payload.data ?? {};
      const billId = uuid(d.bill_id);
      const before = (await admin.from("vendor_bills").select("*").eq("id", billId).maybeSingle()).data;
      if (!before) throw new Error("Supplier bill not found.");
      const currency = text(d.currency || before.currency, 3).toUpperCase();
      const amount = number(d.amount, "Payment amount", Number.MIN_VALUE);
      const exchangeRate = number(d.exchange_rate_to_inr ?? 1, "Exchange rate", Number.MIN_VALUE);
      const { data, error } = await admin.rpc("record_vendor_bill_payment", {
        p_bill_id: billId, p_paid_at: date(d.paid_at), p_amount: amount, p_currency: currency,
        p_exchange_rate_to_inr: exchangeRate, p_fx_rate_date: date(d.fx_rate_date),
        p_fx_rate_source: text(d.fx_rate_source, 80),
        p_payment_method: val(d.payment_method || "bank_transfer", ["bank_transfer","upi","cash","cheque","card","other"], "payment method"),
        p_bank_reference: text(d.bank_reference, 120), p_notes: text(d.notes, 1000), p_actor: actorId,
      });
      if (error) throw new Error(error.message || "Could not record supplier payment.");
      await recordAudit("payment", "vendor_bill", billId, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "listSales") {
      roleCheck(profile.role, "finance");
      const [enquiryResult, quoteResult, lineResult, customerResult, rateResult, rateLineResult] = await Promise.all([
        admin.from("sales_enquiries").select("*").order("created_at", { ascending: false }).limit(2500),
        admin.from("freight_quotes").select("*").order("created_at", { ascending: false }).limit(2500),
        admin.from("freight_quote_lines").select("*").order("line_no", { ascending: true }).limit(10000),
        admin.from("customer_accounts").select("id,customer_code,legal_name,display_name,is_active,default_currency,email,phone").order("legal_name", { ascending: true }).limit(2500),
        admin.from("freight_rate_cards").select("*").order("created_at", { ascending: false }).limit(2500),
        admin.from("freight_rate_lines").select("*").order("line_no", { ascending: true }).limit(10000),
      ]);
      if (enquiryResult.error || quoteResult.error || lineResult.error || customerResult.error || rateResult.error || rateLineResult.error) throw new Error("Sales enquiries, quotations and rate cards could not be loaded.");
      return reply(200, { enquiries: enquiryResult.data ?? [], quotes: quoteResult.data ?? [], lines: lineResult.data ?? [], customers: customerResult.data ?? [], rateCards: rateResult.data ?? [], rateLines: rateLineResult.data ?? [] }, origin);
    }

    if (action === "upsertSalesEnquiry") {
      roleCheck(profile.role, "finance");
      const d = payload.data ?? {};
      const id = d.id ? uuid(d.id) : undefined;
      const before = id ? (await admin.from("sales_enquiries").select("*").eq("id", id).maybeSingle()).data : null;
      if (id && !before) throw new Error("Sales enquiry not found.");
      const customerId = d.customer_id ? uuid(d.customer_id) : null;
      let customerLegalName = "";
      if (customerId) {
        const { data, error } = await admin.from("customer_accounts").select("id,legal_name,is_active").eq("id", customerId).maybeSingle();
        if (error || !data || !data.is_active) throw new Error("Select an active customer account.");
        customerLegalName = data.legal_name;
      }
      const companyName = text(d.company_name || customerLegalName, 180);
      if (!companyName) throw new Error("Prospect or company name is required.");
      const packageCount = optionalNumber(d.package_count, "Package count", 1);
      if (packageCount !== null && !Number.isInteger(packageCount)) throw new Error("Package count must be a whole number.");
      const row = {
        ...(id ? { id } : { enquiry_no: "ENQ-" + new Date().getUTCFullYear() + "-" + crypto.randomUUID().slice(0, 8).toUpperCase() }),
        customer_id: customerId, company_name: companyName, contact_name: text(d.contact_name, 160),
        email: text(d.email, 180).toLowerCase(), phone: text(d.phone, 60),
        service_type: val(d.service_type || "FCL", ["FCL","LCL","AIR","OTHER"], "service type"),
        direction: val(d.direction || "import", ["import","export","cross_trade","transshipment"], "shipment direction"),
        origin: text(d.origin, 160), destination: text(d.destination, 160), commodity: text(d.commodity, 240),
        package_count: packageCount, gross_weight_kg: optionalNumber(d.gross_weight_kg, "Gross weight"),
        volume_cbm: optionalNumber(d.volume_cbm, "Volume"), cargo_ready_date: date(d.cargo_ready_date),
        follow_up_date: date(d.follow_up_date), notes: text(d.notes, 3000), updated_by: actorId,
        updated_at: new Date().toISOString(), ...(!id ? { created_by: actorId } : {}),
      };
      const { data, error } = id
        ? await admin.from("sales_enquiries").update(row).eq("id", id).select("*").single()
        : await admin.from("sales_enquiries").insert(row).select("*").single();
      if (error) throw new Error(error.message || "Could not save sales enquiry.");
      await recordAudit(id ? "update" : "create", "sales_enquiry", data.id, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "upsertFreightQuote") {
      roleCheck(profile.role, "finance");
      const d = payload.data ?? {};
      const quoteId = d.id ? uuid(d.id) : null;
      const enquiryId = uuid(d.enquiry_id);
      const before = quoteId ? (await admin.from("freight_quotes").select("*").eq("id", quoteId).maybeSingle()).data : null;
      if (quoteId && (!before || before.status !== "draft")) throw new Error("Only draft quotes can be edited.");
      const { data: enquiry, error: enquiryError } = await admin.from("sales_enquiries").select("*").eq("id", enquiryId).maybeSingle();
      if (enquiryError || !enquiry) throw new Error("Sales enquiry not found.");
      const customerId = d.customer_id ? uuid(d.customer_id) : enquiry.customer_id;
      const rateCardId = d.rate_card_id ? uuid(d.rate_card_id) : null;
      if (rateCardId) {
        const { data: rateCard, error: rateError } = await admin.from("freight_rate_cards").select("*").eq("id", rateCardId).maybeSingle();
        if (rateError || !rateCard || rateCard.status !== "published") throw new Error("Selected rate card is not published.");
        const today = new Date().toISOString().slice(0,10);
        if (rateCard.valid_from > today || (rateCard.valid_to && rateCard.valid_to < today)) throw new Error("Selected rate card is outside its validity dates.");
        if (rateCard.service_type !== enquiry.service_type || rateCard.direction !== enquiry.direction ||
          String(rateCard.origin).trim().toLowerCase() !== String(enquiry.origin).trim().toLowerCase() ||
          String(rateCard.destination).trim().toLowerCase() !== String(enquiry.destination).trim().toLowerCase()) throw new Error("Selected rate card does not match this enquiry lane.");
        const effectiveCustomer = customerId || enquiry.customer_id;
        if (rateCard.customer_id && rateCard.customer_id !== effectiveCustomer) throw new Error("Selected rate card belongs to another customer.");
        if (String(rateCard.currency).toUpperCase() !== String(d.currency || "").toUpperCase()) throw new Error("Quote currency must match the selected rate card.");
        const expiry = date(d.valid_until);
        if (rateCard.valid_to && expiry && expiry > rateCard.valid_to) throw new Error("Quote validity cannot extend beyond rate card validity.");
      }
      if (customerId) {
        const { data: customer, error: customerError } = await admin.from("customer_accounts").select("id,is_active").eq("id", customerId).maybeSingle();
        if (customerError || !customer || !customer.is_active) throw new Error("Select an active customer account.");
      }
      const currency = text(d.currency || "INR", 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Use a three-letter ISO currency code.");
      const fxRate = number(d.exchange_rate_to_inr ?? 1, "Exchange rate", Number.MIN_VALUE);
      const taxMode = val(d.tax_mode || "exclusive", ["exclusive","inclusive"], "GST mode");
      const lineInput = Array.isArray(d.lines) ? d.lines : [];
      if (!lineInput.length || lineInput.length > 50) throw new Error("Add between 1 and 50 quote lines.");
      const lines = lineInput.map((line: Record<string, unknown>) => {
        const qty = number(line.quantity, "Quantity", Number.MIN_VALUE);
        const unitPrice = number(line.unit_price, "Unit price", Number.MIN_VALUE);
        const gstRate = number(line.gst_rate ?? 0, "GST rate", 0);
        if (gstRate > 100) throw new Error("GST rate cannot exceed 100%.");
        const description = text(line.description, 240);
        if (!description) throw new Error("Every quote line needs a description.");
        return { charge_code: text(line.charge_code || "FREIGHT", 40) || "FREIGHT", description,
          quantity: qty, unit: text(line.unit || "shipment", 40) || "shipment", unit_price: unitPrice, gst_rate: gstRate };
      });
      const { data, error } = await admin.rpc("save_freight_quote_draft", {
        p_quote_id: quoteId, p_enquiry_id: enquiryId, p_rate_card_id: rateCardId, p_customer_id: customerId, p_currency: currency,
        p_exchange_rate_to_inr: fxRate, p_fx_rate_date: date(d.fx_rate_date),
        p_fx_rate_source: text(d.fx_rate_source, 80), p_tax_mode: taxMode, p_valid_until: date(d.valid_until),
        p_terms: text(d.terms, 3000), p_lines: lines, p_actor: actorId,
      });
      if (error) throw new Error(error.message || "Could not save quote.");
      await recordAudit(quoteId ? "update" : "create", "freight_quote", data.id, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "issueFreightQuote") {
      roleCheck(profile.role, "finance");
      const quoteId = uuid(payload.id);
      const before = (await admin.from("freight_quotes").select("*").eq("id", quoteId).maybeSingle()).data;
      if (!before) throw new Error("Quote not found.");
      const { data, error } = await admin.rpc("issue_freight_quote", { p_quote_id: quoteId, p_actor: actorId });
      if (error) throw new Error(error.message || "Could not issue quote.");
      await recordAudit("issue", "freight_quote", quoteId, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "freightQuoteOutcome") {
      roleCheck(profile.role, "finance");
      const quoteId = uuid(payload.id);
      const outcome = val(payload.data?.outcome, ["accepted","rejected"], "quote outcome");
      const before = (await admin.from("freight_quotes").select("*").eq("id", quoteId).maybeSingle()).data;
      if (!before) throw new Error("Quote not found.");
      const { data, error } = await admin.rpc("set_freight_quote_outcome", { p_quote_id: quoteId, p_outcome: outcome });
      if (error) throw new Error(error.message || "Could not update quote outcome.");
      await recordAudit(outcome, "freight_quote", quoteId, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "convertAcceptedQuote") {
      roleCheck(profile.role, "finance");
      const quoteId = uuid(payload.id);
      const before = (await admin.from("freight_quotes").select("*").eq("id", quoteId).maybeSingle()).data;
      if (!before) throw new Error("Quote not found.");
      const { data, error } = await admin.rpc("convert_accepted_quote_to_job", { p_quote_id: quoteId, p_actor: actorId });
      if (error) throw new Error(error.message || "Could not create a job from this accepted quote.");
      await recordAudit("convert", "freight_quote", quoteId, before, data.quote);
      if (data.job?.id) await recordAudit("create", "forwarding_job", data.job.id, null, data.job);
      return reply(200, data, origin);
    }

    if (action === "listBankReconciliation") {
      roleCheck(profile.role, "finance");
      const [accountResult, transactionResult, receiptResult, invoiceResult, vendorPaymentResult, billResult, vendorResult] = await Promise.all([
        admin.from("finance_bank_accounts").select("*").order("account_label", { ascending: true }).limit(500),
        admin.from("finance_bank_transactions").select("*").order("transaction_date", { ascending: false }).limit(10000),
        admin.from("shipment_invoice_payments").select("id,receipt_number,invoice_id,received_at,amount,currency,amount_inr,payment_method,reference").order("received_at", { ascending: false }).limit(5000),
        admin.from("shipment_invoices").select("id,invoice_number,buyer,customer_id,currency,total").limit(5000),
        admin.from("vendor_bill_payments").select("id,payment_no,bill_id,paid_at,amount,currency,amount_inr,payment_method,bank_reference").order("paid_at", { ascending: false }).limit(10000),
        admin.from("vendor_bills").select("id,ap_number,vendor_id,description,currency,total_amount").limit(5000),
        admin.from("vendor_accounts").select("id,vendor_code,legal_name,display_name").limit(2500),
      ]);
      if ([accountResult, transactionResult, receiptResult, invoiceResult, vendorPaymentResult, billResult, vendorResult].some(r => r.error)) {
        throw new Error("Bank reconciliation data could not be loaded.");
      }
      return reply(200, {
        accounts: accountResult.data ?? [], transactions: transactionResult.data ?? [],
        receipts: receiptResult.data ?? [], invoices: invoiceResult.data ?? [],
        vendorPayments: vendorPaymentResult.data ?? [], bills: billResult.data ?? [], vendors: vendorResult.data ?? [],
      }, origin);
    }

    if (action === "upsertBankAccount") {
      roleCheck(profile.role, "finance");
      const d = payload.data ?? {};
      const id = d.id ? uuid(d.id) : undefined;
      const before = id ? (await admin.from("finance_bank_accounts").select("*").eq("id", id).maybeSingle()).data : null;
      if (id && !before) throw new Error("Bank account not found.");
      const currency = text(d.currency || before?.currency || "INR", 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Use a three-letter ISO currency code.");
      if (before && currency !== before.currency) {
        const { count, error: transactionCountError } = await admin.from("finance_bank_transactions").select("id", { count: "exact", head: true }).eq("bank_account_id", id);
        if (transactionCountError) throw new Error("Could not verify existing bank statement rows.");
        if ((count ?? 0) > 0) throw new Error("Bank account currency is locked after statement rows have been imported.");
      }
      const last4 = text(d.account_last4 ?? before?.account_last4, 20);
      if (last4 && !/^\d{4}$/.test(last4)) throw new Error("Enter only the last four account digits.");
      const openingBalance = Number(d.opening_balance ?? before?.opening_balance ?? 0);
      if (!Number.isFinite(openingBalance)) throw new Error("Opening balance must be a valid number.");
      const row = {
        ...(id ? { id } : {}),
        account_label: text(d.account_label ?? before?.account_label, 120),
        bank_name: text(d.bank_name ?? before?.bank_name, 120),
        account_last4: last4, currency, opening_balance: openingBalance,
        opening_date: date(d.opening_date ?? before?.opening_date) || new Date().toISOString().slice(0, 10),
        is_active: d.is_active === undefined ? (before?.is_active ?? true) : d.is_active === true,
        updated_by: actorId, updated_at: new Date().toISOString(),
        ...(!id ? { created_by: actorId } : {}),
      };
      if (row.account_label.length < 2) throw new Error("Enter an account label.");
      const { data: saved, error } = await admin.from("finance_bank_accounts").upsert(row).select("*").single();
      if (error || !saved) throw new Error("Bank account could not be saved.");
      await recordAudit(id ? "update" : "create", "finance_bank_account", saved.id, before, saved);
      return reply(200, { record: saved }, origin);
    }

    if (action === "importBankStatement") {
      roleCheck(profile.role, "finance");
      const accountId = uuid(payload.bank_account_id);
      const { data: account, error: accountError } = await admin.from("finance_bank_accounts").select("*").eq("id", accountId).maybeSingle();
      if (accountError || !account || !account.is_active) throw new Error("Choose an active bank account.");
      const inputRows = Array.isArray(payload.rows) ? payload.rows : [];
      if (!inputRows.length || inputRows.length > 1000) throw new Error("Import between 1 and 1,000 statement rows at a time.");
      const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
      const occurrences = new Map<string, number>();
      const rows = [];
      for (const raw of inputRows) {
        const d = object(raw);
        const transactionDate = date(d.transaction_date ?? d.date);
        if (!transactionDate) throw new Error("Every statement row needs a valid transaction date.");
        const direction = val(String(d.direction || "").toLowerCase(), ["credit", "debit"], "bank transaction direction");
        const amount = number(d.amount, "Bank transaction amount", 0.0001);
        const currency = text(d.currency || account.currency, 3).toUpperCase();
        if (currency !== account.currency) throw new Error("Every imported row must use the selected account currency (" + account.currency + ").");
        const reference = text(d.bank_reference ?? d.reference, 160);
        const description = text(d.description, 500);
        const canonical = [transactionDate, direction, amount.toFixed(4), currency, reference.toUpperCase(), description.toUpperCase()].join("|");
        const occurrence = occurrences.get(canonical) ?? 0;
        occurrences.set(canonical, occurrence + 1);
        rows.push({
          bank_account_id: accountId, row_fingerprint: await sha256Hex(canonical + "|" + occurrence),
          transaction_date: transactionDate, direction, amount, currency, bank_reference: reference, description,
          imported_by: actorId,
        });
      }
      const { data: imported, error } = await admin.from("finance_bank_transactions")
        .upsert(rows, { onConflict: "bank_account_id,row_fingerprint", ignoreDuplicates: true }).select("id");
      if (error) throw new Error("Bank statement rows could not be imported.");
      const inserted = imported?.length ?? 0, duplicates = rows.length - inserted;
      await recordAudit("import_statement", "finance_bank_account", accountId, null, { rows: rows.length, inserted, duplicates });
      return reply(200, { inserted, duplicates, total: rows.length }, origin);
    }

    if (action === "reconcileBankTransaction") {
      roleCheck(profile.role, "finance");
      const id = uuid(payload.id);
      const matchType = val(payload.match_type, ["receipt", "vendor_payment", "ignore", "unmatch"], "reconciliation action");
      const paymentId = matchType === "receipt" || matchType === "vendor_payment" ? uuid(payload.payment_id) : null;
      const { data: before, error: readError } = await admin.from("finance_bank_transactions").select("*").eq("id", id).maybeSingle();
      if (readError || !before) throw new Error("Bank statement transaction not found.");
      const { data, error } = await admin.rpc("reconcile_finance_bank_transaction", {
        p_transaction_id: id, p_match_type: matchType, p_payment_id: paymentId, p_user_id: actorId,
      });
      if (error) throw new Error(error.message);
      const record = Array.isArray(data) ? data[0] : data;
      await recordAudit(matchType, "finance_bank_transaction", id, before, record);
      return reply(200, { record }, origin);
    }

    if (action === "listShipmentDocuments") {
      roleCheck(profile.role, "filing");
      let query = admin.from("forwarding_shipment_documents").select("*").order("document_date", { ascending: false }).limit(5000);
      if (payload.job_id) query = query.eq("job_id", uuid(payload.job_id));
      const { data, error } = await query;
      if (error) throw new Error("Shipment documents could not be loaded.");
      return reply(200, { documents: data ?? [] }, origin);
    }

    if (action === "upsertShipmentDocument") {
      roleCheck(profile.role, "filing");
      const d = payload.data ?? {};
      const id = d.id ? uuid(d.id) : undefined;
      const before = id ? (await admin.from("forwarding_shipment_documents").select("*").eq("id", id).maybeSingle()).data : null;
      if (id && (!before || before.status !== "draft")) throw new Error("Only a draft shipment document can be edited.");
      const jobId = uuid(d.job_id ?? before?.job_id);
      const job = await assertJob(jobId);
      if (!job) throw new Error("Select an active forwarding job.");
      const hblId = d.hbl_id ? uuid(d.hbl_id) : null;
      if (hblId) await assertJobHbl(hblId, jobId);
      const documentType = val(d.document_type ?? before?.document_type, ["shipping_instructions","pre_alert","arrival_notice","delivery_order"], "shipment document type");
      const documentDate = date(d.document_date ?? before?.document_date);
      if (!documentDate) throw new Error("Document date is required.");
      const recipientName = text(d.recipient_name ?? before?.recipient_name, 160);
      const recipientEmail = text(d.recipient_email ?? before?.recipient_email, 254).toLowerCase();
      if (recipientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) throw new Error("Enter a valid recipient email address.");
      const rawFields = d.fields && typeof d.fields === "object" && !Array.isArray(d.fields) ? d.fields : {};
      const freightStatus = val(rawFields.freight_status ?? before?.fields?.freight_status ?? "not_stated", ["not_stated","prepaid","collect"], "freight status");
      const amountDue = optionalNumber(rawFields.amount_due ?? before?.fields?.amount_due, "Amount due", 0);
      const amountCurrency = text(rawFields.amount_currency ?? before?.fields?.amount_currency ?? "INR", 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(amountCurrency)) throw new Error("Use a three-letter ISO currency code for amount due.");
      const fields = {
        cargo_location: text(rawFields.cargo_location ?? before?.fields?.cargo_location, 200),
        customs_release_reference: text(rawFields.customs_release_reference ?? before?.fields?.customs_release_reference, 120),
        freight_status: freightStatus,
        free_time_until: date(rawFields.free_time_until ?? before?.fields?.free_time_until),
        amount_due: amountDue,
        amount_currency: amountCurrency,
        instructions: text(rawFields.instructions ?? before?.fields?.instructions, 3000),
      };
      const row = {
        ...(id ? { id } : {}), job_id: jobId, hbl_id: hblId, document_type: documentType, status: "draft",
        document_date: documentDate, recipient_name: recipientName, recipient_email: recipientEmail,
        fields, snapshot: null, issued_at: null, updated_by: actorId, updated_at: new Date().toISOString(),
        ...(!id ? { created_by: actorId } : {}),
      };
      const { data: saved, error } = await admin.from("forwarding_shipment_documents").upsert(row).select("*").single();
      if (error || !saved) throw new Error("Shipment document draft could not be saved.");
      await recordAudit(id ? "update_draft" : "create_draft", "forwarding_shipment_document", saved.id, before, saved);
      return reply(200, { record: saved }, origin);
    }

    if (action === "issueShipmentDocument") {
      roleCheck(profile.role, "filing");
      const id = uuid(payload.id);
      const { data: before, error: readError } = await admin.from("forwarding_shipment_documents").select("*").eq("id", id).maybeSingle();
      if (readError || !before) throw new Error("Shipment document not found.");
      if (before.status !== "draft") throw new Error("This shipment document has already been issued.");
      const [{ data: job, error: jobError }, hblResult, containerResult] = await Promise.all([
        admin.from("forwarding_jobs").select("*").eq("id", before.job_id).is("deleted_at", null).maybeSingle(),
        before.hbl_id ? admin.from("forwarding_job_hbls").select("*").eq("id", before.hbl_id).eq("job_id", before.job_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
        admin.from("job_container_links").select("container_no,allocation_role,package_count,gross_weight_kg,volume_cbm").eq("job_id", before.job_id),
      ]);
      if (jobError || !job) throw new Error("The active forwarding job could not be loaded.");
      if (hblResult.error || containerResult.error) throw new Error("HBL or container details could not be loaded.");
      let customerSnapshot: Record<string, unknown> | null = null;
      if (job.customer_id) {
        const { data: customer, error } = await admin.from("customer_accounts").select("legal_name,display_name,gstin,billing_address,city,state,state_code,postal_code,country,email,phone").eq("id", job.customer_id).maybeSingle();
        if (error) throw new Error("Customer details could not be added to the document.");
        if (customer) customerSnapshot = customer;
      }
      const jobKeys = ["job_no","customer_reference","service_type","direction","status","hbl_no","mbl_no","booking_no","customer_name","shipper","consignee","notify_party","origin_agent","destination_agent","carrier","vessel_name","voyage_no","pol","transshipment_port","pod","final_delivery_place","incoterm","commodity","package_count","package_type","gross_weight_kg","volume_cbm","cargo_ready_date","etd","eta","actual_departure_at","actual_arrival_at","branch"];
      const jobSnapshot = Object.fromEntries(jobKeys.map(key => [key, job[key] ?? null]));
      const hbl = hblResult.data;
      const hblSnapshot = hbl ? {
        hbl_no:hbl.hbl_no,customer_reference:hbl.customer_reference,shipper:hbl.shipper,consignee:hbl.consignee,
        notify_party:hbl.notify_party,package_count:hbl.package_count,package_type:hbl.package_type,
        gross_weight_kg:hbl.gross_weight_kg,volume_cbm:hbl.volume_cbm,commodity:hbl.commodity,
      } : null;
      const snapshot = {
        document:{document_number:before.document_number,document_type:before.document_type,document_date:before.document_date,
          recipient_name:before.recipient_name,recipient_email:before.recipient_email,fields:before.fields},
        job:jobSnapshot,hbl:hblSnapshot,containers:containerResult.data??[],customer:customerSnapshot,
      };
      const { data, error } = await admin.rpc("issue_forwarding_shipment_document", {
        p_document_id:id,p_snapshot:snapshot,p_user_id:actorId,
      });
      if (error) throw new Error(error.message);
      const result = Array.isArray(data) ? data[0] : data;
      await recordAudit("issue", "forwarding_shipment_document", id, before, result);
      return reply(200, { record: result }, origin);
    }

    if (action === "deleteDraftShipmentDocument") {
      roleCheck(profile.role, "filing");
      const id = uuid(payload.id);
      const { data: before, error: readError } = await admin.from("forwarding_shipment_documents").select("*").eq("id", id).maybeSingle();
      if (readError || !before) throw new Error("Shipment document not found.");
      if (before.status !== "draft") throw new Error("Issued shipment documents cannot be deleted.");
      const { data: deleted, error } = await admin.from("forwarding_shipment_documents").delete().eq("id", id).eq("status", "draft").select("id").maybeSingle();
      if (error || !deleted) throw new Error("Draft shipment document could not be deleted.");
      await recordAudit("delete_draft", "forwarding_shipment_document", id, before, null);
      return reply(200, { deleted:true }, origin);
    }

    if (action === "listAirWaybills") {
      roleCheck(profile.role, "filing");
      const [waybills, events] = await Promise.all([
        admin.from("air_waybills").select("*").order("created_at", { ascending: false }).limit(2500),
        admin.from("air_waybill_events").select("*").order("event_at", { ascending: false }).limit(10000),
      ]);
      if (waybills.error || events.error) throw new Error("Air waybill records could not be loaded.");
      return reply(200, { airWaybills: waybills.data ?? [], airWaybillEvents: events.data ?? [] }, origin);
    }

    if (action === "upsertAirWaybill") {
      roleCheck(profile.role, "filing");
      const d = payload.data ?? {};
      const id = d.id ? uuid(d.id) : undefined;
      let before: Record<string, any> | null = null;
      if (id) {
        const result = await admin.from("air_waybills").select("*").eq("id", id).maybeSingle();
        if (result.error || !result.data) throw new Error("Air waybill not found.");
        before = result.data;
        if (before.hawb_status !== "draft") throw new Error("Issued HAWBs are locked. Create an amendment record for corrections.");
      }
      const jobId = uuid(d.job_id ?? before?.job_id);
      const { data: job, error: jobError } = await admin.from("forwarding_jobs").select("*").eq("id", jobId).is("deleted_at", null).maybeSingle();
      if (jobError || !job) throw new Error("Select an active forwarding job.");
      if (job.service_type !== "AIR") throw new Error("House air waybills can only be created for Air forwarding jobs.");
      const hawbNo = text(d.hawb_no ?? before?.hawb_no, 40).toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9/-]{2,39}$/.test(hawbNo)) throw new Error("Enter a valid HAWB number (4–40 letters, digits, / or -).");
      const mawbNo = text(d.mawb_no ?? before?.mawb_no, 40).toUpperCase();
      if (mawbNo && !/^[A-Z0-9][A-Z0-9/-]{2,39}$/.test(mawbNo)) throw new Error("Enter a valid MAWB number (4–40 letters, digits, / or -).");
      const originAirport = text(d.origin_airport ?? before?.origin_airport, 3).toUpperCase();
      const destinationAirport = text(d.destination_airport ?? before?.destination_airport, 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(originAirport) || !/^[A-Z]{3}$/.test(destinationAirport)) throw new Error("Use three-letter IATA airport codes for origin and destination.");
      const etd = date(d.etd ?? before?.etd), eta = date(d.eta ?? before?.eta);
      if (etd && eta && eta < etd) throw new Error("ETA cannot be earlier than ETD.");
      const pieces = number(d.pieces ?? before?.pieces ?? 1, "Pieces", 1);
      if (!Number.isInteger(pieces)) throw new Error("Pieces must be a whole number.");
      const grossWeight = number(d.gross_weight_kg ?? before?.gross_weight_kg ?? 0, "Gross weight", 0);
      const volume = number(d.volume_cbm ?? before?.volume_cbm ?? 0, "Volume", 0);
      const divisor = number(d.volumetric_divisor ?? before?.volumetric_divisor ?? 167, "Volumetric divisor", 0.001);
      const chargeableWeight = Math.round(Math.max(grossWeight, volume * divisor) * 1000) / 1000;
      const customerVisible = d.customer_visible === true || d.customer_visible === "true";
      if (customerVisible && profile.role === "Operator") throw new Error("Only Admin or Editor roles can publish a customer-visible HAWB.");
      const row = {
        ...(id ? { id } : {}), job_id: jobId, hawb_no: hawbNo, mawb_no: mawbNo,
        airline: text(d.airline ?? before?.airline, 120), flight_no: text(d.flight_no ?? before?.flight_no, 40).toUpperCase(),
        origin_airport: originAirport, destination_airport: destinationAirport, etd, eta, pieces,
        package_type: text(d.package_type ?? before?.package_type ?? "Packages", 80) || "Packages",
        gross_weight_kg: grossWeight, volume_cbm: volume, volumetric_divisor: divisor,
        chargeable_weight_kg: chargeableWeight,
        commodity: text(d.commodity ?? before?.commodity, 240),
        goods_description: text(d.goods_description ?? before?.goods_description, 3000),
        shipper: text(d.shipper ?? before?.shipper ?? job.shipper, 500),
        consignee: text(d.consignee ?? before?.consignee ?? job.consignee, 500),
        notify_party: text(d.notify_party ?? before?.notify_party ?? job.notify_party, 500),
        freight_terms: val(d.freight_terms ?? before?.freight_terms ?? "prepaid", ["prepaid","collect"], "freight terms"),
        status: before?.status || "planned", hawb_status: "draft", hawb_snapshot: null, hawb_issued_at: null,
        customer_visible: customerVisible, notes: text(d.notes ?? before?.notes, 3000),
        updated_by: actorId, updated_at: new Date().toISOString(),
        ...(!id ? { created_by: actorId } : {}),
      };
      const { data: saved, error } = await admin.from("air_waybills").upsert(row).select("*").single();
      if (error || !saved) throw new Error(error?.message || "Air waybill draft could not be saved.");
      await recordAudit(id ? "update_draft" : "create_draft", "air_waybill", saved.id, before, saved);
      return reply(200, { record: saved }, origin);
    }

    if (action === "issueAirWaybill") {
      roleCheck(profile.role, "filing");
      const id = uuid(payload.id);
      const { data: before, error: readError } = await admin.from("air_waybills").select("*").eq("id", id).maybeSingle();
      if (readError || !before) throw new Error("Air waybill not found.");
      if (before.hawb_status !== "draft") throw new Error("This HAWB has already been issued.");
      const [{ data: job, error: jobError }, customerResult] = await Promise.all([
        admin.from("forwarding_jobs").select("*").eq("id", before.job_id).is("deleted_at", null).maybeSingle(),
        admin.from("customer_accounts").select("legal_name,display_name,gstin,billing_address,city,state,state_code,postal_code,country,email,phone").eq("id", (await admin.from("forwarding_jobs").select("customer_id").eq("id", before.job_id).maybeSingle()).data?.customer_id || "").maybeSingle(),
      ]);
      if (jobError || !job || job.service_type !== "AIR") throw new Error("The active Air forwarding job could not be loaded.");
      if (customerResult.error) throw new Error("Customer details could not be added to the HAWB.");
      const jobKeys = ["job_no","customer_reference","service_type","direction","status","booking_no","customer_name","shipper","consignee","notify_party","carrier","pol","pod","final_delivery_place","incoterm","commodity","package_count","package_type","gross_weight_kg","volume_cbm","cargo_ready_date","etd","eta","branch"];
      const jobSnapshot = Object.fromEntries(jobKeys.map(key => [key, job[key] ?? null]));
      const snapshot = {
        document:{document_number:before.hawb_no,document_type:"house_air_waybill",issued_at:new Date().toISOString()},
        waybill:before,job:jobSnapshot,customer:customerResult.data ?? null,
      };
      const { data, error } = await admin.rpc("issue_air_waybill", {
        p_air_waybill_id:id,p_snapshot:snapshot,p_user_id:actorId,
      });
      if (error) throw new Error(error.message);
      const result = Array.isArray(data) ? data[0] : data;
      await recordAudit("issue", "air_waybill", id, before, result);
      return reply(200, { record: result }, origin);
    }

    if (action === "deleteDraftAirWaybill") {
      roleCheck(profile.role, "filing");
      const id = uuid(payload.id);
      const { data: before, error: readError } = await admin.from("air_waybills").select("*").eq("id", id).maybeSingle();
      if (readError || !before) throw new Error("Air waybill not found.");
      if (before.hawb_status !== "draft") throw new Error("Issued HAWBs cannot be deleted.");
      const { count, error: eventError } = await admin.from("air_waybill_events").select("id", { count: "exact", head: true }).eq("air_waybill_id", id);
      if (eventError || (count ?? 0) > 0) throw new Error("A draft with tracking events cannot be deleted.");
      const { data: deleted, error } = await admin.from("air_waybills").delete().eq("id", id).eq("hawb_status", "draft").select("id").maybeSingle();
      if (error || !deleted) throw new Error("Air waybill draft could not be deleted.");
      await recordAudit("delete_draft", "air_waybill", id, before, null);
      return reply(200, { deleted: true }, origin);
    }

    if (action === "addAirWaybillEvent") {
      roleCheck(profile.role, "jobOps");
      const d = payload.data ?? {};
      const waybillId = uuid(d.air_waybill_id);
      const { data: waybill, error: waybillError } = await admin.from("air_waybills").select("*").eq("id", waybillId).maybeSingle();
      if (waybillError || !waybill) throw new Error("Air waybill not found.");
      const { data: job, error: jobError } = await admin.from("forwarding_jobs").select("id,service_type,deleted_at").eq("id", waybill.job_id).maybeSingle();
      if (jobError || !job || job.deleted_at || job.service_type !== "AIR") throw new Error("The active Air forwarding job could not be verified.");
      const eventCode = val(d.event_code, ["booking_confirmed","cargo_received","flight_departed","flight_arrived","customs_cleared","delivered","exception","other"], "air shipment event");
      const eventAt = timestamp(d.event_at);
      if (!eventAt) throw new Error("Event date and time are required.");
      const customerVisible = d.customer_visible === true || d.customer_visible === "true";
      if (customerVisible && profile.role === "Operator") throw new Error("Only Admin or Editor roles can publish a customer-visible event.");
      const eventNames: Record<string,string> = {
        booking_confirmed:"Booking confirmed",cargo_received:"Cargo received",flight_departed:"Flight departed",
        flight_arrived:"Flight arrived",customs_cleared:"Customs cleared",delivered:"Delivered",
        exception:"Exception",other:text(d.event_name,120),
      };
      const eventName = text(d.event_name,120) || eventNames[eventCode];
      if (!eventName || eventName.length < 2) throw new Error("Event name is required.");
      const row = {
        air_waybill_id:waybillId,event_code:eventCode,event_name:eventName,
        location:text(d.location,160),event_at:eventAt,notes:text(d.notes,1000),
        customer_visible:customerVisible,created_by:actorId,
      };
      const { data: saved, error } = await admin.from("air_waybill_events").insert(row).select("*").single();
      if (error || !saved) throw new Error(error?.message || "Air shipment event could not be saved.");
      const nextStatus: Record<string,string> = {
        booking_confirmed:"booked",cargo_received:"cargo_received",flight_departed:"departed",
        flight_arrived:"arrived",customs_cleared:"customs",delivered:"delivered",exception:"exception",
      };
      const mapped = nextStatus[eventCode];
      const rank: Record<string,number> = {planned:0,booked:1,cargo_received:2,departed:3,in_transit:3,arrived:4,customs:5,delivered:6,closed:7};
      if (mapped && (mapped === "exception" || (rank[mapped] ?? -1) >= (rank[waybill.status] ?? 0))) {
        const { data: updated, error: updateError } = await admin.from("air_waybills").update({status:mapped,updated_by:actorId,updated_at:new Date().toISOString()}).eq("id",waybillId).select("*").single();
        if (updateError || !updated) throw new Error("The event was saved, but the air waybill status could not be updated.");
        await recordAudit("record_event", "air_waybill", waybillId, waybill, updated);
        return reply(200, { record: saved, waybill: updated }, origin);
      }
      await recordAudit("record_event", "air_waybill", waybillId, waybill, waybill);
      return reply(200, { record: saved, waybill }, origin);
    }

    if (action === "listInvoices") {
      roleCheck(profile.role, "finance");
      const [invoiceResult, settingsResult, customerResult, creditResult, paymentResult, chargeLinkResult] = await Promise.all([
        admin.from("shipment_invoices").select("*").order("updated_at", { ascending: false }).limit(1000),
        admin.from("shipment_invoice_settings").select("data").eq("id", "default").maybeSingle(),
        admin.from("customer_accounts").select("*").order("legal_name", { ascending: true }).limit(2500),
        admin.from("shipment_credit_notes").select("*").order("created_at", { ascending: false }).limit(2500),
        admin.from("shipment_invoice_payments").select("*").order("received_at", { ascending: false }).limit(5000),
        admin.from("shipment_invoice_charge_links").select("charge_id,invoice_id").limit(10000),
      ]);
      if (invoiceResult.error || settingsResult.error || customerResult.error || creditResult.error || paymentResult.error || chargeLinkResult.error) throw new Error("Invoice, customer, receivables and source-charge links could not be loaded.");
      return reply(200, { invoices: invoiceResult.data ?? [], settings: settingsResult.data?.data ?? {}, customers: customerResult.data ?? [], creditNotes: creditResult.data ?? [], payments: paymentResult.data ?? [], chargeLinks: chargeLinkResult.data ?? [] }, origin);
    }

    if (action === "upsertInvoice") {
      roleCheck(profile.role, "finance");
      const d = payload.data ?? {};
      const id = d.id ? uuid(d.id) : undefined;
      const before = id ? (await admin.from("shipment_invoices").select("*").eq("id", id).maybeSingle()).data : null;
      if (id && !before) throw new Error("Invoice not found.");
      if (before?.status === "issued") throw new Error("Issued invoices are locked. Create a separate credit or debit note for corrections.");
      let linkedJob = d.job_id ? await assertJob(d.job_id) : null;
      const linkedHbl = d.hbl_id ? await assertJobHbl(d.hbl_id, linkedJob?.id) : null;
      if (linkedHbl && !linkedJob) linkedJob = await assertJob(linkedHbl.job_id);
      const jobId = linkedHbl?.job_id ?? linkedJob?.id ?? null;
      const containerNo = text(d.container_no, 40) ? await assertContainer(d.container_no) : null;
      if (jobId && containerNo) await assertJobContainer(jobId, containerNo);

      const obj = (v: unknown): Record<string, unknown> =>
        v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
      const customerId = d.customer_id ? uuid(d.customer_id) : linkedJob?.customer_id ?? null;
      let account: Record<string, unknown> | null = null;
      if (customerId) {
        const { data, error } = await admin.from("customer_accounts").select("*").eq("id", customerId).maybeSingle();
        if (error || !data) throw new Error("Customer account not found.");
        account = data;
      }
      const s = obj(d.seller), b = obj(d.buyer);
      const seller = {
        name: text(s.name, 180), gstin: text(s.gstin, 20).toUpperCase(), address: text(s.address, 700),
        state: text(s.state, 100), state_code: text(s.state_code, 2), postal_code: text(s.postal_code, 20),
        country: text(s.country || "India", 80), email: text(s.email, 180), phone: text(s.phone, 60),
        bank_name: text(s.bank_name, 140), bank_account: text(s.bank_account, 80),
        ifsc: text(s.ifsc, 30).toUpperCase(), upi: text(s.upi, 120),
      };
      const buyer = account ? {
        name: text(account.legal_name, 180), contact_name: text(account.contact_name, 140), gstin: text(account.gstin, 20).toUpperCase(),
        address: text([account.billing_address, account.city].filter(Boolean).join(", "), 700),
        state: text(account.state, 100), state_code: text(account.state_code, 2),
        postal_code: text(account.postal_code, 20), country: text(account.country || "India", 80), email: text(account.email, 180),
      } : {
        name: text(b.name, 180), contact_name: text(b.contact_name, 140), gstin: text(b.gstin, 20).toUpperCase(), address: text(b.address, 700),
        state: text(b.state, 100), state_code: text(b.state_code, 2), postal_code: text(b.postal_code, 20),
        country: text(b.country || "India", 80), email: text(b.email, 180),
      };
      const invoiceType = val(d.invoice_type, ["tax_invoice", "bill_of_supply", "commercial_invoice"], "invoice type");
      const supplyType = val(d.supply_type, ["intra_state", "inter_state", "export_lut", "export_igst", "not_applicable"], "GST supply type");
      const invoiceDate = date(d.invoice_date);
      if (!invoiceDate) throw new Error("Invoice date is required.");
      const dueDate = date(d.due_date);
      const currency = text(d.currency || account?.default_currency || "INR", 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Use a three-letter ISO currency code.");
      const fx = currency === "INR" ? 1 : number(d.exchange_rate_to_inr, "INR exchange rate", 0.000001);
      const fxDate = date(d.fx_date);
      const fxSource = text(currency === "INR" ? "INR base currency" : d.fx_source || "Manual override", 120);
      const rawLines = Array.isArray(d.lines) ? d.lines : [];
      if (!rawLines.length || rawLines.length > 50) throw new Error("Add between 1 and 50 invoice lines.");
      const sourceChargeIds = Array.from(new Set<string>(rawLines.flatMap((raw: unknown) => {
        const sourceId = text(obj(raw).source_charge_id, 80);
        return sourceId ? [uuid(sourceId)] : [];
      })));
      const sourceChargesById = new Map<string, Record<string, unknown>>();
      if (sourceChargeIds.length) {
        if (!jobId) throw new Error("Select a forwarding job for invoice lines loaded from shipment charges.");
        const [sourceChargeResult, existingLinkResult] = await Promise.all([
          admin.from("shipment_charges").select("id,job_id,direction,approval_status").in("id", sourceChargeIds),
          admin.from("shipment_invoice_charge_links").select("charge_id").in("charge_id", sourceChargeIds),
        ]);
        if (sourceChargeResult.error || existingLinkResult.error) throw new Error("Selected shipment charges could not be verified.");
        if ((sourceChargeResult.data ?? []).length !== sourceChargeIds.length) throw new Error("A selected shipment charge no longer exists.");
        for (const charge of sourceChargeResult.data ?? []) {
          if (charge.job_id !== jobId || charge.direction !== "revenue" || charge.approval_status !== "approved") {
            throw new Error("Invoice source lines must be approved revenue charges from the selected job.");
          }
          sourceChargesById.set(charge.id, charge);
        }
        if ((existingLinkResult.data ?? []).length) throw new Error("A selected revenue charge has already been invoiced.");
      }
      const taxApplies = invoiceType === "tax_invoice" && supplyType !== "export_lut";
      const reverseCharge = d.reverse_charge === true || d.reverse_charge === "true";
      const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
      let subtotal = 0, discountTotal = 0, taxableValue = 0, cgstTotal = 0, sgstTotal = 0, igstTotal = 0;
      const lines = rawLines.map((raw: unknown, index: number) => {
        const line = obj(raw);
        const description = text(line.description, 240);
        if (!description) throw new Error("Description is required for invoice line " + (index + 1) + ".");
        const hsnSac = text(line.hsn_sac, 20);
        if (invoiceType !== "commercial_invoice" && !hsnSac) throw new Error("Enter an HSN/SAC code for invoice line " + (index + 1) + ".");
        const quantity = number(line.quantity, "Quantity on line " + (index + 1), 0.000001);
        const unit = text(line.unit || "service", 30);
        const sourceChargeId = text(line.source_charge_id, 80) ? uuid(text(line.source_charge_id, 80)) : null;
        if (sourceChargeId && !sourceChargesById.has(sourceChargeId)) throw new Error("Invoice source charge is not valid for this job.");
        const unitPrice = number(line.unit_price, "Unit price on line " + (index + 1), 0);
        const discountPercent = number(line.discount_percent ?? 0, "Discount on line " + (index + 1), 0);
        if (discountPercent > 100) throw new Error("Line discount cannot exceed 100%.");
        const rawRate = text(line.gst_rate, 12);
        if (taxApplies && rawRate === "") throw new Error("Enter the GST rate for invoice line " + (index + 1) + ".");
        const gstRate = taxApplies ? number(rawRate || 0, "GST rate on line " + (index + 1), 0) : 0;
        if (gstRate > 100) throw new Error("GST rate cannot exceed 100%.");
        const gross = round2(quantity * unitPrice);
        const discount = round2(gross * discountPercent / 100);
        const taxable = round2(gross - discount);
        const tax = round2(taxable * gstRate / 100);
        let cgst = 0, sgst = 0, igst = 0;
        if (supplyType === "intra_state") { cgst = round2(tax / 2); sgst = round2(tax - cgst); }
        else if (supplyType === "inter_state" || supplyType === "export_igst") igst = tax;
        subtotal += gross; discountTotal += discount; taxableValue += taxable;
        cgstTotal += cgst; sgstTotal += sgst; igstTotal += igst;
        return { description, hsn_sac: hsnSac, quantity, unit, unit_price: unitPrice,
          ...(sourceChargeId ? { source_charge_id: sourceChargeId } : {}),
          discount_percent: discountPercent, discount_amount: discount, taxable_value: taxable,
          gst_rate: gstRate, cgst_amount: cgst, sgst_amount: sgst, igst_amount: igst,
          tax_amount: tax, line_total: round2(taxable + (reverseCharge ? 0 : tax)) };
      });
      subtotal = round2(subtotal); discountTotal = round2(discountTotal); taxableValue = round2(taxableValue);
      cgstTotal = round2(cgstTotal); sgstTotal = round2(sgstTotal); igstTotal = round2(igstTotal);
      const totalTax = round2(cgstTotal + sgstTotal + igstTotal);
      const adjustmentRaw = Number(d.adjustment ?? 0);
      if (!Number.isFinite(adjustmentRaw) || Math.abs(adjustmentRaw) > 1000000) throw new Error("Invoice adjustment must be a valid amount.");
      const adjustment = round2(adjustmentRaw);
      const total = round2(taxableValue + (reverseCharge ? 0 : totalTax) + adjustment);
      if (total < 0) throw new Error("Invoice total cannot be negative.");
      const row = {
        ...(id ? { id } : {}), invoice_number: null, status: "draft", invoice_type: invoiceType,
        invoice_date: invoiceDate, due_date: dueDate, job_id: jobId, hbl_id: linkedHbl?.id ?? null,
        container_no: containerNo, customer_id: customerId, seller, buyer, supply_type: supplyType,
        place_of_supply: text(d.place_of_supply || account?.state || account?.city, 160), place_of_supply_state_code: text(d.place_of_supply_state_code || account?.state_code, 2),
        reverse_charge: reverseCharge,
        po_number: text(d.po_number, 120), payment_terms: text(d.payment_terms || account?.payment_terms, 500),
        currency, exchange_rate_to_inr: fx, fx_date: fxDate, fx_source: fxSource, lines,
        subtotal, discount_total: discountTotal, taxable_value: taxableValue, cgst_total: cgstTotal,
        sgst_total: sgstTotal, igst_total: igstTotal, total_tax: totalTax, adjustment, total,
        total_inr: round2(total * fx), notes: text(d.notes, 2000), issued_at: null,
        updated_by: actorId, updated_at: new Date().toISOString(),
        ...(!id ? { created_by: actorId } : {}),
      };
      const issueNow = d.save_status === "issue";
      if (issueNow) {
        if (!dueDate) throw new Error("Enter a payment due date before issuing.");
        if (!seller.name || !seller.address) throw new Error("Complete the seller legal name and registered address before issuing.");
        if (invoiceType === "tax_invoice" && (!/^[0-9]{2}[A-Z0-9]{13}$/.test(seller.gstin) || !seller.state || !/^\d{2}$/.test(seller.state_code))) throw new Error("Enter the seller’s 15-character GSTIN, state and two-digit state code.");
        if (!buyer.name || !buyer.address || !buyer.country || !row.place_of_supply) throw new Error("Complete the bill-to name, address, country and place of supply before issuing.");
        if (invoiceType === "tax_invoice") {
          if (supplyType === "intra_state" && (!/^\d{2}$/.test(row.place_of_supply_state_code) || row.place_of_supply_state_code !== seller.state_code)) throw new Error("For intra-state GST, the place-of-supply state code must match the seller state code.");
          if (supplyType === "inter_state" && (!/^\d{2}$/.test(row.place_of_supply_state_code) || row.place_of_supply_state_code === seller.state_code)) throw new Error("For inter-state GST, use a place-of-supply state code different from the seller state code.");
          if (!["intra_state", "inter_state", "export_lut", "export_igst"].includes(supplyType)) throw new Error("Choose an intra-state, inter-state or export GST treatment before issuing.");
          if (["export_lut", "export_igst"].includes(supplyType) && /^india$/i.test(buyer.country)) throw new Error("Choose an export GST treatment only for a recipient outside India.");
          if (!["export_lut", "export_igst"].includes(supplyType) && !/^india$/i.test(buyer.country)) throw new Error("Choose an export GST treatment for a recipient outside India.");
          if (lines.some((line: Record<string, unknown>) => !line.hsn_sac)) throw new Error("Each GST invoice line needs an HSN/SAC code.");
        }
      }
      const { data: saved, error } = await admin.from("shipment_invoices").upsert(row).select("*").single();
      if (error) throw new Error(error.message);
      if (profile.role === "Admin") {
        const { error: settingsError } = await admin.from("shipment_invoice_settings").upsert({
          id: "default", data: seller, updated_by: actorId, updated_at: new Date().toISOString(),
        });
        if (settingsError) throw new Error("Invoice saved but seller defaults could not be updated.");
      }
      let result = saved;
      if (issueNow) {
        const { data: issued, error: issueError } = await admin.rpc("issue_shipment_invoice", {
          p_invoice_id: saved.id, p_user_id: actorId,
        });
        if (issueError) throw new Error(issueError.message);
        result = Array.isArray(issued) ? issued[0] : issued;
      }
      await recordAudit(issueNow ? "issue" : (id ? "update" : "create"), "shipment_invoice", saved.id, before, result);
      return reply(200, { record: result }, origin);
    }

    if (action === "issueInvoice") {
      roleCheck(profile.role, "finance");
      const id = uuid(payload.id);
      const { data: invoice, error: readError } = await admin.from("shipment_invoices").select("*").eq("id", id).maybeSingle();
      if (readError || !invoice) throw new Error("Invoice not found.");
      if (invoice.status !== "draft") throw new Error("Only a draft invoice can be issued.");
      if (!invoice.due_date) throw new Error("Enter a payment due date before issuing.");
      const seller = invoice.seller && typeof invoice.seller === "object" ? invoice.seller : {};
      const buyer = invoice.buyer && typeof invoice.buyer === "object" ? invoice.buyer : {};
      if (!seller.name || !seller.address) throw new Error("Complete the seller legal name and registered address before issuing.");
      if (invoice.invoice_type === "tax_invoice" && (!/^[0-9]{2}[A-Z0-9]{13}$/.test(String(seller.gstin || "")) || !seller.state || !/^\d{2}$/.test(String(seller.state_code || "")))) throw new Error("Enter the seller’s 15-character GSTIN, state and two-digit state code.");
      if (!buyer.name || !buyer.address || !buyer.country || !invoice.place_of_supply) throw new Error("Complete bill-to details and place of supply before issuing.");
      if (invoice.invoice_type === "tax_invoice") {
        if (invoice.supply_type === "intra_state" && (!/^\d{2}$/.test(String(invoice.place_of_supply_state_code || "")) || invoice.place_of_supply_state_code !== seller.state_code)) throw new Error("For intra-state GST, the place-of-supply state code must match the seller state code.");
        if (invoice.supply_type === "inter_state" && (!/^\d{2}$/.test(String(invoice.place_of_supply_state_code || "")) || invoice.place_of_supply_state_code === seller.state_code)) throw new Error("For inter-state GST, use a place-of-supply state code different from the seller state code.");
        if (!["intra_state", "inter_state", "export_lut", "export_igst"].includes(invoice.supply_type)) throw new Error("Choose an intra-state, inter-state or export GST treatment before issuing.");
        if (["export_lut", "export_igst"].includes(invoice.supply_type) && /^india$/i.test(String(buyer.country))) throw new Error("Choose an export GST treatment only for a recipient outside India.");
        if (!["export_lut", "export_igst"].includes(invoice.supply_type) && !/^india$/i.test(String(buyer.country))) throw new Error("Choose an export GST treatment for a recipient outside India.");
        if (Array.isArray(invoice.lines) && invoice.lines.some((line: Record<string, unknown>) => !line.hsn_sac)) throw new Error("Each GST invoice line needs an HSN/SAC code.");
      }
      const { data: issued, error: issueError } = await admin.rpc("issue_shipment_invoice", {
        p_invoice_id: id, p_user_id: actorId,
      });
      if (issueError) throw new Error(issueError.message);
      const result = Array.isArray(issued) ? issued[0] : issued;
      await recordAudit("issue", "shipment_invoice", id, invoice, result);
      return reply(200, { record: result }, origin);
    }

    if (action === "deleteDraftInvoice") {
      roleCheck(profile.role, "finance");
      const id = uuid(payload.id);
      const { data: before, error: readError } = await admin.from("shipment_invoices").select("*").eq("id", id).maybeSingle();
      if (readError || !before) throw new Error("Invoice not found.");
      if (before.status !== "draft") throw new Error("Issued invoices cannot be deleted. Create a credit note instead.");
      const { data: deleted, error } = await admin.from("shipment_invoices").delete().eq("id", id).eq("status", "draft").select("id").maybeSingle();
      if (error || !deleted) throw new Error("Draft invoice could not be deleted.");
      await recordAudit("delete_draft", "shipment_invoice", id, before, null);
      return reply(200, { deleted: true }, origin);
    }

    if (action === "upsertCreditNote") {
      roleCheck(profile.role, "finance");
      const d = payload.data ?? {};
      const id = d.id ? uuid(d.id) : undefined;
      const invoiceId = uuid(d.invoice_id);
      const { data: invoice, error: invoiceError } = await admin.from("shipment_invoices").select("*").eq("id", invoiceId).maybeSingle();
      if (invoiceError || !invoice || invoice.status !== "issued") throw new Error("Select an issued invoice for the credit note.");
      const before = id ? (await admin.from("shipment_credit_notes").select("*").eq("id", id).maybeSingle()).data : null;
      if (id && (!before || before.status !== "draft" || before.invoice_id !== invoiceId)) throw new Error("Only a draft credit note for this invoice can be edited.");
      const creditDate = date(d.credit_date);
      if (!creditDate) throw new Error("Credit-note date is required.");
      const reason = text(d.reason, 1000);
      if (!reason) throw new Error("Enter the reason for this credit note.");
      const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
      const originalLines = Array.isArray(invoice.lines) ? invoice.lines as Record<string, unknown>[] : [];
      const requested = Array.isArray(d.lines) ? d.lines : [];
      if (!requested.length || requested.length > originalLines.length) throw new Error("Choose at least one original invoice line to credit.");
      const { data: priorNotes, error: priorError } = await admin.from("shipment_credit_notes").select("lines").eq("invoice_id", invoiceId).eq("status", "issued");
      if (priorError) throw new Error("Could not verify earlier credit notes.");
      const used = new Map<number, number>();
      for (const note of priorNotes ?? []) for (const line of (Array.isArray(note.lines) ? note.lines : []) as Record<string, unknown>[]) {
        const index = Number(line.original_line_index);
        if (Number.isInteger(index)) used.set(index, (used.get(index) ?? 0) + Number(line.quantity || 0));
      }
      const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
      const taxApplies = invoice.invoice_type === "tax_invoice" && invoice.supply_type !== "export_lut";
      const reverseCharge = invoice.reverse_charge === true;
      const seen = new Set<number>();
      let subtotal = 0, discountTotal = 0, taxableValue = 0, cgstTotal = 0, sgstTotal = 0, igstTotal = 0;
      const lines = requested.map((raw: unknown) => {
        const item = obj(raw), index = Number(item.original_line_index);
        if (!Number.isInteger(index) || index < 0 || index >= originalLines.length || seen.has(index)) throw new Error("Credit each original invoice line once.");
        seen.add(index);
        const source = obj(originalLines[index]);
        const quantity = number(item.quantity, "Credit quantity", 0.000001);
        const available = Number(source.quantity || 0) - (used.get(index) ?? 0);
        if (quantity > available + 0.000001) throw new Error("Credit quantity exceeds the uncredited quantity on line " + (index + 1) + ".");
        const gross = round2(quantity * Number(source.unit_price || 0));
        const discountPercent = Number(source.discount_percent || 0);
        const discount = round2(gross * discountPercent / 100), taxable = round2(gross - discount);
        const gstRate = taxApplies ? Number(source.gst_rate || 0) : 0;
        const tax = round2(taxable * gstRate / 100);
        let cgst = 0, sgst = 0, igst = 0;
        if (invoice.supply_type === "intra_state") { cgst = round2(tax / 2); sgst = round2(tax - cgst); }
        else if (invoice.supply_type === "inter_state" || invoice.supply_type === "export_igst") igst = tax;
        subtotal += gross; discountTotal += discount; taxableValue += taxable;
        cgstTotal += cgst; sgstTotal += sgst; igstTotal += igst;
        return {
          original_line_index: index, description: text(source.description, 240), hsn_sac: text(source.hsn_sac, 20),
          quantity, unit: text(source.unit || "service", 30), unit_price: Number(source.unit_price || 0),
          discount_percent: discountPercent, discount_amount: discount, taxable_value: taxable,
          gst_rate: gstRate, cgst_amount: cgst, sgst_amount: sgst, igst_amount: igst,
          tax_amount: tax, line_total: round2(taxable + (reverseCharge ? 0 : tax)),
        };
      });
      subtotal = round2(subtotal); discountTotal = round2(discountTotal); taxableValue = round2(taxableValue);
      cgstTotal = round2(cgstTotal); sgstTotal = round2(sgstTotal); igstTotal = round2(igstTotal);
      const totalTax = round2(cgstTotal + sgstTotal + igstTotal);
      const originalTaxable = Number(invoice.taxable_value || 0);
      const adjustment = round2(originalTaxable ? Number(invoice.adjustment || 0) * taxableValue / originalTaxable : 0);
      const total = round2(taxableValue + (reverseCharge ? 0 : totalTax) + adjustment);
      if (!(total > 0)) throw new Error("Credit-note total must be greater than zero.");
      if (d.save_status === "issue") {
        const { data: issuedNotes, error: issuedReadError } = await admin.from("shipment_credit_notes").select("total").eq("invoice_id", invoiceId).eq("status", "issued");
        if (issuedReadError) throw new Error("Could not verify the invoice's remaining creditable amount.");
        const alreadyCredited = (issuedNotes ?? []).reduce((sum: number, item: Record<string, unknown>) => sum + Number(item.total || 0), 0);
        if (alreadyCredited + total > Number(invoice.total) + 0.005) throw new Error("This credit exceeds the remaining invoice amount.");
      }
      const row = {
        ...(id ? { id } : {}), invoice_id: invoiceId, credit_note_number: null, status: "draft",
        credit_date: creditDate, reason, invoice_number_snapshot: invoice.invoice_number,
        seller: invoice.seller ?? {}, buyer: invoice.buyer ?? {}, currency: invoice.currency,
        exchange_rate_to_inr: invoice.exchange_rate_to_inr, fx_date: invoice.fx_date, fx_source: invoice.fx_source,
        supply_type: invoice.supply_type, place_of_supply: invoice.place_of_supply,
        place_of_supply_state_code: invoice.place_of_supply_state_code, reverse_charge: reverseCharge,
        lines, subtotal, discount_total: discountTotal, taxable_value: taxableValue,
        cgst_total: cgstTotal, sgst_total: sgstTotal, igst_total: igstTotal, total_tax: totalTax,
        adjustment, total, total_inr: round2(total * Number(invoice.exchange_rate_to_inr || 1)),
        issued_at: null, updated_by: actorId, updated_at: new Date().toISOString(),
        ...(!id ? { created_by: actorId } : {}),
      };
      const { data: saved, error } = await admin.from("shipment_credit_notes").upsert(row).select("*").single();
      if (error) throw new Error(error.message);
      let result = saved;
      if (d.save_status === "issue") {
        const { data: issued, error: issueError } = await admin.rpc("issue_shipment_credit_note", { p_credit_note_id: saved.id, p_user_id: actorId });
        if (issueError) {
          if (!id) await admin.from("shipment_credit_notes").delete().eq("id", saved.id).eq("status", "draft");
          throw new Error(issueError.message);
        }
        result = Array.isArray(issued) ? issued[0] : issued;
      }
      await recordAudit(d.save_status === "issue" ? "issue" : (id ? "update" : "create"), "shipment_credit_note", saved.id, before, result);
      return reply(200, { record: result }, origin);
    }

    if (action === "issueCreditNote") {
      roleCheck(profile.role, "finance");
      const id = uuid(payload.id);
      const { data: before, error: readError } = await admin.from("shipment_credit_notes").select("*").eq("id", id).maybeSingle();
      if (readError || !before) throw new Error("Credit note not found.");
      if (before.status !== "draft") throw new Error("Only a draft credit note can be issued.");
      const { data, error } = await admin.rpc("issue_shipment_credit_note", { p_credit_note_id: id, p_user_id: actorId });
      if (error) throw new Error(error.message);
      const result = Array.isArray(data) ? data[0] : data;
      await recordAudit("issue", "shipment_credit_note", id, before, result);
      return reply(200, { record: result }, origin);
    }

    if (action === "deleteDraftCreditNote") {
      roleCheck(profile.role, "finance");
      const id = uuid(payload.id);
      const { data: before, error: readError } = await admin.from("shipment_credit_notes").select("*").eq("id", id).maybeSingle();
      if (readError || !before) throw new Error("Credit note not found.");
      if (before.status !== "draft") throw new Error("An issued credit note cannot be deleted.");
      const { data: deleted, error } = await admin.from("shipment_credit_notes").delete().eq("id", id).eq("status", "draft").select("id").maybeSingle();
      if (error || !deleted) throw new Error("Draft credit note could not be deleted.");
      await recordAudit("delete_draft", "shipment_credit_note", id, before, null);
      return reply(200, { deleted: true }, origin);
    }

    if (action === "recordInvoicePayment") {
      roleCheck(profile.role, "finance");
      const paymentData = payload.data ?? {};
      const invoiceId = uuid(paymentData.invoice_id);
      const amount = number(paymentData.amount, "Receipt amount", 0.01);
      const currency = text(paymentData.currency, 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Use a three-letter ISO currency code.");
      const rate = currency === "INR" ? 1 : number(paymentData.exchange_rate_to_inr, "INR exchange rate", 0.000001);
      const receivedAt = date(paymentData.received_at);
      if (!receivedAt) throw new Error("Receipt date is required.");
      const fxDate = date(paymentData.fx_date) || receivedAt;
      const method = val(paymentData.payment_method || "bank_transfer", ["bank_transfer","upi","cash","card","cheque","other"], "payment method");
      const { data: invoice } = await admin.from("shipment_invoices").select("*").eq("id", invoiceId).maybeSingle();
      if (!invoice) throw new Error("Invoice not found.");
      const { data: payment, error } = await admin.rpc("record_shipment_invoice_payment", {
        p_invoice_id: invoiceId, p_received_at: receivedAt, p_amount: amount, p_currency: currency,
        p_exchange_rate_to_inr: rate, p_fx_date: fxDate, p_fx_source: text(currency === "INR" ? "INR base currency" : paymentData.fx_source || "Manual override", 120),
        p_payment_method: method, p_reference: text(paymentData.reference, 160), p_notes: text(paymentData.notes, 1000), p_user_id: actorId,
      });
      if (error) throw new Error(error.message);
      const result = Array.isArray(payment) ? payment[0] : payment;
      await recordAudit("receipt", "shipment_invoice_payment", result.id, null, result);
      return reply(200, { record: result }, origin);
    }

    if (action === "upsertCharge") {
      roleCheck(profile.role, "finance");
      const d = payload.data ?? {};
      const id = d.id ? uuid(d.id) : undefined;
      const before = id ? (await admin.from("shipment_charges").select("*").eq("id", id).maybeSingle()).data : null;
      let linkedJob = d.job_id ? await assertJob(d.job_id) : null;
      const linkedHbl = d.hbl_id ? await assertJobHbl(d.hbl_id, linkedJob?.id) : null;
      if (linkedHbl && !linkedJob) linkedJob = await assertJob(linkedHbl.job_id);
      const jobId = linkedHbl?.job_id ?? linkedJob?.id ?? null;
      const containerNo = text(d.container_no, 40) ? await assertContainer(d.container_no) : null;
      if (!jobId && !containerNo) throw new Error("Select a forwarding job or a container for this charge.");
      if (jobId && containerNo) await assertJobContainer(jobId, containerNo);
      const currency = text(d.currency || "INR", 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Use a three-letter ISO currency code.");
      const fx = currency === "INR" ? 1 : number(d.exchange_rate_to_inr, "INR exchange rate", 0.000001);
      const row = {
        ...(id ? { id } : {}), job_id: jobId, hbl_id: linkedHbl?.id ?? null, container_no: containerNo,
        direction: val(d.direction, ["cost","revenue"], "charge direction"),
        charge_code: text(d.charge_code, 100), description: text(d.description, 240),
        counterparty: text(d.counterparty, 160), amount: number(d.amount, "Amount", 0.01),
        currency, exchange_rate_to_inr: fx, invoice_reference: text(d.invoice_reference, 120),
        invoice_date: date(d.invoice_date), due_date: date(d.due_date),
        approval_status: "draft", approved_by: null, approved_at: null,
        notes: text(d.notes, 1500), updated_by: actorId, updated_at: new Date().toISOString(),
        ...(!id ? { created_by: actorId } : {}),
      };
      if (!row.charge_code) throw new Error("Charge code/name is required.");
      const { data, error } = await admin.from("shipment_charges").upsert(row).select("*").single();
      if (error) throw new Error(error.message);
      await recordAudit(id ? "update" : "create", "shipment_charge", data.id, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "deleteCharge") {
      if (profile.role !== "Admin") throw new Error("Only an Admin can delete a charge record.");
      const id = uuid(payload.id);
      const { data: before, error: readError } = await admin.from("shipment_charges").select("*").eq("id", id).maybeSingle();
      if (readError || !before) throw new Error("Charge record not found.");
      const { error: archiveError } = await admin.from("deleted_shipment_charges").insert({
        charge_id: before.id, row_data: before, deleted_by: actorId,
      });
      if (archiveError) throw new Error("Could not archive this charge; nothing was deleted.");
      const { data: deleted, error: deleteError } = await admin.from("shipment_charges").delete().eq("id", id).select("id").maybeSingle();
      if (deleteError || !deleted) {
        await admin.from("deleted_shipment_charges").delete().eq("charge_id", id);
        throw new Error("Charge could not be removed from the active register; no deletion was completed.");
      }
      await recordAudit("archive", "shipment_charge", id, before, { archived: true });
      return reply(200, { deleted: true, archived: true }, origin);
    }

    if (action === "approveCharge") {
      if (profile.role !== "Admin") throw new Error("Only an Admin can approve a charge for profitability reporting.");
      const id = uuid(payload.id);
      const { data: before, error: readError } = await admin.from("shipment_charges").select("*").eq("id", id).maybeSingle();
      if (readError || !before) throw new Error("Charge record not found.");
      const { data, error } = await admin.from("shipment_charges").update({
        approval_status: "approved", approved_by: actorId, approved_at: new Date().toISOString(), updated_by: actorId,
      }).eq("id", id).select("*").single();
      if (error) throw new Error(error.message);
      await recordAudit("approve", "shipment_charge", id, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "upsertFiling") {
      roleCheck(profile.role, "filing");
      const d = payload.data ?? {};
      const id = d.id ? uuid(d.id) : undefined;
      const before = id ? (await admin.from("shipment_filings").select("*").eq("id", id).maybeSingle()).data : null;
      let linkedJob = d.job_id ? await assertJob(d.job_id) : null;
      const linkedHbl = d.hbl_id ? await assertJobHbl(d.hbl_id, linkedJob?.id) : null;
      if (linkedHbl && !linkedJob) linkedJob = await assertJob(linkedHbl.job_id);
      const jobId = linkedHbl?.job_id ?? linkedJob?.id ?? null;
      const containerNo = text(d.container_no, 40) ? await assertContainer(d.container_no) : null;
      if (!jobId && !containerNo) throw new Error("Select a forwarding job or a container for this filing.");
      if (jobId && containerNo) await assertJobContainer(jobId, containerNo);
      const hblNo = text(linkedHbl?.hbl_no || d.hbl_no, 100) || text(linkedJob?.hbl_no, 100);
      const mblNo = text(d.mbl_no, 100) || text(linkedJob?.mbl_no, 100);
      if (linkedJob?.mbl_no && d.mbl_no && norm(linkedJob.mbl_no) !== norm(d.mbl_no)) throw new Error("The MBL does not match the selected forwarding job.");
      const filingStatus = val(d.status || "draft", ["draft","ready","submitted","accepted","rejected","not_required"], "filing status");
      if (d.filed_at && Number.isNaN(Date.parse(String(d.filed_at)))) throw new Error("Enter a valid filing date.");
      if (d.acknowledged_at && Number.isNaN(Date.parse(String(d.acknowledged_at)))) throw new Error("Enter a valid acknowledgment date.");
      const filedAt = d.filed_at ? new Date(String(d.filed_at)).toISOString() : null;
      const acknowledgedAt = d.acknowledged_at ? new Date(String(d.acknowledged_at)).toISOString() : null;
      if (["submitted","accepted","rejected"].includes(filingStatus) && !filedAt) throw new Error("Enter the actual filing date for a submitted filing.");
      if (filingStatus === "accepted" && !acknowledgedAt) throw new Error("Enter the acknowledgment date for an accepted filing.");
      const row = {
        ...(id ? { id } : {}), job_id: jobId, hbl_id: linkedHbl?.id ?? null, container_no: containerNo, hbl_no: hblNo, mbl_no: mblNo,
        filing_type: val(d.filing_type, ["HBL","MBL","CSN","IGM","SI","VGM","OTHER"], "filing type"),
        filing_reference: text(d.filing_reference, 140), status: filingStatus, due_date: date(d.due_date),
        filed_at: filedAt, acknowledged_at: acknowledgedAt, notes: text(d.notes, 2000), updated_by: actorId, updated_at: new Date().toISOString(),
        ...(!id ? { created_by: actorId } : {}),
      };
      const { data, error } = await admin.from("shipment_filings").upsert(row).select("*").single();
      if (error) throw new Error(error.message);
      await recordAudit(id ? "update" : "create", "shipment_filing", data.id, before, data);
      return reply(200, { record: data }, origin);
    }

    if (action === "uploadFilingDocument") {
      roleCheck(profile.role, "filing");
      const filingId = uuid(payload.filing_id);
      const { data: filing, error: filingError } = await admin.from("shipment_filings").select("id,container_no").eq("id", filingId).maybeSingle();
      if (filingError || !filing) throw new Error("Filing record not found.");
      const containerNo = filing.container_no ? await assertContainer(filing.container_no) : null;
      const filename = text(payload.filename, 180).replace(/[\\/\0]/g, "_");
      const contentType = text(payload.content_type, 120).toLowerCase();
      const permitted = ["application/pdf","image/jpeg","image/png","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
      if (!filename || !permitted.includes(contentType)) throw new Error("Upload a PDF, JPG, PNG or Word document.");
      const encoded = String(payload.base64 ?? "").replace(/^data:[^,]*;base64,/, "");
      if (!encoded || encoded.length > 11_200_000) throw new Error("Document exceeds the 8 MB upload limit.");
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      if (!bytes.length || bytes.length > 8_388_608) throw new Error("Document exceeds the 8 MB upload limit.");
      const extension = filename.includes(".") ? filename.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) : "bin";
      const objectPath = filingId + "/" + crypto.randomUUID() + "." + extension;
      const { error: storageError } = await admin.storage.from("logistics-documents").upload(objectPath, bytes, {
        contentType, cacheControl: "60", upsert: false,
      });
      if (storageError) throw new Error("Document upload failed: " + storageError.message);
      const { data, error } = await admin.from("filing_documents").insert({
        filing_id: filingId, container_no: containerNo, object_path: objectPath, original_name: filename,
        content_type: contentType, file_size: bytes.length, uploaded_by: actorId,
      }).select("*").single();
      if (error) {
        await admin.storage.from("logistics-documents").remove([objectPath]);
        throw new Error("Document record could not be saved: " + error.message);
      }
      await recordAudit("upload", "filing_document", data.id, null, { id: data.id, filing_id: filingId, original_name: filename });
      return reply(200, { record: data }, origin);
    }

    if (action === "uploadMilestonePhoto") {
      roleCheck(profile.role,"jobOps");
      const milestoneId=uuid(payload.milestone_id);
      const {data:milestone,error:milestoneError}=await admin.from("shipment_milestones").select("id,job_id").eq("id",milestoneId).maybeSingle();
      if(milestoneError||!milestone)throw new Error("Shipment milestone not found.");
      const filename=text(payload.filename,180).replace(/[\\/\0]/g,"_"),contentType=text(payload.content_type,80).toLowerCase();
      if(!filename||!["image/jpeg","image/png"].includes(contentType))throw new Error("Only JPG and PNG status photos are allowed.");
      const encoded=String(payload.base64??"").replace(/^data:[^,]*;base64,/,"");
      if(!encoded||encoded.length>11200000)throw new Error("Photo exceeds the 8 MB upload limit.");
      const binary=atob(encoded),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
      if(!bytes.length||bytes.length>8388608)throw new Error("Photo exceeds the 8 MB upload limit.");
      const objectPath="milestones/"+milestoneId+"/"+crypto.randomUUID()+"."+(contentType==="image/png"?"png":"jpg");
      const {error:storageError}=await admin.storage.from("logistics-documents").upload(objectPath,bytes,{contentType,cacheControl:"60",upsert:false});
      if(storageError)throw new Error("Photo upload failed: "+storageError.message);
      const {data,error}=await admin.from("shipment_milestones").update({photo_path:objectPath,updated_by:actorId,updated_at:new Date().toISOString()}).eq("id",milestoneId).select("*").single();
      if(error){await admin.storage.from("logistics-documents").remove([objectPath]);throw new Error("Photo metadata could not be saved: "+error.message);}
      await recordAudit("upload_photo","shipment_milestone",milestoneId,milestone,{photo_path:objectPath});
      return reply(200,{record:data},origin);
    }
    if (action === "signedMilestonePhotoUrl") {
      const milestoneId=uuid(payload.milestone_id);
      const {data:milestone,error}=await admin.from("shipment_milestones").select("photo_path").eq("id",milestoneId).maybeSingle();
      if(error||!milestone?.photo_path)throw new Error("No photo is attached to this status update.");
      const {data:signed,error:signError}=await admin.storage.from("logistics-documents").createSignedUrl(milestone.photo_path,300);
      if(signError||!signed?.signedUrl)throw new Error("Could not create a secure photo link.");
      return reply(200,{url:signed.signedUrl},origin);
    }

    if (action === "signedTransportPodUrl") {
      const dispatchId = uuid(payload.dispatch_id);
      const { data: dispatch, error } = await admin.from("transport_dispatches")
        .select("pod_object_path").eq("id", dispatchId).maybeSingle();
      if (error || !dispatch?.pod_object_path) throw new Error("No POD document is attached to this transport dispatch.");
      const { data: signed, error: signError } = await admin.storage.from("logistics-documents")
        .createSignedUrl(dispatch.pod_object_path, 300);
      if (signError || !signed?.signedUrl) throw new Error("Could not create a secure POD link.");
      return reply(200, { url: signed.signedUrl }, origin);
    }

    if (action === "signedDocumentUrl") {
      const id = uuid(payload.id);
      const { data: doc, error } = await admin.from("filing_documents").select("object_path").eq("id", id).maybeSingle();
      if (error || !doc) throw new Error("Document not found.");
      const { data: signed, error: signError } = await admin.storage.from("logistics-documents").createSignedUrl(doc.object_path, 300);
      if (signError || !signed?.signedUrl) throw new Error("Could not create a secure document link.");
      return reply(200, { url: signed.signedUrl }, origin);
    }

    if (action === "saveAlertAction") {
      roleCheck(profile.role, "alert");
      const containerNo = await assertContainer(payload.container_no);
      const code = val(payload.alert_code, ["terminal_lfd","detention_lfd","empty_return"], "alert type");
      const dueDate = date(payload.due_date);
      const status = val(payload.status, ["acknowledged","resolved"], "alert status");
      const alertKey = text(payload.alert_key, 260);
      const expectedKey = norm(containerNo) + "|" + code + "|" + (dueDate || "NO-DATE");
      if (alertKey !== expectedKey) throw new Error("Alert no longer matches the shipment record. Refresh and retry.");
      const before = (await admin.from("logistics_alert_actions").select("*").eq("alert_key", alertKey).maybeSingle()).data;
      const row = {
        alert_key: alertKey, container_no: containerNo, alert_code: code, due_date: dueDate,
        status, assigned_to: actorId, note: text(payload.note, 1200), updated_by: actorId, updated_at: new Date().toISOString(),
      };
      const { data, error } = await admin.from("logistics_alert_actions").upsert(row).select("*").single();
      if (error) throw new Error(error.message);
      await recordAudit(status, "logistics_alert", alertKey, before, data);
      return reply(200, { record: data }, origin);
    }

    return reply(400, { error: "Unknown logistics workspace action." }, origin);
  } catch (error) {
    const message = errorMessage(error);
    const status = /staff role|only an admin/i.test(message) ? 403 : 400;
    return reply(status, { error: message }, origin);
  }
});
