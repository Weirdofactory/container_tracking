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
      if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || email.length > 254) throw new Error("Enter a valid email address.");
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
        customer_name: text(d.customer_name, 180), shipper: text(d.shipper, 180),
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


    if (action === "listInvoices") {
      roleCheck(profile.role, "finance");
      const [{ data: invoices, error: invoiceError }, { data: settings, error: settingsError }] = await Promise.all([
        admin.from("shipment_invoices").select("*").order("updated_at", { ascending: false }).limit(250),
        admin.from("shipment_invoice_settings").select("data").eq("id", "default").maybeSingle(),
      ]);
      if (invoiceError || settingsError) throw new Error("Invoice records could not be loaded.");
      return reply(200, { invoices: invoices ?? [], settings: settings?.data ?? {} }, origin);
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
      const s = obj(d.seller), b = obj(d.buyer);
      const seller = {
        name: text(s.name, 180), gstin: text(s.gstin, 20).toUpperCase(), address: text(s.address, 700),
        state: text(s.state, 100), state_code: text(s.state_code, 2), postal_code: text(s.postal_code, 20),
        country: text(s.country || "India", 80), email: text(s.email, 180), phone: text(s.phone, 60),
        bank_name: text(s.bank_name, 140), bank_account: text(s.bank_account, 80),
        ifsc: text(s.ifsc, 30).toUpperCase(), upi: text(s.upi, 120),
      };
      const buyer = {
        name: text(b.name, 180), gstin: text(b.gstin, 20).toUpperCase(), address: text(b.address, 700),
        state: text(b.state, 100), state_code: text(b.state_code, 2), postal_code: text(b.postal_code, 20),
        country: text(b.country || "India", 80), email: text(b.email, 180),
      };
      const invoiceType = val(d.invoice_type, ["tax_invoice", "bill_of_supply", "commercial_invoice"], "invoice type");
      const supplyType = val(d.supply_type, ["intra_state", "inter_state", "export_lut", "export_igst", "not_applicable"], "GST supply type");
      const invoiceDate = date(d.invoice_date);
      if (!invoiceDate) throw new Error("Invoice date is required.");
      const dueDate = date(d.due_date);
      const currency = text(d.currency || "INR", 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Use a three-letter ISO currency code.");
      const fx = currency === "INR" ? 1 : number(d.exchange_rate_to_inr, "INR exchange rate", 0.000001);
      const fxDate = date(d.fx_date);
      const fxSource = text(currency === "INR" ? "INR base currency" : d.fx_source || "Manual override", 120);
      const rawLines = Array.isArray(d.lines) ? d.lines : [];
      if (!rawLines.length || rawLines.length > 50) throw new Error("Add between 1 and 50 invoice lines.");
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
        container_no: containerNo, seller, buyer, supply_type: supplyType,
        place_of_supply: text(d.place_of_supply, 160), place_of_supply_state_code: text(d.place_of_supply_state_code, 2),
        reverse_charge: reverseCharge,
        po_number: text(d.po_number, 120), payment_terms: text(d.payment_terms, 500),
        currency, exchange_rate_to_inr: fx, fx_date: fxDate, fx_source: fxSource, lines,
        subtotal, discount_total: discountTotal, taxable_value: taxableValue, cgst_total: cgstTotal,
        sgst_total: sgstTotal, igst_total: igstTotal, total_tax: totalTax, adjustment, total,
        total_inr: round2(total * fx), notes: text(d.notes, 2000), issued_at: null,
        updated_by: actorId, updated_at: new Date().toISOString(),
        ...(!id ? { created_by: actorId } : {}),
      };
      const issueNow = d.save_status === "issue";
      if (issueNow) {
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
