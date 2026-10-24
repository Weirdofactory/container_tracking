import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = () => Deno.env.get("CUSTOMER_TRACKING_ALLOWED_ORIGIN") ?? "https://weirdofactory.github.io";
const replyHeaders = (origin: string | null) => {
  const h: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, private",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (origin && origin === allowedOrigin()) h["Access-Control-Allow-Origin"] = allowedOrigin();
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
  sailing: new Set(["Admin", "Editor", "Operator"]),
  consolidation: new Set(["Admin", "Editor", "Operator"]),
  filing: new Set(["Admin", "Editor", "Operator"]),
  alert: new Set(["Admin", "Editor", "Operator"]),
  finance: new Set(["Admin", "Editor"]),
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
    if (origin && origin !== allowedOrigin()) return new Response(null, { status: 403, headers: replyHeaders(null) });
    return new Response(null, { status: 204, headers: replyHeaders(origin) });
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

    if (action === "read") {
      const tables = [
        ["sailings", "logistics_sailings", "created_at"],
        ["sailingShipments", "sailing_schedule_shipments", "created_at"],
        ["consolidations", "lcl_consolidations", "created_at"],
        ["consolidationItems", "lcl_consolidation_items", "created_at"],
        ["charges", "shipment_charges", "created_at"],
        ["filings", "shipment_filings", "created_at"],
        ["documents", "filing_documents", "created_at"],
        ["alertActions", "logistics_alert_actions", "updated_at"],
      ] as const;
      const results = await Promise.all(tables.map(async ([key, table, orderColumn]) => {
        const { data, error } = await admin.from(table).select("*").order(orderColumn, { ascending: false }).limit(2500);
        if (error) throw new Error("Could not load " + key + ".");
        return [key, data ?? []] as const;
      }));
      return reply(200, { ...Object.fromEntries(results), profile: { displayName: profile.display_name, role: profile.role } }, origin);
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
        ...(itemId ? { id: itemId } : {}), consolidation_id: consolidationId,
        hbl_no: text(d.hbl_no, 100), shipper: text(d.shipper, 160), consignee: text(d.consignee, 160),
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

    if (action === "upsertCharge") {
      roleCheck(profile.role, "finance");
      const d = payload.data ?? {};
      const id = d.id ? uuid(d.id) : undefined;
      const before = id ? (await admin.from("shipment_charges").select("*").eq("id", id).maybeSingle()).data : null;
      const containerNo = await assertContainer(d.container_no);
      const currency = text(d.currency || "INR", 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Use a three-letter ISO currency code.");
      const fx = currency === "INR" ? 1 : number(d.exchange_rate_to_inr, "INR exchange rate", 0.000001);
      const row = {
        ...(id ? { id } : {}), container_no: containerNo,
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
      const containerNo = await assertContainer(d.container_no);
      const filingStatus = val(d.status || "draft", ["draft","ready","submitted","accepted","rejected","not_required"], "filing status");
      if (d.filed_at && Number.isNaN(Date.parse(String(d.filed_at)))) throw new Error("Enter a valid filing date.");
      if (d.acknowledged_at && Number.isNaN(Date.parse(String(d.acknowledged_at)))) throw new Error("Enter a valid acknowledgment date.");
      const filedAt = d.filed_at ? new Date(String(d.filed_at)).toISOString() : null;
      const acknowledgedAt = d.acknowledged_at ? new Date(String(d.acknowledged_at)).toISOString() : null;
      if (["submitted","accepted","rejected"].includes(filingStatus) && !filedAt) throw new Error("Enter the actual filing date for a submitted filing.");
      if (filingStatus === "accepted" && !acknowledgedAt) throw new Error("Enter the acknowledgment date for an accepted filing.");
      const row = {
        ...(id ? { id } : {}), container_no: containerNo, hbl_no: text(d.hbl_no, 100), mbl_no: text(d.mbl_no, 100),
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
      const containerNo = await assertContainer(filing.container_no);
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
