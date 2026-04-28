import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_API_KEY = Deno.env.get("ADMIN_API_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!isAuthorized(req)) {
      return json({ error: "Unauthorized" }, 401);
    }

    const url = new URL(req.url);
    const action = url.pathname.split("/").pop();

    if (req.method === "GET") {
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

    if (req.method === "POST" && action === "approve") {
      const payload = await req.json();
      return await approveDraft(payload);
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

function isAuthorized(req: Request): boolean {
  const header = req.headers.get("x-admin-key");
  return Boolean(ADMIN_API_KEY && header && header === ADMIN_API_KEY);
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

  const product = {
    merchant_id: draft.merchant_id,
    draft_id: draft.id,
    title: cleanString(payload.title, draft.title),
    description: cleanString(payload.description, draft.description),
    price_lyd: normalizePrice(payload.price_lyd, draft.price_lyd),
    city: cleanString(payload.city, draft.city),
    category: cleanString(payload.category, draft.category),
    store_name: cleanString(payload.store_name, draft.store_name),
    whatsapp_phone: cleanString(payload.whatsapp_phone, draft.whatsapp_phone),
    image_url: cleanString(payload.image_url, draft.image_url),
    source_url: draft.source_url,
    badge: draft.category === "مواليد" ? "مواليد" : "جديد",
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

function normalizePrice(value: unknown, fallback: unknown): number | null {
  const resolved = value === "" || value === null || value === undefined ? fallback : value;
  if (resolved === "" || resolved === null || resolved === undefined) return null;
  const number = Number(resolved);
  return Number.isFinite(number) ? number : null;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
