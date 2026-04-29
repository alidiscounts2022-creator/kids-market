import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const productId = cleanString(payload.product_id);
    if (!productId) return json({ ok: true, skipped: true });

    const { data: product, error } = await supabase
      .from("products")
      .select("id,merchant_id,title,store_name,city,category")
      .eq("id", productId)
      .maybeSingle();

    if (error || !product?.merchant_id) {
      return json({ ok: true, skipped: true });
    }

    await supabase.from("import_jobs").insert({
      merchant_id: product.merchant_id,
      source_platform: "whatsapp_inquiry",
      status: "completed",
      imported_count: 1,
      error_message: JSON.stringify({
        product_id: product.id,
        product_code: cleanString(payload.product_code),
        title: product.title,
        store_name: product.store_name,
        city: product.city,
        category: product.category,
        source: cleanString(payload.source),
        size: cleanString(payload.size),
        color: cleanString(payload.color),
        user_agent: req.headers.get("user-agent") ?? "",
      }),
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    });

    return json({ ok: true });
  } catch {
    return json({ ok: true, skipped: true });
  }
});

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
