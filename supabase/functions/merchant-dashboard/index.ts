import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const context = await requireMerchant(req);
    const action = new URL(req.url).pathname.split("/").filter(Boolean).pop();

    if (req.method === "GET") {
      return await getDashboard(context);
    }

    if (req.method === "POST" && action === "profile") {
      const payload = await req.json().catch(() => ({}));
      return await updateProfile(context, payload);
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unknown error";
    return json({ error: message }, status);
  }
});

async function getDashboard(context: MerchantContext): Promise<Response> {
  const [productsResult, draftsResult] = await Promise.all([
    supabase
      .from("products")
      .select("*")
      .eq("merchant_id", context.merchant.id)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("product_drafts")
      .select("*")
      .eq("merchant_id", context.merchant.id)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (productsResult.error) throw productsResult.error;
  if (draftsResult.error) throw draftsResult.error;

  const products = (productsResult.data ?? []).map(enrichProduct);
  const drafts = (draftsResult.data ?? []).map(enrichProduct);

  return json({
    ok: true,
    merchant: context.merchant,
    products,
    drafts,
    stats: {
      published: products.filter((item) => item.status === "published").length,
      hidden: products.filter((item) => item.status === "hidden").length,
      sold: products.filter((item) => item.status === "sold").length,
      pending_review: drafts.filter((item) => item.status === "pending_review").length,
      approved: drafts.filter((item) => item.status === "approved").length,
      rejected: drafts.filter((item) => item.status === "rejected").length,
    },
  });
}

async function updateProfile(context: MerchantContext, payload: Record<string, unknown>): Promise<Response> {
  const updates = {
    store_name: requiredString(payload.store_name, "اسم المحل مطلوب."),
    owner_name: cleanString(payload.owner_name, ""),
    city: requiredString(payload.city, "المدينة مطلوبة."),
    whatsapp_phone: normalizePhone(requiredString(payload.whatsapp_phone, "رقم واتساب مطلوب.")),
    facebook_page_url: cleanString(payload.facebook_page_url, ""),
  };

  const { data: merchant, error } = await supabase
    .from("merchants")
    .update(updates)
    .eq("id", context.merchant.id)
    .select()
    .single();

  if (error) throw error;

  const { error: userError } = await supabase.auth.admin.updateUserById(context.user.id, {
    user_metadata: {
      ...(context.user.user_metadata ?? {}),
      merchant_id: merchant.id,
      store_name: merchant.store_name,
      city: merchant.city,
      whatsapp_phone: merchant.whatsapp_phone,
    },
  });

  if (userError) throw userError;
  return json({ ok: true, merchant, message: "تم حفظ بيانات المحل." });
}

async function requireMerchant(req: Request): Promise<MerchantContext> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError("سجل الدخول كتاجر أولاً.", 401);

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) throw new HttpError("جلسة التاجر غير صالحة. سجل الدخول من جديد.", 401);

  const merchantId = cleanString(userData.user.user_metadata?.merchant_id, "");
  if (!merchantId) throw new HttpError("هذا الحساب غير مربوط بملف تاجر.", 403);

  const { data: merchant, error } = await supabase
    .from("merchants")
    .select("*")
    .eq("id", merchantId)
    .maybeSingle();

  if (error) throw error;
  if (!merchant) throw new HttpError("تعذر العثور على بيانات التاجر.", 404);

  return { user: userData.user, merchant };
}

function enrichProduct(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    product_code: productCode(row.id),
    merchant_code: parseMerchantCode(row.description),
    review_note: parseReviewNote(row.raw_payload),
  };
}

function parseMerchantCode(description: unknown): string {
  for (const line of String(description || "").split(/\r?\n/)) {
    const match = line.trim().match(/^(كود التاجر|كود المنتج عند التاجر)\s*[:：]\s*(.+)$/);
    if (match?.[2]) return match[2].trim();
  }
  return "";
}

function parseReviewNote(rawPayload: unknown): string {
  if (!rawPayload || typeof rawPayload !== "object") return "";
  const note = (rawPayload as Record<string, unknown>).review_note;
  return typeof note === "string" ? note.trim() : "";
}

function productCode(id: unknown): string {
  const clean = String(id || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  return `TF-${(clean || "PRODUCT").slice(0, 6)}`;
}

function normalizePhone(value: string): string {
  const phone = value.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (!/^218\d{8,10}$/.test(phone)) {
    throw new Error("رقم واتساب لازم يبدأ بـ 218 ويكون بصيغة ليبية صحيحة.");
  }
  return phone;
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

type MerchantContext = {
  user: {
    id: string;
    user_metadata?: Record<string, unknown>;
  };
  merchant: Record<string, any>;
};
