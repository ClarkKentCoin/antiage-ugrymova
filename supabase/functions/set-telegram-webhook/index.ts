import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type TelegramResponse = {
  ok: boolean;
  description?: string;
  result?: unknown;
};

async function callTelegramApi(
  botToken: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<TelegramResponse> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return response.json();
}

serve(async (req) => {
  const { method, pathname } = { method: req.method, pathname: new URL(req.url).pathname };
  console.log("[set-telegram-webhook] hit", { method, pathname });

  // Handle CORS preflight FIRST
  if (method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  // Only allow POST
  if (method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, description: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !anonKey || !serviceKey) {
      console.error("[set-telegram-webhook] missing backend env (SUPABASE_URL/ANON/SERVICE)");
      return new Response(JSON.stringify({ ok: false, description: "Server misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request body to check for reset flag
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // Body is optional, continue with empty object
    }
    const resetMode = body.reset === true;
    console.log("[set-telegram-webhook] resetMode:", resetMode);

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: authHeader ? { Authorization: authHeader } : {} },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      console.warn("[set-telegram-webhook] unauthorized: no user");
      return new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;

    const { data: isAdmin, error: roleError } = await userClient.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });

    if (roleError) {
      console.error("[set-telegram-webhook] role check error:", roleError);
      return new Response(JSON.stringify({ ok: false, description: "Role check failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!isAdmin) {
      console.warn(`[set-telegram-webhook] forbidden for user ${userId}`);
      return new Response(JSON.stringify({ ok: false, description: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const secretToken = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
    if (!secretToken) {
      console.error("[set-telegram-webhook] TELEGRAM_WEBHOOK_SECRET is not set");
      return new Response(
        JSON.stringify({ ok: false, description: "TELEGRAM_WEBHOOK_SECRET is not configured" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("admin_settings")
      .select("telegram_bot_token")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (settingsError) {
      console.error("[set-telegram-webhook] settings read error:", settingsError);
      return new Response(JSON.stringify({ ok: false, description: "Settings read failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!settings?.telegram_bot_token) {
      return new Response(JSON.stringify({ ok: false, description: "Bot token is not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const botToken = settings.telegram_bot_token;
    const webhookUrl = `${supabaseUrl}/functions/v1/telegram-bot-webhook`;

    let deleteResult: TelegramResponse | null = null;

    // If reset mode, first delete the webhook
    if (resetMode) {
      console.log("[set-telegram-webhook] calling deleteWebhook with drop_pending_updates=true");
      deleteResult = await callTelegramApi(botToken, "deleteWebhook", {
        drop_pending_updates: true,
      });
      console.log(
        `[set-telegram-webhook] deleteWebhook result ok=${deleteResult.ok} description=${deleteResult.description ?? "none"}`
      );
    }

    // Set the webhook
    console.log(`[set-telegram-webhook] setting webhook url=${webhookUrl}`);
    const setResult = await callTelegramApi(botToken, "setWebhook", {
      url: webhookUrl,
      secret_token: secretToken,
      allowed_updates: ["message"],
    });

    console.log(
      `[set-telegram-webhook] setWebhook result ok=${setResult.ok} description=${setResult.description ?? "none"}`
    );

    const responseBody: Record<string, unknown> = {
      ok: setResult.ok,
      reset: resetMode,
      setResult,
    };

    if (deleteResult !== null) {
      responseBody.deleteResult = deleteResult;
    }

    // If reset mode, add description about both operations
    if (resetMode) {
      responseBody.description = setResult.ok
        ? "Webhook reset successfully"
        : setResult.description ?? "setWebhook failed";
    } else {
      responseBody.description = setResult.description;
    }

    return new Response(JSON.stringify(responseBody), {
      status: setResult.ok ? 200 : 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[set-telegram-webhook] error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ ok: false, description: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
