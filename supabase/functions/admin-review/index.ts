import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_API_KEY = (Deno.env.get("ADMIN_API_KEY") ?? "").trim();
const PRODUCT_IMAGES_BUCKET = "product-images";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authError = getAuthError(req);
    if (authError) {
      return json({ error: authError.message }, authError.status);
    }

    const url = new URL(req.url);
    const action = url.pathname.split("/").filter(Boolean).pop();

    if (req.method === "GET" && action === "stats") {
      return await getStats();
    }

    if (req.method === "GET" && action === "products") {
      return await listProducts(url);
    }

    if (req.method === "GET" && action === "merchants") {
      return await listMerchants();
    }

    if (req.method === "GET") {
      return await listDrafts(url);
    }

    if (req.method === "POST" && action === "approve") {
      const payload = await req.json();
      return await approveDraft(payload);
    }

    if (req.method === "POST" && action === "manual-product") {
      const payload = await req.json();
      return await createManualProduct(payload);
    }

    if (req.method === "POST" && action === "facebook-draft") {
      const payload = await req.json();
      return await createFacebookDraft(payload);
    }

    if (req.method === "POST" && action === "upload-image") {
      const payload = await req.json();
      return await uploadProductImage(payload);
    }

    if (req.method === "POST" && action === "update-product") {
      const payload = await req.json();
      return await updateProduct(payload);
    }

    if (req.method === "POST" && action === "merchant-status") {
      const payload = await req.json();
      return await updateMerchantStatus(payload);
    }

    if (req.method === "POST" && action === "hide-product") {
      const payload = await req.json();
      return await setProductStatus(payload, "hidden");
    }

    if (req.method === "POST" && action === "delete-product") {
      const payload = await req.json();
      return await deleteProduct(payload);
    }

    if (req.method === "POST" && action === "seed") {
      return await createDemoDraft();
    }

    if (req.method === "POST" && action === "seed-product") {
      return await createDemoProduct();
    }

    if (req.method === "POST" && action === "reject") {
      const payload = await req.json();
      return await rejectDraft(payload);
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

function getAuthError(req: Request): { message: string; status: number } | null {
  if (!ADMIN_API_KEY) {
    return {
      message: "ADMIN_API_KEY غير محفوظ في Supabase Edge Function Secrets.",
      status: 500,
    };
  }

  const header = (req.headers.get("x-admin-key") ?? "").trim();
  if (!header) {
    return {
      message: "أدخل مفتاح الإدارة ADMIN_API_KEY أولاً.",
      status: 401,
    };
  }

  if (header !== ADMIN_API_KEY) {
    return {
      message: "مفتاح الإدارة غير صحيح. تأكد أن Name هو ADMIN_API_KEY وأن Value هي القيمة نفسها بدون مسافات.",
      status: 401,
    };
  }

  return null;
}

async function listDrafts(url: URL): Promise<Response> {
  const status = url.searchParams.get("status") ?? "pending_review";
  const { data, error } = await supabase
    .from("product_drafts")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw error;
  return json({ drafts: data ?? [] });
}

async function getStats(): Promise<Response> {
  const [
    pendingDrafts,
    approvedDrafts,
    rejectedDrafts,
    publishedProducts,
    hiddenProducts,
    soldProducts,
    allProducts,
    merchants,
    whatsappInquiries,
    latestProduct,
  ] = await Promise.all([
    countRows("product_drafts", "pending_review"),
    countRows("product_drafts", "approved"),
    countRows("product_drafts", "rejected"),
    countRows("products", "published"),
    countRows("products", "hidden"),
    countRows("products", "sold"),
    countAllRows("products"),
    countAllRows("merchants"),
    countInquiryRows(),
    getLatestProduct(),
  ]);

  return json({
    stats: {
      pending_drafts: pendingDrafts,
      approved_drafts: approvedDrafts,
      rejected_drafts: rejectedDrafts,
      published_products: publishedProducts,
      hidden_products: hiddenProducts,
      sold_products: soldProducts,
      all_products: allProducts,
      merchants,
      whatsapp_inquiries: whatsappInquiries,
      latest_product: latestProduct,
      manual_publish_enabled: true,
    },
  });
}

async function countInquiryRows(): Promise<number> {
  const { count, error } = await supabase
    .from("import_jobs")
    .select("id", { count: "exact", head: true })
    .eq("source_platform", "whatsapp_inquiry");

  if (error) return 0;
  return count ?? 0;
}

async function countRows(table: string, status: string): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("status", status);

  if (error) throw error;
  return count ?? 0;
}

async function countAllRows(table: string): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true });

  if (error) throw error;
  return count ?? 0;
}

async function getLatestProduct(): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("products")
    .select("id,title,city,category,status,created_at")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

async function listProducts(url: URL): Promise<Response> {
  const status = cleanString(url.searchParams.get("status"), "");
  const city = cleanString(url.searchParams.get("city"), "");
  const category = cleanString(url.searchParams.get("category"), "");

  let query = supabase
    .from("products")
    .select("*");

  if (status && status !== "all") query = query.eq("status", status);
  if (city && city !== "all") query = query.eq("city", city);
  if (category && category !== "all") query = query.eq("category", category);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw error;
  const inquiryCounts = await getInquiryCounts();
  const products = (data ?? []).map((product) => {
    const code = productCode(product.id);
    return {
      ...product,
      product_code: code,
      inquiry_count: inquiryCounts[String(product.id)] ?? inquiryCounts[code] ?? 0,
    };
  });
  return json({ products });
}

async function listMerchants(): Promise<Response> {
  const [merchantsResult, productsResult, draftsResult] = await Promise.all([
    supabase
      .from("merchants")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("products")
      .select("merchant_id,status")
      .limit(5000),
    supabase
      .from("product_drafts")
      .select("merchant_id,status")
      .limit(5000),
  ]);

  if (merchantsResult.error) throw merchantsResult.error;
  if (productsResult.error) throw productsResult.error;
  if (draftsResult.error) throw draftsResult.error;

  const productCounts = countByMerchant(productsResult.data ?? []);
  const draftCounts = countByMerchant(draftsResult.data ?? []);
  const merchants = (merchantsResult.data ?? []).map((merchant) => ({
    ...merchant,
    products_count: productCounts[String(merchant.id)] ?? 0,
    drafts_count: draftCounts[String(merchant.id)] ?? 0,
  }));

  return json({ merchants });
}

function countByMerchant(rows: Array<Record<string, unknown>>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const merchantId = String(row.merchant_id || "");
    if (!merchantId) continue;
    counts[merchantId] = (counts[merchantId] ?? 0) + 1;
  }
  return counts;
}

async function getInquiryCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("import_jobs")
    .select("error_message,imported_count")
    .eq("source_platform", "whatsapp_inquiry")
    .limit(5000);

  if (error) return {};

  const counts: Record<string, number> = {};
  for (const event of data ?? []) {
    const amount = Number(event.imported_count || 1) || 1;
    const meta = parseInquiryMeta(event.error_message);
    for (const key of [meta.product_id, meta.product_code].filter(Boolean)) {
      counts[key] = (counts[key] ?? 0) + amount;
    }
  }
  return counts;
}

function parseInquiryMeta(value: unknown): Record<string, string> {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return typeof parsed === "object" && parsed ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

function productCode(id: unknown): string {
  const clean = String(id || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  return `TF-${(clean || "PRODUCT").slice(0, 6)}`;
}

async function createDemoDraft(): Promise<Response> {
  const merchantInfo = {
    store_name: "محل براعم طرابلس",
    owner_name: "تاجر تجريبي",
    city: "طرابلس",
    whatsapp_phone: "218912345678",
    facebook_page_url: "https://facebook.com/tafli-demo-store",
    status: "active",
  };

  const { data: existingMerchant, error: merchantLookupError } = await supabase
    .from("merchants")
    .select("*")
    .eq("store_name", merchantInfo.store_name)
    .eq("whatsapp_phone", merchantInfo.whatsapp_phone)
    .maybeSingle();

  if (merchantLookupError) throw merchantLookupError;

  const merchant = existingMerchant ?? await insertMerchant(merchantInfo);
  const sourcePostId = `demo-${Date.now()}`;

  const draft = {
    merchant_id: merchant.id,
    source_platform: "facebook",
    source_post_id: sourcePostId,
    source_url: "https://facebook.com/tafli-demo-store/posts/demo",
    title: "طقم مواليد قطني - 5 قطع",
    description: buildProductDescription(
      "مسودة تجريبية لاختبار دورة المراجعة والنشر في طفلي ماركت.",
      "0-3 أشهر، 3-6 أشهر، 6-12 شهر",
      "أبيض، سماوي، وردي",
      "متوفر"
    ),
    price_lyd: 89,
    city: merchant.city,
    category: "مواليد",
    store_name: merchant.store_name,
    whatsapp_phone: merchant.whatsapp_phone,
    image_url: "https://images.unsplash.com/photo-1522771930-78848d9293e8?auto=format&fit=crop&w=900&q=80",
    raw_payload: {
      demo: true,
      source: "admin-review seed",
    },
    status: "pending_review",
  };

  const { data: insertedDraft, error: draftError } = await supabase
    .from("product_drafts")
    .insert(draft)
    .select()
    .single();

  if (draftError) throw draftError;

  return json({ ok: true, draft: insertedDraft });
}

async function createDemoProduct(): Promise<Response> {
  const merchantInfo = {
    store_name: "محل ماما بيبي طرابلس",
    owner_name: "تاجر مثال",
    city: "طرابلس",
    whatsapp_phone: "218912345678",
    facebook_page_url: "https://facebook.com/tafli-demo-store",
    status: "active",
  };

  const { data: existingMerchant, error: merchantLookupError } = await supabase
    .from("merchants")
    .select("*")
    .eq("store_name", merchantInfo.store_name)
    .eq("whatsapp_phone", merchantInfo.whatsapp_phone)
    .maybeSingle();

  if (merchantLookupError) throw merchantLookupError;
  const merchant = existingMerchant ?? await insertMerchant(merchantInfo);

  const product = {
    merchant_id: merchant.id,
    draft_id: null,
    title: "طقم مواليد قطني فاخر - 5 قطع",
    description: buildProductDescription(
      "منتج مثال لاختبار واجهة طفلي ماركت، مناسب للهدايا وتجهيز حقيبة المولود.",
      "0-3 أشهر، 3-6 أشهر، 6-12 شهر",
      "أبيض، سماوي، وردي",
      "متوفر",
      [
        "https://images.unsplash.com/photo-1522771930-78848d9293e8?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1555252333-9f8e92e65df9?auto=format&fit=crop&w=900&q=80",
      ]
    ),
    price_lyd: 89,
    city: merchant.city,
    category: "مواليد",
    store_name: merchant.store_name,
    whatsapp_phone: merchant.whatsapp_phone,
    image_url: "https://images.unsplash.com/photo-1522771930-78848d9293e8?auto=format&fit=crop&w=900&q=80",
    source_url: "https://facebook.com/tafli-demo-store/posts/demo-product",
    badge: "مثال",
    status: "published",
  };

  const { data, error } = await supabase
    .from("products")
    .insert(product)
    .select()
    .single();

  if (error) throw error;
  return json({ ok: true, product: data });
}

async function insertMerchant(merchantInfo: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase
    .from("merchants")
    .insert(merchantInfo)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getOrCreateMerchant(payload: Record<string, unknown>): Promise<any> {
  const merchantInfo = {
    store_name: requiredString(payload.store_name, "اسم المحل مطلوب."),
    owner_name: cleanString(payload.owner_name, ""),
    city: requiredString(payload.city, "المدينة مطلوبة."),
    whatsapp_phone: requiredString(payload.whatsapp_phone, "رقم واتساب مطلوب."),
    facebook_page_url: cleanString(payload.facebook_page_url, ""),
    status: "active",
  };

  const { data: existingMerchant, error: lookupError } = await supabase
    .from("merchants")
    .select("*")
    .eq("store_name", merchantInfo.store_name)
    .eq("whatsapp_phone", merchantInfo.whatsapp_phone)
    .maybeSingle();

  if (lookupError) throw lookupError;
  return existingMerchant ?? await insertMerchant(merchantInfo);
}

async function createManualProduct(payload: Record<string, unknown>): Promise<Response> {
  const merchant = await getOrCreateMerchant(payload);
  const title = requiredString(payload.title, "اسم المنتج مطلوب.");
  const category = cleanString(payload.category, "غير مصنف") || "غير مصنف";
  const description = buildProductDescription(
    payload.description,
    payload.sizes,
    payload.colors,
    payload.stock_status,
    payload.extra_images
  );

  const product = {
    merchant_id: merchant.id,
    draft_id: null,
    title,
    description,
    price_lyd: normalizePrice(payload.price_lyd, null),
    city: cleanString(payload.city, merchant.city),
    category,
    store_name: cleanString(payload.store_name, merchant.store_name),
    whatsapp_phone: cleanString(payload.whatsapp_phone, merchant.whatsapp_phone),
    image_url: cleanString(payload.image_url, ""),
    source_url: cleanString(payload.source_url, ""),
    badge: cleanString(payload.badge, category === "مواليد" ? "مواليد" : "جديد"),
    status: "published",
  };

  const { data: inserted, error } = await supabase
    .from("products")
    .insert(product)
    .select()
    .single();

  if (error) throw error;
  return json({ ok: true, product: inserted });
}

async function createFacebookDraft(payload: Record<string, unknown>): Promise<Response> {
  const merchant = await getOrCreateMerchant(payload);
  const postText = requiredString(payload.facebook_text ?? payload.description, "نص منشور فيسبوك مطلوب.");
  const title = cleanString(payload.title, "") || guessTitle(postText);
  const category = cleanString(payload.category, "") || guessCategory(postText);
  const description = buildProductDescription(
    postText,
    payload.sizes,
    payload.colors,
    payload.stock_status,
    payload.extra_images
  );
  const sourceUrl = cleanString(payload.source_url, "");
  const sourcePostId = sourceUrl || `manual-facebook-${Date.now()}-${crypto.randomUUID()}`;

  const draft = {
    merchant_id: merchant.id,
    source_platform: "facebook",
    source_post_id: sourcePostId,
    source_url: sourceUrl,
    title,
    description,
    price_lyd: normalizePrice(payload.price_lyd, guessPrice(postText)),
    city: cleanString(payload.city, merchant.city),
    category,
    store_name: cleanString(payload.store_name, merchant.store_name),
    whatsapp_phone: cleanString(payload.whatsapp_phone, merchant.whatsapp_phone),
    image_url: cleanString(payload.image_url, ""),
    raw_payload: {
      manual_import: true,
      source: "admin facebook text import",
      text: postText,
    },
    status: "pending_review",
  };

  const { data, error } = await supabase
    .from("product_drafts")
    .upsert(draft, { onConflict: "merchant_id,source_platform,source_post_id" })
    .select()
    .single();

  if (error) throw error;
  return json({ ok: true, draft: data });
}

async function uploadProductImage(payload: Record<string, unknown>): Promise<Response> {
  const mimeType = requiredString(payload.mime_type, "نوع الصورة مطلوب.");
  const extension = ALLOWED_IMAGE_TYPES[mimeType];
  if (!extension) {
    return json({ error: "نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WEBP." }, 400);
  }

  const rawData = requiredString(payload.data, "بيانات الصورة مطلوبة.");
  const base64 = rawData.includes(",") ? rawData.split(",").pop() ?? "" : rawData;
  const bytes = decodeBase64(base64);
  if (!bytes.length) return json({ error: "تعذر قراءة الصورة." }, 400);
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return json({ error: "حجم الصورة كبير. اختر صورة أصغر من 5MB." }, 400);
  }

  await ensureImageBucket();

  const safeName = cleanFileName(payload.file_name);
  const filePath = `products/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName}.${extension}`;
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

  return json({ ok: true, url: data.publicUrl, path: filePath });
}

async function updateProduct(payload: Record<string, unknown>): Promise<Response> {
  const id = requiredString(payload.id, "معرف المنتج مطلوب.");
  const category = cleanString(payload.category, "غير مصنف") || "غير مصنف";
  const description = buildProductDescription(
    payload.description,
    payload.sizes,
    payload.colors,
    payload.stock_status,
    payload.extra_images
  );

  const updates = {
    title: requiredString(payload.title, "اسم المنتج مطلوب."),
    description,
    price_lyd: normalizePrice(payload.price_lyd, null),
    city: requiredString(payload.city, "المدينة مطلوبة."),
    category,
    store_name: requiredString(payload.store_name, "اسم المحل مطلوب."),
    whatsapp_phone: requiredString(payload.whatsapp_phone, "رقم واتساب مطلوب."),
    image_url: cleanString(payload.image_url, ""),
    badge: cleanString(payload.badge, category === "مواليد" ? "مواليد" : "جديد"),
    status: normalizeProductStatus(payload.status),
  };

  const { data, error } = await supabase
    .from("products")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return json({ ok: true, product: data });
}

async function updateMerchantStatus(payload: Record<string, unknown>): Promise<Response> {
  const id = requiredString(payload.id, "معرف التاجر مطلوب.");
  const status = normalizeMerchantStatus(payload.status);
  const { data, error } = await supabase
    .from("merchants")
    .update({ status })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return json({ ok: true, merchant: data });
}

async function setProductStatus(payload: Record<string, unknown>, status: "published" | "hidden" | "sold"): Promise<Response> {
  const id = requiredString(payload.id, "معرف المنتج مطلوب.");
  const { data, error } = await supabase
    .from("products")
    .update({ status })
    .eq("id", id)
    .select("id,status")
    .single();

  if (error) throw error;
  return json({ ok: true, product: data });
}

async function deleteProduct(payload: Record<string, unknown>): Promise<Response> {
  const id = requiredString(payload.id, "معرف المنتج مطلوب.");
  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", id);

  if (error) throw error;
  return json({ ok: true });
}

async function rejectDraft(payload: Record<string, unknown>): Promise<Response> {
  const id = requiredString(payload.id, "معرف المسودة مطلوب.");
  const reviewNote = cleanString(payload.review_note, "") || "تحتاج المسودة إلى تعديل قبل النشر.";

  const { data: draft, error: draftError } = await supabase
    .from("product_drafts")
    .select("raw_payload")
    .eq("id", id)
    .maybeSingle();

  if (draftError) throw draftError;
  if (!draft) return json({ error: "Draft not found" }, 404);

  const rawPayload = draft.raw_payload && typeof draft.raw_payload === "object"
    ? draft.raw_payload as Record<string, unknown>
    : {};

  const { error } = await supabase
    .from("product_drafts")
    .update({
      status: "rejected",
      raw_payload: {
        ...rawPayload,
        review_note: reviewNote,
        rejected_at: new Date().toISOString(),
      },
    })
    .eq("id", id);

  if (error) throw error;
  return json({ ok: true });
}

async function approveDraft(payload: Record<string, unknown>): Promise<Response> {
  const id = String(payload.id ?? "");
  if (!id) return json({ error: "id is required" }, 400);

  const { data: draft, error: draftError } = await supabase
    .from("product_drafts")
    .select("*")
    .eq("id", id)
    .single();

  if (draftError || !draft) {
    return json({ error: "Draft not found" }, 404);
  }

  const category = cleanString(payload.category, draft.category);
  const description = buildProductDescription(
    payload.description,
    payload.sizes,
    payload.colors,
    payload.stock_status,
    payload.extra_images,
    draft.description
  );
  const product = {
    merchant_id: draft.merchant_id,
    draft_id: draft.id,
    title: cleanString(payload.title, draft.title),
    description,
    price_lyd: normalizePrice(payload.price_lyd, draft.price_lyd),
    city: cleanString(payload.city, draft.city),
    category,
    store_name: cleanString(payload.store_name, draft.store_name),
    whatsapp_phone: cleanString(payload.whatsapp_phone, draft.whatsapp_phone),
    image_url: cleanString(payload.image_url, draft.image_url),
    source_url: draft.source_url,
    badge: category === "مواليد" ? "مواليد" : "جديد",
    status: "published",
  };

  const editProductId = getEditProductId(draft.raw_payload);
  const productQuery = editProductId
    ? supabase.from("products").update(product).eq("id", editProductId).select().single()
    : supabase.from("products").insert(product).select().single();

  const { data: inserted, error: insertError } = await productQuery;

  if (insertError) throw insertError;

  const { error: updateError } = await supabase
    .from("product_drafts")
    .update({
      status: "approved",
      title: product.title,
      description: product.description,
      price_lyd: product.price_lyd,
      city: product.city,
      category: product.category,
      store_name: product.store_name,
      whatsapp_phone: product.whatsapp_phone,
      image_url: product.image_url,
    })
    .eq("id", id);

  if (updateError) throw updateError;

  return json({ ok: true, product: inserted });
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

function normalizePrice(value: unknown, fallback: unknown): number | null {
  const resolved = value === "" || value === null || value === undefined ? fallback : value;
  if (resolved === "" || resolved === null || resolved === undefined) return null;
  const number = Number(resolved);
  return Number.isFinite(number) ? number : null;
}

function normalizeProductStatus(value: unknown): "published" | "hidden" | "sold" {
  const status = cleanString(value, "published");
  return status === "hidden" || status === "sold" || status === "published" ? status : "published";
}

function normalizeMerchantStatus(value: unknown): "pending" | "active" | "paused" {
  const status = cleanString(value, "active");
  return status === "pending" || status === "paused" || status === "active" ? status : "active";
}

function getEditProductId(rawPayload: unknown): string {
  if (!rawPayload || typeof rawPayload !== "object") return "";
  const value = (rawPayload as Record<string, unknown>).edit_product_id;
  return typeof value === "string" ? value.trim() : "";
}

function guessTitle(message: string): string {
  const cleanLines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\d+/.test(line) && !/(دينار|د\.?\s*ل|lyd|السعر)/i.test(line));

  const candidate = cleanLines[0] || message.replace(/\s+/g, " ").trim();
  return candidate ? candidate.slice(0, 90) : "منتج من فيسبوك";
}

function guessPrice(message: string): number | null {
  const match = message.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:د\.?\s*ل|دينار|lyd)/i)
    || message.match(/(?:السعر|سعر)\s*[:：-]?\s*(\d+(?:[.,]\d{1,2})?)/i);
  if (!match) return null;
  const number = Number(match[1].replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function guessCategory(message: string): string {
  const text = message.toLowerCase();
  if (/(عربة|كراسي|كرسي|stroller|car seat)/i.test(text)) return "عربات وكراسي";
  if (/(حذاء|أحذية|احذية|كوتشي|shoe)/i.test(text)) return "أحذية";
  if (/(مولود|مواليد|رضاعة|بطانية|newborn)/i.test(text)) return "مواليد";
  if (/(لعبة|ألعاب|العاب|toy|puzzle)/i.test(text)) return "ألعاب";
  if (/(ملابس|طقم|بيجامة|فستان|shirt|dress)/i.test(text)) return "ملابس أطفال";
  return "غير مصنف";
}

function buildProductDescription(
  value: unknown,
  sizesValue: unknown,
  colorsValue: unknown,
  stockStatusValue: unknown,
  extraImagesValue?: unknown,
  fallback?: unknown
): string | null {
  const base = stripAttributeLines(cleanString(value, fallback) ?? "");
  const sizes = splitList(sizesValue);
  const colors = splitList(colorsValue);
  const stockStatus = cleanString(stockStatusValue, "");
  const extraImages = splitList(extraImagesValue).filter((item) => /^https?:\/\//i.test(item));
  const lines = [base];

  if (sizes.length) lines.push(`المقاسات المتوفرة: ${sizes.join("، ")}`);
  if (colors.length) lines.push(`الألوان: ${colors.join("، ")}`);
  if (stockStatus) lines.push(`التوفر: ${stockStatus}`);
  if (extraImages.length) lines.push(`الصور الإضافية: ${extraImages.join("، ")}`);

  const description = lines.filter(Boolean).join("\n\n");
  return description || null;
}

function stripAttributeLines(value: string): string {
  return value
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return !/^(المقاسات المتوفرة|المقاسات|الألوان|الالوان|التوفر|الصور الإضافية|صور إضافية)\s*[:：]/.test(trimmed);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
