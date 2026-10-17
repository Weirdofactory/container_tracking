import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = () => Deno.env.get("CUSTOMER_TRACKING_ALLOWED_ORIGIN") ?? "https://weirdofactory.github.io";
const corsHeaders = (origin: string | null) => {
  const configured = allowedOrigin();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, private",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (origin && origin === configured) headers["Access-Control-Allow-Origin"] = configured;
  return headers;
};
function reply(status: number, body: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
function normalize(value: unknown): string { return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function field(record: Record<string, unknown>, names: string[]): string {
  const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const name of names) {
    const key = Object.keys(record).find(k => normalizeKey(k) === normalizeKey(name));
    if (key && record[key] !== null && record[key] !== undefined && String(record[key]).trim()) return String(record[key]).trim();
  }
  return "";
}
function makeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    if (origin && origin !== allowedOrigin()) return new Response(null, { status: 403, headers: corsHeaders(null) });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" }, origin);
  if (origin && origin !== allowedOrigin()) return reply(403, { error: "Forbidden" }, null);
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return reply(401, { error: "Authentication required" }, origin);
  const url = Deno.env.get("SUPABASE_URL"), anonKey = Deno.env.get("SUPABASE_ANON_KEY"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return reply(503, { error: "Service unavailable" }, origin);
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) return reply(401, { error: "Authentication required" }, origin);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await admin.from("staff_profiles").select("role, is_active").eq("user_id", userData.user.id).maybeSingle();
  if (profileError || !profile || !profile.is_active || profile.role !== "Admin") return reply(403, { error: "Administrator access required" }, origin);
  let payload: { action?: unknown; containerNo?: unknown; label?: unknown; expiresInDays?: unknown; tokenId?: unknown; limit?: unknown; offset?: unknown };
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reply(400, { error: "Invalid request" }, origin);
    payload = parsed;
  } catch { return reply(400, { error: "Invalid request" }, origin); }

  if (payload.action === "list") {
    const limit = Number(payload.limit ?? 50), offset = Number(payload.offset ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000) {
      return reply(400, { error: "Invalid pagination" }, origin);
    }
    const { data, error, count } = await admin.from("customer_tracking_tokens")
      .select("id, container_no, label, expires_at, revoked_at, created_at, last_used_at", { count: "exact" })
      .order("created_at", { ascending: false }).range(offset, offset + limit - 1);
    if (error) return reply(500, { error: "Could not list tracking links" }, origin);
    return reply(200, { items: data ?? [], count: count ?? 0, limit, offset }, origin);
  }

  if (payload.action === "create") {
    const containerNo = typeof payload.containerNo === "string" ? payload.containerNo.trim() : "";
    const normalized = normalize(containerNo);
    if (normalized.length < 7 || normalized.length > 15) return reply(400, { error: "Enter a valid container number" }, origin);
    const days = Number(payload.expiresInDays ?? 30);
    if (!Number.isInteger(days) || days < 1 || days > 90) return reply(400, { error: "Expiry must be 1–90 days" }, origin);

    // Do not issue a grant for a typo or a container that is absent from the live source dataset.
    const { data: source, error: sourceError } = await admin.from("containers")
      .select("data").eq("id", "gml_tracking_records").maybeSingle();
    if (sourceError || !Array.isArray(source?.data)) return reply(503, { error: "Tracking source unavailable" }, origin);
    const exists = source.data.some((item: unknown) => {
      if (!item || typeof item !== "object") return false;
      return normalize(field(item as Record<string, unknown>, [
        "CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO", "CONTAINER NUMBER",
      ])) === normalized;
    });
    if (!exists) return reply(404, { error: "Container not found in tracking records" }, origin);

    const token = makeToken(), expiresAt = new Date(Date.now() + days * 86400000).toISOString();
    const { data, error } = await admin.from("customer_tracking_tokens").insert({
      token_hash: await sha256Hex(token), container_no: normalized,
      label: typeof payload.label === "string" ? payload.label.trim().slice(0, 120) || null : null,
      expires_at: expiresAt, created_by: userData.user.id,
    }).select("id").single();
    if (error || !data) return reply(500, { error: "Could not create tracking link" }, origin);
    return reply(201, { id: data.id, token, containerNo: normalized, expiresAt, note: "Copy this token now; it is not stored in readable form." }, origin);
  }

  if (payload.action === "revoke") {
    const tokenId = typeof payload.tokenId === "string" ? payload.tokenId : "";
    if (!/^[0-9a-f-]{36}$/i.test(tokenId)) return reply(400, { error: "Invalid token reference" }, origin);
    const { data, error } = await admin.from("customer_tracking_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", tokenId).is("revoked_at", null).select("id").maybeSingle();
    if (error) return reply(500, { error: "Could not revoke tracking link" }, origin);
    if (!data) return reply(404, { error: "Active tracking link not found" }, origin);
    return reply(200, { revoked: true }, origin);
  }
  return reply(400, { error: "Unsupported action" }, origin);
});
