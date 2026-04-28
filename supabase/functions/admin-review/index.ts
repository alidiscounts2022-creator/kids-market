import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_API_KEY = (Deno.env.get("ADMIN_API_KEY") ?? "").trim();

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

    if (req.method === "POST" && action === "seed") {
      return await createDemoDraft();
    }

    if (req.method === "POST" && action === "reject") {
      const { id } = await req.json();
      if (!id) return json({ error: "id is required" }, 400);

      const { error } = await supabase
        .from("product_drafts")
        .update({ status: "rejected" })
        .eq("id", id);

      if (error) throw error;
      return json({ ok: true });
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
  const [pendingDrafts, approvedDrafts, rejectedDrafts, publishedProducts, latestProduct] = await Promise.all([
    countRows("product_drafts", "pending_review"),
    countRows("product_drafts", "approved"),
    countRows("product_drafts", "rejected"),
    countRows("products", "published"),
    getLatestProduct(),
  ]);

  return json({
    stats: {
      pending_drafts: pendingDrafts,
      approved_drafts: approvedDrafts,
      rejected_drafts: rejectedDrafts,
      published_products: publishedProducts,
      latest_product: latestProduct,
      manual_publish_enabled: true,
    },
  });
}

async function countRows(table: string, status: string): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("status", status);

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
    payload.stock_status
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

  const { data: inserted, error: insertError } = await supabase
    .from("products")
    .insert(product)
    .select()
    .single();

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

function buildProductDescription(
  value: unknown,
  sizesValue: unknown,
  colorsValue: unknown,
  stockStatusValue: unknown,
  fallback?: unknown
): string | null {
  const base = stripAttributeLines(cleanString(value, fallback) ?? "");
  const sizes = splitList(sizesValue);
  const colors = splitList(colorsValue);
  const stockStatus = cleanString(stockStatusValue, "");
  const lines = [base];

  if (sizes.length) lines.push(`المقاسات المتوفرة: ${sizes.join("، ")}`);
  if (colors.length) lines.push(`الألوان: ${colors.join("، ")}`);
  if (stockStatus) lines.push(`التوفر: ${stockStatus}`);

  const description = lines.filter(Boolean).join("\n\n");
  return description || null;
}

function stripAttributeLines(value: string): string {
  return value
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return !/^(المقاسات المتوفرة|المقاسات|الألوان|الالوان|التوفر)\s*[:：]/.test(trimmed);
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

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
