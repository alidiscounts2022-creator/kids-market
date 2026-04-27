import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FACEBOOK_APP_ID = Deno.env.get("FACEBOOK_APP_ID") ?? "";
const FACEBOOK_APP_SECRET = Deno.env.get("FACEBOOK_APP_SECRET") ?? "";
const FACEBOOK_REDIRECT_URI = Deno.env.get("FACEBOOK_REDIRECT_URI") ?? "";
const GRAPH_VERSION = Deno.env.get("FACEBOOK_GRAPH_VERSION") ?? "v20.0";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.pathname.split("/").pop();

    if (action === "start") {
      const merchantId = url.searchParams.get("merchant_id");
      if (!merchantId) return json({ error: "merchant_id is required" }, 400);

      const authUrl = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
      authUrl.searchParams.set("client_id", FACEBOOK_APP_ID);
      authUrl.searchParams.set("redirect_uri", FACEBOOK_REDIRECT_URI);
      authUrl.searchParams.set("state", merchantId);
      authUrl.searchParams.set("scope", "pages_show_list,pages_read_engagement,pages_read_user_content");
      return Response.redirect(authUrl.toString(), 302);
    }

    if (action === "callback") {
      const code = url.searchParams.get("code");
      const merchantId = url.searchParams.get("state");
      if (!code || !merchantId) return json({ error: "Missing code or state" }, 400);

      const userToken = await exchangeCodeForToken(code);
      const pages = await fetchManagedPages(userToken);

      const connections = pages.map((page) => ({
        merchant_id: merchantId,
        facebook_page_id: page.id,
        facebook_page_name: page.name,
        page_access_token: page.access_token,
        status: "active",
      }));

      if (connections.length) {
        const { error } = await supabase
          .from("facebook_connections")
          .upsert(connections, { onConflict: "merchant_id,facebook_page_id" });
        if (error) throw error;
      }

      return html(`تم ربط ${connections.length} صفحة فيسبوك. يمكنك الرجوع إلى لوحة الإدارة الآن.`);
    }

    return json({ error: "Unknown action" }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

async function exchangeCodeForToken(code: string): Promise<string> {
  const tokenUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", FACEBOOK_APP_ID);
  tokenUrl.searchParams.set("client_secret", FACEBOOK_APP_SECRET);
  tokenUrl.searchParams.set("redirect_uri", FACEBOOK_REDIRECT_URI);
  tokenUrl.searchParams.set("code", code);

  const response = await fetch(tokenUrl);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message ?? "Could not exchange Facebook code");
  }
  return body.access_token;
}

async function fetchManagedPages(userAccessToken: string): Promise<Array<{ id: string; name: string; access_token: string }>> {
  const pagesUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`);
  pagesUrl.searchParams.set("fields", "id,name,access_token,tasks");
  pagesUrl.searchParams.set("access_token", userAccessToken);

  const response = await fetch(pagesUrl);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message ?? "Could not fetch managed pages");
  }
  return body.data ?? [];
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function html(message: string): Response {
  return new Response(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><body style="font-family:system-ui;padding:32px;background:#F5F7FA;color:#1F2937"><h1>${message}</h1></body></html>`, {
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

