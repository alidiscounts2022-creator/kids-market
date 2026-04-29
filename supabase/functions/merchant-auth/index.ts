import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

    const action = new URL(req.url).pathname.split("/").filter(Boolean).pop();
    const payload = await req.json().catch(() => ({}));

    if (action === "register") return await registerMerchant(payload);
    if (action === "login") return await loginMerchant(payload);

    return json({ error: "Not found" }, 404);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, status);
  }
});

async function registerMerchant(payload: Record<string, unknown>): Promise<Response> {
  const email = normalizeEmail(requiredString(payload.email, "البريد الإلكتروني مطلوب."));
  const password = requiredString(payload.password, "كلمة المرور مطلوبة.");
  if (password.length < 8) throw new HttpError("كلمة المرور لازم تكون 8 أحرف على الأقل.", 400);

  const merchantInfo = {
    store_name: requiredString(payload.store_name, "اسم المحل مطلوب."),
    owner_name: cleanString(payload.owner_name, ""),
    city: requiredString(payload.city, "المدينة مطلوبة."),
    whatsapp_phone: normalizePhone(requiredString(payload.whatsapp_phone, "رقم واتساب مطلوب.")),
    facebook_page_url: cleanString(payload.facebook_page_url, ""),
    status: "active",
  };

  const { data: createdUser, error: createUserError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      store_name: merchantInfo.store_name,
      city: merchantInfo.city,
      whatsapp_phone: merchantInfo.whatsapp_phone,
    },
  });

  if (createUserError) {
    if ((createUserError.message || "").toLowerCase().includes("already")) {
      return json({ error: "هذا البريد مسجل مسبقاً. استخدم تسجيل الدخول." }, 409);
    }
    throw createUserError;
  }

  const userId = createdUser.user?.id;
  if (!userId) throw new HttpError("تعذر إنشاء حساب التاجر.", 500);

  try {
    const merchant = await createMerchant(merchantInfo);
    const { error: updateUserError } = await supabase.auth.admin.updateUserById(userId, {
      user_metadata: {
        merchant_id: merchant.id,
        store_name: merchant.store_name,
        city: merchant.city,
        whatsapp_phone: merchant.whatsapp_phone,
      },
    });
    if (updateUserError) throw updateUserError;

    const session = await signIn(email, password);
    return json({
      ok: true,
      message: "تم إنشاء حساب التاجر بنجاح.",
      session,
      merchant,
    });
  } catch (error) {
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
    throw error;
  }
}

async function loginMerchant(payload: Record<string, unknown>): Promise<Response> {
  const email = normalizeEmail(requiredString(payload.email, "البريد الإلكتروني مطلوب."));
  const password = requiredString(payload.password, "كلمة المرور مطلوبة.");
  const session = await signIn(email, password);
  const merchantId = cleanString(session.user?.user_metadata?.merchant_id, "");
  if (!merchantId) {
    return json({ error: "الحساب موجود لكن غير مربوط ببيانات تاجر. أنشئ حساب تاجر جديد أو تواصل مع الإدارة." }, 403);
  }

  const { data: merchant, error } = await supabase
    .from("merchants")
    .select("*")
    .eq("id", merchantId)
    .maybeSingle();

  if (error) throw error;
  if (!merchant) return json({ error: "تعذر العثور على بيانات التاجر المرتبطة بالحساب." }, 404);

  return json({
    ok: true,
    message: "تم تسجيل الدخول بنجاح.",
    session,
    merchant,
  });
}

async function createMerchant(merchantInfo: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase
    .from("merchants")
    .insert(merchantInfo)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function signIn(email: string, password: string): Promise<any> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ email, password }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error_description || payload.msg || payload.error || "بيانات الدخول غير صحيحة.";
    throw new HttpError(String(message), response.status === 400 ? 401 : response.status);
  }

  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_in: payload.expires_in,
    token_type: payload.token_type,
    user: {
      id: payload.user?.id,
      email: payload.user?.email,
      user_metadata: payload.user?.user_metadata ?? {},
    },
  };
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError("أدخل بريد إلكتروني صحيح.", 400);
  return email;
}

function normalizePhone(value: string): string {
  const phone = value.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (!/^218\d{8,10}$/.test(phone)) {
    throw new HttpError("رقم واتساب لازم يبدأ بـ 218 ويكون بصيغة ليبية صحيحة.", 400);
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
  if (!resolved) throw new HttpError(message, 400);
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
