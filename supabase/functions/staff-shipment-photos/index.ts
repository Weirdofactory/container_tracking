import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = () => Deno.env.get("CUSTOMER_TRACKING_ALLOWED_ORIGIN") ?? "https://weirdofactory.github.io";
const PHOTO_BUCKET = "shipment-milestone-photos";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
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
function staffCanEdit(role: string): boolean {
  return ["admin", "editor", "operator"].includes(role.toLowerCase());
}
function staffCanPublish(role: string): boolean {
  return ["admin", "editor"].includes(role.toLowerCase());
}
function publicPhoto(photo: Record<string, unknown>, signedUrl: string) {
  return {
    id: String(photo.id),
    milestone: String(photo.milestone || ""),
    caption: String(photo.caption || ""),
    customerVisible: photo.customer_visible === true,
    createdAt: String(photo.created_at || ""),
    signedUrl,
  };
}
async function signedPhotoList(admin: ReturnType<typeof createClient>, rows: Record<string, unknown>[]) {
  return await Promise.all(rows.map(async row => {
    const { data } = await admin.storage.from(PHOTO_BUCKET).createSignedUrl(String(row.storage_path), 600);
    return data?.signedUrl ? publicPhoto(row, data.signedUrl) : null;
  })).then(items => items.filter(Boolean));
}
async function authenticate(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return { error: "Authentication required" } as const;
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return { error: "Photo service is unavailable." } as const;
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) return { error: "Authentication required" } as const;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await admin.from("staff_profiles")
    .select("role,is_active").eq("user_id", userData.user.id).maybeSingle();
  if (profileError || !profile?.is_active || !staffCanEdit(String(profile.role || ""))) {
    return { error: "An active editor, operator or admin account is required." } as const;
  }
  return { admin, user: userData.user, role: String(profile.role) } as const;
}
async function shipmentExists(admin: ReturnType<typeof createClient>, container: string) {
  const { data, error } = await admin.from("containers").select("data")
    .eq("id", "gml_tracking_records").maybeSingle();
  if (error || !Array.isArray(data?.data)) return false;
  return data.data.some((item: unknown) => item && typeof item === "object" && !Array.isArray(item) &&
    normalize(field(item as Record<string, unknown>, ["CONTAINER NO.", "CONTAINER", "CONTAINER NO", "CNTR NO", "CONTAINER NUMBER"])) === container);
}
function validMilestone(value: string) {
  return ["estimated_departure", "port_arrival", "port_release", "cfs_received", "destuffing", "empty_returned", "other"].includes(value);
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
  if (length > MAX_FILE_SIZE + 64 * 1024) return reply(413, { error: "Image must be 5 MB or smaller." }, origin);

  const auth = await authenticate(req);
  if ("error" in auth) return reply(auth.error === "Authentication required" ? 401 : 403, { error: auth.error }, origin);
  const { admin, user, role } = auth;
  const bucketKey = "staff-photo:" + user.id;
  const { data: rateRows, error: rateError } = await admin.rpc("consume_edge_rate_limit", {
    p_bucket_key: bucketKey, p_window_seconds: 60, p_limit: 30,
  });
  if (rateError || !Array.isArray(rateRows) || !rateRows[0]) return reply(503, { error: "Photo service is unavailable." }, origin);
  if (!rateRows[0].allowed) return reply(429, { error: "Please wait before managing more photos." }, origin);

  if (req.headers.get("content-type")?.includes("multipart/form-data")) {
    let form: FormData;
    try { form = await req.formData(); } catch { return reply(400, { error: "Invalid upload form." }, origin); }
    const action = String(form.get("action") || "");
    const container = normalize(form.get("container"));
    const milestone = String(form.get("milestone") || "");
    const caption = String(form.get("caption") || "").trim();
    const customerVisibleRequested = String(form.get("customerVisible") || "") === "true";
    const file = form.get("file");
    if (action !== "upload" || !container || container.length > 24) return reply(400, { error: "Select a valid shipment." }, origin);
    if (!validMilestone(milestone)) return reply(400, { error: "Select a valid milestone." }, origin);
    if (caption.length > 180) return reply(400, { error: "Caption must be 180 characters or fewer." }, origin);
    if (!(file instanceof File)) return reply(400, { error: "Choose an image to upload." }, origin);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return reply(415, { error: "Use a JPG, PNG or WebP image." }, origin);
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) return reply(413, { error: "Image must be 5 MB or smaller." }, origin);
    if (!await shipmentExists(admin, container)) return reply(404, { error: "Shipment is no longer in the staff records." }, origin);

    const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
    const path = container + "/" + crypto.randomUUID() + "." + ext;
    const customerVisible = customerVisibleRequested && staffCanPublish(role);
    const { error: uploadError } = await admin.storage.from(PHOTO_BUCKET).upload(path, file, {
      contentType: file.type, upsert: false, cacheControl: "3600",
    });
    if (uploadError) return reply(500, { error: "The image could not be stored. Please try again." }, origin);
    const { data: saved, error: saveError } = await admin.from("shipment_photos").insert({
      container_no: container, milestone, caption, storage_path: path,
      customer_visible: customerVisible, created_by: user.id,
    }).select("id,milestone,caption,customer_visible,created_at,storage_path").single();
    if (saveError || !saved) {
      await admin.storage.from(PHOTO_BUCKET).remove([path]);
      return reply(500, { error: "The photo record could not be saved." }, origin);
    }
    const { data: signed } = await admin.storage.from(PHOTO_BUCKET).createSignedUrl(path, 600);
    return reply(200, { photo: publicPhoto(saved, signed?.signedUrl || "") }, origin);
  }

  let payload: { action?: unknown; container?: unknown; photoId?: unknown; customerVisible?: unknown };
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reply(400, { error: "Invalid request." }, origin);
    payload = parsed as typeof payload;
  } catch { return reply(400, { error: "Invalid request." }, origin); }
  const action = String(payload.action || "");
  const container = normalize(payload.container);
  if (!container || container.length > 24) return reply(400, { error: "Select a valid shipment." }, origin);

  if (action === "list") {
    const { data, error } = await admin.from("shipment_photos").select("id,milestone,caption,customer_visible,created_at,storage_path")
      .eq("container_no", container).order("created_at", { ascending: false }).limit(30);
    if (error) return reply(500, { error: "Photos could not be loaded." }, origin);
    return reply(200, { photos: await signedPhotoList(admin, data || []) }, origin);
  }
  if (action === "visibility") {
    if (!staffCanPublish(role)) return reply(403, { error: "Only Admin or Editor staff can share photos with customers." }, origin);
    const photoId = typeof payload.photoId === "string" ? payload.photoId : "";
    if (!/^[0-9a-f-]{36}$/i.test(photoId) || typeof payload.customerVisible !== "boolean") {
      return reply(400, { error: "Invalid photo visibility request." }, origin);
    }
    const { data, error } = await admin.from("shipment_photos")
      .update({ customer_visible: payload.customerVisible })
      .eq("id", photoId).eq("container_no", container)
      .select("id,milestone,caption,customer_visible,created_at,storage_path").maybeSingle();
    if (error || !data) return reply(404, { error: "Photo record not found." }, origin);
    const list = await signedPhotoList(admin, [data]);
    return reply(200, { photo: list[0] || publicPhoto(data, "") }, origin);
  }
  return reply(400, { error: "Unsupported photo action." }, origin);
});
