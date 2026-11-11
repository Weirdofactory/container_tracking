import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = () => Deno.env.get("CUSTOMER_TRACKING_ALLOWED_ORIGIN") ?? "https://weirdofactory.github.io";
const responseHeaders = (origin: string | null) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, private",
    "Vary": "Origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (origin && origin === allowedOrigin()) headers["Access-Control-Allow-Origin"] = allowedOrigin();
  return headers;
};
function reply(status: number, body: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(origin) });
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
function uuid(value: unknown): string | null {
  const result = String(value ?? "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result) ? result : null;
}
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
function safeParty(input: unknown) {
  const party = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  return {
    name: party.name || "",
    contact_name: party.contact_name || "",
    address: party.address || "",
    state: party.state || "",
    state_code: party.state_code || "",
    postal_code: party.postal_code || "",
    country: party.country || "",
    gstin: party.gstin || "",
    email: party.email || "",
    phone: party.phone || "",
    bank_name: party.bank_name || "",
    bank_account: party.bank_account || "",
    ifsc: party.ifsc || "",
    upi: party.upi || "",
  };
}
function safeInvoiceLine(input: unknown) {
  const line = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  return {
    description: line.description || "",
    hsn_sac: line.hsn_sac || "",
    quantity: Number(line.quantity || 0),
    unit: line.unit || "",
    unit_price: Number(line.unit_price || 0),
    discount_percent: Number(line.discount_percent || 0),
    taxable_value: Number(line.taxable_value || 0),
    gst_rate: Number(line.gst_rate || 0),
    tax_amount: Number(line.tax_amount || 0),
    line_total: Number(line.line_total || 0),
  };
}
function safeCreditLine(input: unknown) {
  const line = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  return {
    description: line.description || "",
    hsn_sac: line.hsn_sac || "",
    quantity: Number(line.quantity || 0),
    unit: line.unit || "",
    taxable_value: Number(line.taxable_value || 0),
    gst_rate: Number(line.gst_rate || 0),
    tax_amount: Number(line.tax_amount || 0),
    line_total: Number(line.line_total || 0),
  };
}
function safeAirWaybill(waybill: Record<string, unknown>, events: Record<string, unknown>[]) {
  const snapshot = waybill.hawb_snapshot && typeof waybill.hawb_snapshot === "object"
    ? waybill.hawb_snapshot as Record<string, unknown> : {};
  const frozen = snapshot.waybill && typeof snapshot.waybill === "object"
    ? snapshot.waybill as Record<string, unknown> : waybill;
  return {
    hawb_no: frozen.hawb_no || waybill.hawb_no || "",
    mawb_no: frozen.mawb_no || waybill.mawb_no || "",
    airline: frozen.airline || waybill.airline || "",
    flight_no: frozen.flight_no || waybill.flight_no || "",
    origin_airport: frozen.origin_airport || waybill.origin_airport || "",
    destination_airport: frozen.destination_airport || waybill.destination_airport || "",
    etd: frozen.etd || waybill.etd || null,
    eta: frozen.eta || waybill.eta || null,
    pieces: Number(frozen.pieces || waybill.pieces || 0),
    package_type: frozen.package_type || waybill.package_type || "",
    gross_weight_kg: Number(frozen.gross_weight_kg || waybill.gross_weight_kg || 0),
    volume_cbm: Number(frozen.volume_cbm || waybill.volume_cbm || 0),
    chargeable_weight_kg: Number(frozen.chargeable_weight_kg || waybill.chargeable_weight_kg || 0),
    commodity: frozen.commodity || waybill.commodity || "",
    goods_description: frozen.goods_description || waybill.goods_description || "",
    shipper: frozen.shipper || waybill.shipper || "",
    consignee: frozen.consignee || waybill.consignee || "",
    freight_terms: frozen.freight_terms || waybill.freight_terms || "",
    issued_at: waybill.hawb_issued_at || null,
    events: events.filter(event => event.customer_visible === true).map(event => ({
      event_name: event.event_name || "Shipment update",
      location: event.location || "",
      event_at: event.event_at,
      notes: event.notes || "",
    })),
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    if (origin && origin !== allowedOrigin()) return new Response(null, { status: 403, headers: responseHeaders(null) });
    return new Response(null, { status: 204, headers: responseHeaders(origin) });
  }
  if (req.method !== "POST") return reply(405, { error: "Method not allowed." }, origin);
  if (origin && origin !== allowedOrigin()) return reply(403, { error: "Forbidden." }, null);
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 20000) return reply(413, { error: "Request too large." }, origin);

  let payload: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reply(400, { error: "Invalid request." }, origin);
    payload = parsed as Record<string, unknown>;
  } catch {
    return reply(400, { error: "Invalid request." }, origin);
  }

  const rawToken = typeof payload.token === "string" ? payload.token : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return reply(401, { error: "This customer portal link is invalid or expired." }, origin);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply(503, { error: "Customer portal is temporarily unavailable." }, origin);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const ipBucket = await sha256Hex("customer-portal-ip:" + clientAddress(req));
  const { data: ipRate, error: ipRateError } = await admin.rpc("consume_edge_rate_limit", {
    p_bucket_key: ipBucket, p_window_seconds: 60, p_limit: 40,
  });
  if (ipRateError || !Array.isArray(ipRate) || !ipRate[0]) return reply(503, { error: "Customer portal is temporarily unavailable." }, origin);
  if (!ipRate[0].allowed) return new Response(JSON.stringify({ error: "Too many requests. Please try again in a minute." }), {
    status: 429, headers: { ...responseHeaders(origin), "Retry-After": String(ipRate[0].retry_after_seconds || 60) },
  });

  const tokenHash = await sha256Hex(rawToken);
  const tokenBucket = await sha256Hex("customer-portal-token:" + tokenHash);
  const { data: tokenRate, error: tokenRateError } = await admin.rpc("consume_edge_rate_limit", {
    p_bucket_key: tokenBucket, p_window_seconds: 60, p_limit: 60,
  });
  if (tokenRateError || !Array.isArray(tokenRate) || !tokenRate[0]) return reply(503, { error: "Customer portal is temporarily unavailable." }, origin);
  if (!tokenRate[0].allowed) return new Response(JSON.stringify({ error: "Too many requests. Please try again in a minute." }), {
    status: 429, headers: { ...responseHeaders(origin), "Retry-After": String(tokenRate[0].retry_after_seconds || 60) },
  });

  const now = new Date().toISOString();
  const { data: access, error: accessError } = await admin.from("customer_portal_access_tokens")
    .select("id, customer_id, expires_at").eq("token_hash", tokenHash).is("revoked_at", null).gt("expires_at", now).maybeSingle();
  if (accessError || !access) return reply(401, { error: "This customer portal link is invalid or expired." }, origin);
  const { data: customer, error: customerError } = await admin.from("customer_accounts")
    .select("id, legal_name, display_name, contact_name, is_active").eq("id", access.customer_id).maybeSingle();
  if (customerError || !customer?.is_active) return reply(401, { error: "This customer portal link is invalid or expired." }, origin);
  await admin.from("customer_portal_access_tokens").update({ last_used_at: now }).eq("id", access.id);

  if (payload.action === "quote_decision") {
    const quoteId = uuid(payload.quote_id);
    const outcome = payload.outcome === "accepted" || payload.outcome === "rejected" ? payload.outcome : "";
    if (!quoteId || !outcome) return reply(400, { error: "Choose accept or decline for a valid quote." }, origin);
    const { data, error } = await admin.rpc("customer_portal_quote_decision", {
      p_quote_id: quoteId, p_customer_id: customer.id, p_outcome: outcome,
    });
    if (error || !data) return reply(409, { error: error?.message || "This quote could not be updated." }, origin);
    const quote = (data.quote || {}) as Record<string, unknown>;
    const job = (data.job || {}) as Record<string, unknown>;
    return reply(200, {
      decision: outcome,
      quoteNo: quote.quote_no || "",
      status: quote.status || "",
      job: job.job_no ? { job_no: job.job_no, status: job.status } : null,
    }, origin);
  }

  const customerId = String(customer.id);
  const { data: jobs, error: jobsError } = await admin.from("forwarding_jobs")
    .select("id,job_no,customer_reference,service_type,direction,status,pol,transshipment_port,pod,final_delivery_place,vessel_name,voyage_no,etd,eta,actual_departure_at,actual_arrival_at,delivered_at,customer_visible,deleted_at,updated_at")
    .eq("customer_id", customerId).eq("customer_visible", true).is("deleted_at", null)
    .order("updated_at", { ascending: false }).limit(1000);
  if (jobsError || !Array.isArray(jobs)) return reply(503, { error: "Shipment data is temporarily unavailable." }, origin);

  const jobIds = jobs.map(job => String(job.id));
  const jobById = new Map(jobs.map(job => [String(job.id), job]));
  let hbls: Record<string, unknown>[] = [];
  let milestones: Record<string, unknown>[] = [];
  let waybills: Record<string, unknown>[] = [];
  let airEvents: Record<string, unknown>[] = [];
  if (jobIds.length) {
    const [hblResult, milestoneResult, waybillResult] = await Promise.all([
      admin.from("forwarding_job_hbls").select("id,job_id,hbl_no,customer_reference,shipper,consignee,package_count,package_type,gross_weight_kg,volume_cbm,commodity,customer_visible").in("job_id", jobIds).eq("customer_visible", true).limit(5000),
      admin.from("shipment_milestones").select("id,job_id,container_no,milestone_code,milestone_name,location,planned_at,actual_at,status,customer_visible,notes").in("job_id", jobIds).eq("customer_visible", true).order("planned_at", { ascending: true }).limit(10000),
      admin.from("air_waybills").select("id,job_id,hawb_no,mawb_no,airline,flight_no,origin_airport,destination_airport,etd,eta,pieces,package_type,gross_weight_kg,volume_cbm,chargeable_weight_kg,commodity,goods_description,shipper,consignee,freight_terms,hawb_status,hawb_snapshot,hawb_issued_at,customer_visible").in("job_id", jobIds).eq("hawb_status", "issued").eq("customer_visible", true).limit(1000),
    ]);
    if (hblResult.error || milestoneResult.error || waybillResult.error) return reply(503, { error: "Shipment data is temporarily unavailable." }, origin);
    hbls = hblResult.data ?? [];
    milestones = milestoneResult.data ?? [];
    waybills = waybillResult.data ?? [];
    const waybillIds = waybills.map(item => String(item.id));
    if (waybillIds.length) {
      const eventResult = await admin.from("air_waybill_events")
        .select("air_waybill_id,event_name,location,event_at,notes,customer_visible")
        .in("air_waybill_id", waybillIds).eq("customer_visible", true).order("event_at", { ascending: true }).limit(10000);
      if (eventResult.error) return reply(503, { error: "Shipment data is temporarily unavailable." }, origin);
      airEvents = eventResult.data ?? [];
    }
  }

  let routeLegs: Record<string, unknown>[] = [];
  let routeLegEvents: Record<string, unknown>[] = [];
  if (jobIds.length) {
    const legResult = await admin.from("forwarding_job_legs")
      .select("id,job_id,leg_no,leg_role,mode,status,carrier,service_reference,tracking_reference,origin,destination,etd,eta,actual_departure_at,actual_arrival_at")
      .in("job_id", jobIds).is("deleted_at", null).eq("customer_visible", true)
      .order("leg_no", { ascending: true }).limit(5000);
    if (legResult.error) return reply(503, { error: "Shipment route data is temporarily unavailable." }, origin);
    routeLegs = legResult.data ?? [];
    const routeLegIds = routeLegs.map(leg => String(leg.id));
    if (routeLegIds.length) {
      const legEventResult = await admin.from("forwarding_job_leg_events")
        .select("leg_id,event_code,event_name,location,event_at,notes")
        .in("leg_id", routeLegIds).eq("customer_visible", true)
        .order("event_at", { ascending: true }).limit(10000);
      if (legEventResult.error) return reply(503, { error: "Shipment route events are temporarily unavailable." }, origin);
      routeLegEvents = legEventResult.data ?? [];
    }
  }

  const enquiryResult = await admin.from("sales_enquiries")
    .select("id,company_name,service_type,direction,origin,destination,commodity,package_count,gross_weight_kg,volume_cbm,cargo_ready_date")
    .eq("customer_id", customerId).limit(1000);
  if (enquiryResult.error) return reply(503, { error: "Quote data is temporarily unavailable." }, origin);
  const enquiries = enquiryResult.data ?? [];
  const enquiryIds = enquiries.map(item => String(item.id));
  const quoteColumns = "id,enquiry_id,customer_id,quote_no,status,currency,exchange_rate_to_inr,fx_rate_date,fx_rate_source,tax_mode,subtotal,tax_total,total_amount,total_inr,valid_until,terms,issued_at,responded_at,accepted_job_id";
  const quoteResults = await Promise.all([
    admin.from("freight_quotes").select(quoteColumns).eq("customer_id", customerId).in("status", ["sent","accepted","rejected","expired","converted"]).order("created_at", { ascending: false }).limit(1000),
    enquiryIds.length
      ? admin.from("freight_quotes").select(quoteColumns).in("enquiry_id", enquiryIds).is("customer_id", null).in("status", ["sent","accepted","rejected","expired","converted"]).order("created_at", { ascending: false }).limit(1000)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (quoteResults[0].error || quoteResults[1].error) return reply(503, { error: "Quote data is temporarily unavailable." }, origin);
  const quoteMap = new Map<string, Record<string, unknown>>();
  for (const quote of [...(quoteResults[0].data ?? []), ...(quoteResults[1].data ?? [])]) quoteMap.set(String(quote.id), quote);
  const quoteRows = [...quoteMap.values()];
  const acceptedJobIds = Array.from(new Set(quoteRows.map(quote => String(quote.accepted_job_id || "")).filter(Boolean)));
  const acceptedJobsById = new Map<string, Record<string, unknown>>();
  if (acceptedJobIds.length) {
    const acceptedJobsResult = await admin.from("forwarding_jobs").select("id,job_no")
      .eq("customer_id", customerId).in("id", acceptedJobIds);
    if (acceptedJobsResult.error) return reply(503, { error: "Booking references are temporarily unavailable." }, origin);
    for (const job of acceptedJobsResult.data ?? []) acceptedJobsById.set(String(job.id), job);
  }
  const quoteIds = quoteRows.map(quote => String(quote.id));
  let quoteLines: Record<string, unknown>[] = [];
  if (quoteIds.length) {
    const linesResult = await admin.from("freight_quote_lines")
      .select("id,quote_id,line_no,charge_code,description,quantity,unit,unit_price,gst_rate,line_subtotal,tax_amount,total_amount")
      .in("quote_id", quoteIds).order("line_no", { ascending: true }).limit(10000);
    if (linesResult.error) return reply(503, { error: "Quote data is temporarily unavailable." }, origin);
    quoteLines = linesResult.data ?? [];
  }
  const enquiryById = new Map(enquiries.map(item => [String(item.id), item]));
  const linesByQuote = new Map<string, Record<string, unknown>[]>();
  for (const line of quoteLines) {
    const key = String(line.quote_id);
    linesByQuote.set(key, [...(linesByQuote.get(key) ?? []), line]);
  }
  const today = new Date().toISOString().slice(0, 10);
  const quotes = quoteRows.map(quote => {
    const enquiry = enquiryById.get(String(quote.enquiry_id)) ?? {};
    const status = quote.status === "sent" && quote.valid_until && String(quote.valid_until) < today ? "expired" : quote.status;
    return {
      id: quote.id,
      quote_no: quote.quote_no || "Quotation",
      status,
      currency: quote.currency,
      exchange_rate_to_inr: Number(quote.exchange_rate_to_inr || 1),
      fx_rate_date: quote.fx_rate_date,
      fx_rate_source: quote.fx_rate_source,
      tax_mode: quote.tax_mode,
      subtotal: Number(quote.subtotal || 0),
      tax_total: Number(quote.tax_total || 0),
      total_amount: Number(quote.total_amount || 0),
      total_inr: Number(quote.total_inr || 0),
      valid_until: quote.valid_until,
      terms: quote.terms || "",
      issued_at: quote.issued_at,
      responded_at: quote.responded_at,
      has_booking: acceptedJobsById.has(String(quote.accepted_job_id || "")),
      accepted_job_no: acceptedJobsById.get(String(quote.accepted_job_id || ""))?.job_no || "",
      enquiry: {
        service_type: enquiry.service_type || "",
        direction: enquiry.direction || "",
        origin: enquiry.origin || "",
        destination: enquiry.destination || "",
        commodity: enquiry.commodity || "",
        package_count: enquiry.package_count,
        gross_weight_kg: enquiry.gross_weight_kg,
        volume_cbm: enquiry.volume_cbm,
        cargo_ready_date: enquiry.cargo_ready_date,
      },
      lines: (linesByQuote.get(String(quote.id)) ?? []).map(line => ({
        charge_code: line.charge_code,
        description: line.description,
        quantity: Number(line.quantity || 0),
        unit: line.unit,
        unit_price: Number(line.unit_price || 0),
        gst_rate: Number(line.gst_rate || 0),
        line_subtotal: Number(line.line_subtotal || 0),
        tax_amount: Number(line.tax_amount || 0),
        total_amount: Number(line.total_amount || 0),
      })),
    };
  });

  const { data: invoices, error: invoicesError } = await admin.from("shipment_invoices")
    .select("id,invoice_number,status,invoice_type,invoice_date,due_date,job_id,hbl_id,container_no,seller,buyer,supply_type,place_of_supply,place_of_supply_state_code,reverse_charge,po_number,payment_terms,currency,exchange_rate_to_inr,fx_date,fx_source,lines,subtotal,discount_total,taxable_value,cgst_total,sgst_total,igst_total,total_tax,adjustment,total,total_inr,issued_at")
    .eq("customer_id", customerId).eq("status", "issued").order("invoice_date", { ascending: false }).limit(2000);
  if (invoicesError || !Array.isArray(invoices)) return reply(503, { error: "Invoice data is temporarily unavailable." }, origin);
  const invoiceIds = invoices.map(invoice => String(invoice.id));
  let creditNotes: Record<string, unknown>[] = [];
  let payments: Record<string, unknown>[] = [];
  if (invoiceIds.length) {
    const [creditResult, paymentResult] = await Promise.all([
      admin.from("shipment_credit_notes").select("id,credit_note_number,invoice_id,status,credit_date,reason,seller,buyer,currency,lines,subtotal,discount_total,taxable_value,cgst_total,sgst_total,igst_total,total_tax,adjustment,total,total_inr,issued_at")
        .in("invoice_id", invoiceIds).eq("status", "issued").order("credit_date", { ascending: false }).limit(5000),
      admin.from("shipment_invoice_payments").select("id,receipt_number,invoice_id,received_at,amount,currency,amount_inr,payment_method")
        .in("invoice_id", invoiceIds).order("received_at", { ascending: false }).limit(10000),
    ]);
    if (creditResult.error || paymentResult.error) return reply(503, { error: "Invoice data is temporarily unavailable." }, origin);
    creditNotes = creditResult.data ?? [];
    payments = paymentResult.data ?? [];
  }
  const creditByInvoice = new Map<string, Record<string, unknown>[]>();
  const paymentByInvoice = new Map<string, Record<string, unknown>[]>();
  for (const credit of creditNotes) {
    const key = String(credit.invoice_id);
    creditByInvoice.set(key, [...(creditByInvoice.get(key) ?? []), credit]);
  }
  for (const payment of payments) {
    const key = String(payment.invoice_id);
    paymentByInvoice.set(key, [...(paymentByInvoice.get(key) ?? []), payment]);
  }
  const invoiceRows = invoices.map(invoice => {
    const credits = creditByInvoice.get(String(invoice.id)) ?? [];
    const receipts = paymentByInvoice.get(String(invoice.id)) ?? [];
    const creditTotal = credits.reduce((sum, note) => sum + Number(note.total || 0), 0);
    const creditTotalInr = credits.reduce((sum, note) => sum + Number(note.total_inr || 0), 0);
    const received = receipts.reduce((sum, receipt) => sum + Number(receipt.amount || 0), 0);
    const receivedInr = receipts.reduce((sum, receipt) => sum + Number(receipt.amount_inr || 0), 0);
    const invoiceLines = Array.isArray(invoice.lines) ? invoice.lines.map(safeInvoiceLine) : [];
    return {
      invoice_number: invoice.invoice_number || "",
      invoice_type: invoice.invoice_type,
      invoice_date: invoice.invoice_date,
      due_date: invoice.due_date,
      job_no: jobById.get(String(invoice.job_id))?.job_no || "",
      hbl_no: hbls.find(hbl => String(hbl.id) === String(invoice.hbl_id))?.hbl_no || "",
      container_no: invoice.container_no,
      seller: safeParty(invoice.seller),
      buyer: safeParty(invoice.buyer),
      supply_type: invoice.supply_type,
      place_of_supply: invoice.place_of_supply,
      place_of_supply_state_code: invoice.place_of_supply_state_code,
      reverse_charge: invoice.reverse_charge,
      po_number: invoice.po_number || "",
      payment_terms: invoice.payment_terms || "",
      currency: invoice.currency,
      exchange_rate_to_inr: Number(invoice.exchange_rate_to_inr || 1),
      fx_date: invoice.fx_date,
      fx_source: invoice.fx_source,
      lines: invoiceLines,
      subtotal: Number(invoice.subtotal || 0),
      discount_total: Number(invoice.discount_total || 0),
      taxable_value: Number(invoice.taxable_value || 0),
      cgst_total: Number(invoice.cgst_total || 0),
      sgst_total: Number(invoice.sgst_total || 0),
      igst_total: Number(invoice.igst_total || 0),
      total_tax: Number(invoice.total_tax || 0),
      adjustment: Number(invoice.adjustment || 0),
      total: Number(invoice.total || 0),
      total_inr: Number(invoice.total_inr || 0),
      balance: round2(Math.max(0, Number(invoice.total || 0) - creditTotal - received)),
      balance_inr: round2(Math.max(0, Number(invoice.total_inr || 0) - creditTotalInr - receivedInr)),
      issued_at: invoice.issued_at,
      credit_notes: credits.map(note => ({
        credit_note_number: note.credit_note_number || "",
        credit_date: note.credit_date,
        reason: note.reason || "",
        currency: note.currency,
        lines: Array.isArray(note.lines) ? note.lines.map(safeCreditLine) : [],
        subtotal: Number(note.subtotal || 0),
        discount_total: Number(note.discount_total || 0),
        taxable_value: Number(note.taxable_value || 0),
        cgst_total: Number(note.cgst_total || 0),
        sgst_total: Number(note.sgst_total || 0),
        igst_total: Number(note.igst_total || 0),
        total_tax: Number(note.total_tax || 0),
        adjustment: Number(note.adjustment || 0),
        total: Number(note.total || 0),
        total_inr: Number(note.total_inr || 0),
        issued_at: note.issued_at,
      })),
      receipts: receipts.map(receipt => ({
        receipt_number: receipt.receipt_number || "",
        received_at: receipt.received_at,
        amount: Number(receipt.amount || 0),
        amount_inr: Number(receipt.amount_inr || 0),
        currency: receipt.currency,
        payment_method: receipt.payment_method,
      })),
    };
  });
  const outstandingInr = round2(invoiceRows.reduce((sum, invoice) => sum + Number(invoice.balance_inr || 0), 0));

  const hblsByJob = new Map<string, Record<string, unknown>[]>();
  const milestonesByJob = new Map<string, Record<string, unknown>[]>();
  for (const hbl of hbls) {
    const key = String(hbl.job_id);
    hblsByJob.set(key, [...(hblsByJob.get(key) ?? []), hbl]);
  }
  for (const milestone of milestones) {
    const key = String(milestone.job_id);
    milestonesByJob.set(key, [...(milestonesByJob.get(key) ?? []), milestone]);
  }
  const legEventsById = new Map<string, Record<string, unknown>[]>();
  const legsByJob = new Map<string, Record<string, unknown>[]>();
  for (const event of routeLegEvents) {
    const key = String(event.leg_id);
    legEventsById.set(key, [...(legEventsById.get(key) ?? []), event]);
  }
  for (const leg of routeLegs) {
    const key = String(leg.job_id);
    const safeLeg = {
      leg_no: leg.leg_no,
      leg_role: leg.leg_role,
      mode: leg.mode,
      status: leg.status,
      carrier: leg.carrier || "",
      service_reference: leg.service_reference || "",
      tracking_reference: leg.tracking_reference || "",
      origin: leg.origin || "",
      destination: leg.destination || "",
      etd: leg.etd,
      eta: leg.eta,
      actual_departure_at: leg.actual_departure_at,
      actual_arrival_at: leg.actual_arrival_at,
      events: (legEventsById.get(String(leg.id)) ?? []).map(event => ({
        event_code: event.event_code,
        event_name: event.event_name || "Shipment update",
        location: event.location || "",
        event_at: event.event_at,
        notes: event.notes || "",
      })),
    };
    legsByJob.set(key, [...(legsByJob.get(key) ?? []), safeLeg]);
  }

  const shipments = jobs.map(job => ({
    job_no: job.job_no,
    customer_reference: job.customer_reference,
    service_type: job.service_type,
    direction: job.direction,
    status: job.status,
    pol: job.pol,
    transshipment_port: job.transshipment_port,
    pod: job.pod,
    final_delivery_place: job.final_delivery_place,
    vessel_name: job.vessel_name,
    voyage_no: job.voyage_no,
    etd: job.etd,
    eta: job.eta,
    actual_departure_at: job.actual_departure_at,
    actual_arrival_at: job.actual_arrival_at,
    delivered_at: job.delivered_at,
    updated_at: job.updated_at,
    hbls: hblsByJob.get(String(job.id)) ?? [],
    legs: legsByJob.get(String(job.id)) ?? [],
    milestones: (milestonesByJob.get(String(job.id)) ?? []).filter(event => event.status !== "skipped").map(event => ({
      milestone_name: event.milestone_name || event.milestone_code || "Shipment update",
      location: event.location || "",
      planned_at: event.planned_at,
      actual_at: event.actual_at,
      status: event.status,
      notes: event.notes || "",
      container_no: event.container_no || "",
    })),
    air_waybills: waybills.filter(waybill => waybill.job_id === job.id)
      .map(waybill => safeAirWaybill(waybill, airEvents.filter(event => event.air_waybill_id === waybill.id))),
  }));

  const activeShipments = shipments.filter(job => !["delivered","closed","cancelled"].includes(String(job.status || "").toLowerCase())).length;
  await admin.from("customer_portal_access_tokens").update({ last_used_at: now }).eq("id", access.id);
  return reply(200, {
    customer: { name: customer.display_name || customer.legal_name, contact_name: customer.contact_name || "" },
    shipments,
    active_shipments: activeShipments,
    quotes,
    invoices: invoiceRows,
    outstanding_inr: outstandingInr,
    as_of: now,
  }, origin);
});
