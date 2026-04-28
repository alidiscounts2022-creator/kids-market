import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type FacebookPost = {
  id: string;
  message?: string;
  created_time?: string;
  permalink_url?: string;
  full_picture?: string;
  attachments?: {
    data?: Array<{
      media?: { image?: { src?: string } };
      subattachments?: { data?: Array<{ media?: { image?: { src?: string } } }> };
    }>;
  };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GRAPH_VERSION = Deno.env.get("FACEBOOK_GRAPH_VERSION") ?? "v20.0";
const ADMIN_API_KEY = Deno.env.get("ADMIN_API_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    if (!isAuthorized(req)) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { merchant_id, facebook_page_id, limit = 20 } = await req.json();
    if (!merchant_id || !facebook_page_id) {
      return json({ error: "merchant_id and facebook_page_id are required" }, 400);
    }

    const { data: connection, error: connectionError } = await supabase
      .from("facebook_connections")
      .select("*, merchants(store_name, city, whatsapp_phone)")
      .eq("merchant_id", merchant_id)
      .eq("facebook_page_id", facebook_page_id)
      .eq("status", "active")
      .single();

    if (connectionError || !connection) {
      return json({ error: "Facebook connection not found" }, 404);
    }

    const { data: job } = await supabase
      .from("import_jobs")
      .insert({
        merchant_id,
        source_platform: "facebook",
        status: "running",
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    const posts = await fetchFacebookPosts(facebook_page_id, connection.page_access_token, limit);
    const merchant = Array.isArray(connection.merchants) ? connection.merchants[0] : connection.merchants;

    const drafts = posts.map((post) => {
      const message = post.message ?? "";
      const title = guessTitle(message);
      const price = guessPrice(message);
      return {
        merchant_id,
        source_platform: "facebook",
        source_post_id: post.id,
        source_url: post.permalink_url,
        title,
        description: message,
        price_lyd: price,
        city: merchant.city,
        category: guessCategory(message),
        store_name: merchant.store_name,
        whatsapp_phone: merchant.whatsapp_phone,
        image_url: pickImage(post),
        raw_payload: post,
        status: "pending_review",
      };
    });

    if (drafts.length) {
      const { error: upsertError } = await supabase
        .from("product_drafts")
        .upsert(drafts, { onConflict: "merchant_id,source_platform,source_post_id" });

      if (upsertError) throw upsertError;
    }

    if (job?.id) {
      await supabase
        .from("import_jobs")
        .update({
          status: "completed",
          imported_count: drafts.length,
          finished_at: new Date().toISOString(),
        })
        .eq("id", job.id);
    }

    await supabase
      .from("facebook_connections")
      .update({ last_imported_at: new Date().toISOString() })
      .eq("id", connection.id);

    return json({ imported_count: drafts.length, drafts });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

function isAuthorized(req: Request): boolean {
  const header = req.headers.get("x-admin-key");
  return Boolean(ADMIN_API_KEY && header && header === ADMIN_API_KEY);
}

async function fetchFacebookPosts(pageId: string, accessToken: string, limit: number): Promise<FacebookPost[]> {
  const fields = [
    "id",
    "message",
    "created_time",
    "permalink_url",
    "full_picture",
    "attachments{media,subattachments}",
  ].join(",");

  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/posts`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("limit", String(Math.min(limit, 50)));
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message ?? "Facebook API request failed");
  }
  return body.data ?? [];
}

function guessTitle(message: string): string {
  const clean = message.replace(/\s+/g, " ").trim();
  if (!clean) return "منتج من فيسبوك";
  return clean.slice(0, 80);
}

function guessPrice(message: string): number | null {
  const match = message.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:د\.?\s*ل|دينار|lyd)/i);
  if (!match) return null;
  return Number(match[1].replace(",", "."));
}

function guessCategory(message: string): string {
  const text = message.toLowerCase();
  if (/عربة|كرسي|كراسي|car seat|stroller/.test(text)) return "عربات وكراسي";
  if (/حذاء|أحذية|كوتشي|shoe/.test(text)) return "أحذية";
  if (/مولود|مواليد|رضاعة|بطانية|newborn/.test(text)) return "مواليد";
  if (/لعبة|ألعاب|toy|puzzle/.test(text)) return "ألعاب";
  if (/ملابس|طقم|بيجامة|فستان|shirt|dress/.test(text)) return "ملابس أطفال";
  return "غير مصنف";
}

function pickImage(post: FacebookPost): string | null {
  if (post.full_picture) return post.full_picture;
  const first = post.attachments?.data?.[0];
  const direct = first?.media?.image?.src;
  if (direct) return direct;
  return first?.subattachments?.data?.[0]?.media?.image?.src ?? null;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
