import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_KEY = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
const PRODUCT_COLUMNS = "id,merchant_id,title,description,price_lyd,city,category,store_name,whatsapp_phone,image_url,badge,source_url,sizes,colors,stock_status,created_at";
const PRODUCT_COLUMNS_BASIC = "id,merchant_id,title,description,price_lyd,city,category,store_name,whatsapp_phone,image_url,badge,source_url,created_at";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

    let result = await buildProductsQuery(PRODUCT_COLUMNS, {
      id,
      merchantId,
      store,
      phone,
      city,
      category,
      limit,
    });

    if (result.error && shouldRetryBasicColumns(result.error)) {
      result = await buildProductsQuery(PRODUCT_COLUMNS_BASIC, {
        id,
        merchantId,
        store,
        phone,
        city,
        category,
        limit,
      });
    }

    if (result.error) throw result.error;
    return json({ products: (result.data ?? []).map(withProductDefaults) });
  } catch (error) {
    return json({ error: errorMessage(error) }, 500);
  }
});

function buildProductsQuery(
  columns: string,
  filters: {
    id: string;
    merchantId: string;
    store: string;
    phone: string;
    city: string;
    category: string;
    limit: number;
  },
) {
  let query = supabase
    .from("products")
    .select(columns)
    .eq("status", "published");

  if (filters.id) query = query.eq("id", filters.id);
  if (filters.merchantId) query = query.eq("merchant_id", filters.merchantId);
  if (filters.store) query = query.eq("store_name", filters.store);
  if (filters.phone) query = query.eq("whatsapp_phone", filters.phone);
  if (filters.city && filters.city !== "all") query = query.eq("city", filters.city);
  if (filters.category && filters.category !== "all") query = query.eq("category", filters.category);

  return query
    .order("created_at", { ascending: false })
    .limit(filters.id ? 1 : filters.limit);
}

function shouldRetryBasicColumns(error: unknown): boolean {
  return /column|schema|stock_status|sizes|colors/i.test(errorMessage(error));
}

function withProductDefaults(product: Record<string, unknown>): Record<string, unknown> {
  return {
    sizes: [],
    colors: [],
    stock_status: "متوفر",
    ...product,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message || "Unknown error");
  return String(error || "Unknown error");
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
