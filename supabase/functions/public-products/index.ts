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

  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const url = new URL(req.url);
    const limit = clamp(Number(url.searchParams.get("limit") ?? 60), 1, 100);
    const id = cleanString(url.searchParams.get("id"));
    const merchantId = cleanString(url.searchParams.get("merchant_id"));
    const store = cleanString(url.searchParams.get("store"));
    const phone = cleanString(url.searchParams.get("phone")).replace(/\D/g, "");
    const city = cleanString(url.searchParams.get("city"));
    const category = cleanString(url.searchParams.get("category"));

    let query = supabase
      .from("products")
      .select("id,merchant_id,title,description,price_lyd,city,category,store_name,whatsapp_phone,image_url,badge,source_url,created_at")
      .eq("status", "published");

    if (id) query = query.eq("id", id);
    if (merchantId) query = query.eq("merchant_id", merchantId);
    if (store) query = query.eq("store_name", store);
    if (phone) query = query.eq("whatsapp_phone", phone);
    if (city && city !== "all") query = query.eq("city", city);
    if (category && category !== "all") query = query.eq("category", category);

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(id ? 1 : limit);

    if (error) throw error;
    return json({ products: data ?? [] });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
