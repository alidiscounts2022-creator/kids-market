import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PRODUCT_IMAGES_BUCKET = "product-images";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const merchant = await requireMerchant(req);
    const payload = await req.json();
    const imageUrl = await resolveImageUrl(payload);
    const extraImageUrls = await resolveExtraImageUrls(payload);
    const draft = await createDraft(payload, merchant, imageUrl, extraImageUrls);

    return json({
      ok: true,
      draft_id: draft.id,
      message: "تم إرسال المنتج للمراجعة. سيظهر في الموقع بعد اعتماد الإدارة.",
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, status);
  }
});

async function requireMerchant(req: Request): Promise<any> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    throw new HttpError("سجل الدخول كتاجر قبل إرسال المنتج.", 401);
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    throw new HttpError("جلسة التاجر غير صالحة. سجل الدخول من جديد.", 401);
  }

  const merchantId = cleanString(userData.user.user_metadata?.merchant_id, "");
  if (!merchantId) {
    throw new HttpError("هذا الحساب غير مربوط بملف تاجر.", 403);
  }

  const { data: merchant, error } = await supabase
    .from("merchants")
    .select("*")
    .eq("id", merchantId)
    .maybeSingle();

  if (error) throw error;
  if (!merchant) throw new HttpError("تعذر العثور على بيانات التاجر.", 404);
  return merchant;
}

async function createDraft(
  payload: Record<string, unknown>,
  merchant: any,
  imageUrl: string | null,
  extraImageUrls: string[]
): Promise<any> {
  const title = requiredString(payload.title, "اسم المنتج مطلوب.");
  const editProductId = cleanString(payload.edit_product_id, "");
  if (editProductId) {
    await assertProductBelongsToMerchant(editProductId, merchant.id);
  }

  const description = buildProductDescription(
    cleanString(payload.description, "") || cleanString(payload.facebook_text, ""),
    payload.sizes,
    payload.colors,
    payload.stock_status,
    payload.merchant_code,
    mergeExtraImages(payload.extra_images, extraImageUrls)
  );
  const sourceUrl = cleanString(payload.source_url, "") || cleanString(payload.facebook_page_url, "");

  const draft = {
    merchant_id: merchant.id,
    source_platform: editProductId ? "merchant_edit" : (sourceUrl?.includes("facebook.com") ? "facebook" : "merchant_form"),
    source_post_id: `${editProductId ? "merchant-edit" : "merchant-form"}-${Date.now()}-${crypto.randomUUID()}`,
    source_url: editProductId ? `product.html?id=${editProductId}` : sourceUrl,
    title,
    description,
    price_lyd: normalizePrice(payload.price_lyd),
    city: cleanString(payload.city, merchant.city),
    category: cleanString(payload.category, "غير مصنف") || "غير مصنف",
    store_name: merchant.store_name,
    whatsapp_phone: merchant.whatsapp_phone,
    image_url: imageUrl || cleanString(payload.image_url, ""),
    raw_payload: {
      source: "public merchant form",
      edit_product_id: editProductId,
      merchant_code: cleanString(payload.merchant_code, ""),
      facebook_text: cleanString(payload.facebook_text, ""),
    },
    status: "pending_review",
  };

  const { data, error } = await supabase
    .from("product_drafts")
    .insert(draft)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function assertProductBelongsToMerchant(productId: string, merchantId: string): Promise<void> {
  const { data, error } = await supabase
    .from("products")
    .select("id,merchant_id")
    .eq("id", productId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new HttpError("المنتج المطلوب تعديله غير موجود.", 404);
  if (data.merchant_id !== merchantId) throw new HttpError("لا يمكنك تعديل منتج لا يتبع حسابك.", 403);
}

async function resolveImageUrl(payload: Record<string, unknown>): Promise<string | null> {
  const directUrl = cleanString(payload.image_url, "");
  if (directUrl) return directUrl;

  return await uploadImageFromPayload(payload, "merchant-submissions");
}

async function resolveExtraImageUrls(payload: Record<string, unknown>): Promise<string[]> {
  const directUrls = splitList(payload.extra_images).filter((url) => /^https?:\/\//i.test(url));
  const files = Array.isArray(payload.extra_image_files) ? payload.extra_image_files.slice(0, 6) : [];
  const uploadedUrls: string[] = [];

  for (const item of files) {
    if (!item || typeof item !== "object") continue;
    const url = await uploadImageFromPayload(item as Record<string, unknown>, "merchant-gallery");
    if (url) uploadedUrls.push(url);
  }

  return [...directUrls, ...uploadedUrls].filter((url, index, list) => list.indexOf(url) === index);
}

async function uploadImageFromPayload(payload: Record<string, unknown>, folder: string): Promise<string | null> {
  const imageData = cleanString(payload.image_data, "");
  if (!imageData) return null;

  const mimeType = cleanString(payload.image_mime_type, "image/jpeg") || "image/jpeg";
  const extension = ALLOWED_IMAGE_TYPES[mimeType];
  if (!extension) {
    throw new Error("نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WEBP.");
  }

  const base64 = imageData.includes(",") ? imageData.split(",").pop() ?? "" : imageData;
  const bytes = decodeBase64(base64);
  if (!bytes.length) throw new Error("تعذر قراءة الصورة.");
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("حجم الصورة كبير. اختر صورة أصغر من 5MB.");
  }

  await ensureImageBucket();

  const safeName = cleanFileName(payload.image_file_name);
  const filePath = `${folder}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName}.${extension}`;
  const { error } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(filePath, bytes, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .getPublicUrl(filePath);

  return data.publicUrl;
}

function mergeExtraImages(value: unknown, uploadedUrls: string[]): string {
  return [...splitList(value), ...uploadedUrls]
    .filter((url) => /^https?:\/\//i.test(url))
    .filter((url, index, list) => list.indexOf(url) === index)
    .join("\n");
}

function buildProductDescription(
  value: unknown,
  sizesValue: unknown,
  colorsValue: unknown,
  stockStatusValue: unknown,
  merchantCodeValue: unknown,
  extraImagesValue: unknown
): string | null {
  const base = cleanString(value, "") || "";
  const sizes = splitList(sizesValue);
  const colors = splitList(colorsValue);
  const stockStatus = cleanString(stockStatusValue, "");
  const merchantCode = cleanString(merchantCodeValue, "");
  const extraImages = splitList(extraImagesValue).filter((item) => /^https?:\/\//i.test(item));
  const lines = [base];

  if (merchantCode) lines.push(`كود التاجر: ${merchantCode}`);
  if (sizes.length) lines.push(`المقاسات المتوفرة: ${sizes.join("، ")}`);
  if (colors.length) lines.push(`الألوان: ${colors.join("، ")}`);
  if (stockStatus) lines.push(`التوفر: ${stockStatus}`);
  if (extraImages.length) lines.push(`الصور الإضافية: ${extraImages.join("، ")}`);

  const description = lines.filter(Boolean).join("\n\n");
  return description || null;
}

function cleanString(value: unknown, fallback: unknown): string | null {
  const resolved = typeof value === "string" && value.trim() ? value : fallback;
  if (resolved === null || resolved === undefined) return null;
  return String(resolved).trim();
}

function requiredString(value: unknown, message: string): string {
  const resolved = cleanString(value, "");
  if (!resolved) throw new Error(message);
  return resolved;
}

function normalizePrice(value: unknown): number | null {
  const resolved = value === "" || value === null || value === undefined ? null : value;
  if (resolved === null || resolved === undefined) return null;
  const number = Number(resolved);
  return Number.isFinite(number) ? number : null;
}

function splitList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.join("،") : String(value ?? "");
  return raw
    .split(/[,،\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function cleanFileName(value: unknown): string {
  const base = String(value ?? "product-image")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "product-image";
}

async function ensureImageBucket(): Promise<void> {
  const { data: bucket } = await supabase.storage.getBucket(PRODUCT_IMAGES_BUCKET);
  if (!bucket) {
    const { error } = await supabase.storage.createBucket(PRODUCT_IMAGES_BUCKET, {
      public: true,
      fileSizeLimit: MAX_IMAGE_BYTES,
      allowedMimeTypes: Object.keys(ALLOWED_IMAGE_TYPES),
    });

    if (error && !error.message.toLowerCase().includes("already exists")) {
      throw error;
    }
    return;
  }

  if (!bucket.public) {
    const { error } = await supabase.storage.updateBucket(PRODUCT_IMAGES_BUCKET, {
      public: true,
      fileSizeLimit: MAX_IMAGE_BYTES,
      allowedMimeTypes: Object.keys(ALLOWED_IMAGE_TYPES),
    });

    if (error) throw error;
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
