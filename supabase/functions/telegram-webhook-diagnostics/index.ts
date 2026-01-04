import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface WebhookInfo {
  url?: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  ip_address?: string;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  allowed_updates?: string[];
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Verify admin role via JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check admin role
    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action || "check";

    // Get bot token from admin_settings
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("admin_settings")
      .select("telegram_bot_token")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (settingsError || !settings?.telegram_bot_token) {
      return new Response(
        JSON.stringify({ 
          error: "Bot token not configured",
          env: {
            has_webhook_secret: !!Deno.env.get("TELEGRAM_WEBHOOK_SECRET"),
            has_supabase_url: !!Deno.env.get("SUPABASE_URL"),
            has_service_role_key: !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
          }
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const botToken = settings.telegram_bot_token;
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const expectedWebhookUrl = `${supabaseUrl}/functions/v1/telegram-bot-webhook`;
    const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");

    if (action === "set-webhook") {
      // Set webhook with secret token
      if (!webhookSecret) {
        return new Response(
          JSON.stringify({ error: "TELEGRAM_WEBHOOK_SECRET not configured" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const setResponse = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: expectedWebhookUrl,
          secret_token: webhookSecret,
          allowed_updates: ["message"],
        }),
      });

      const setResult = await setResponse.json();
      console.log("setWebhook result:", JSON.stringify(setResult));

      if (!setResult.ok) {
        return new Response(
          JSON.stringify({ 
            error: "Failed to set webhook",
            telegram_error: setResult.description,
            env: {
              has_webhook_secret: true,
              has_supabase_url: true,
              has_service_role_key: true,
            }
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get updated webhook info
      const infoResponse = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
      const infoResult = await infoResponse.json();

      return new Response(
        JSON.stringify({
          success: true,
          message: "Webhook set successfully",
          expected_url: expectedWebhookUrl,
          webhook_info: infoResult.ok ? infoResult.result : null,
          env: {
            has_webhook_secret: true,
            has_supabase_url: true,
            has_service_role_key: true,
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Default action: check webhook status
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
    const result = await response.json();

    if (!result.ok) {
      return new Response(
        JSON.stringify({ 
          error: "Failed to get webhook info",
          telegram_error: result.description,
          env: {
            has_webhook_secret: !!webhookSecret,
            has_supabase_url: !!supabaseUrl,
            has_service_role_key: !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
          }
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const webhookInfo: WebhookInfo = result.result;

    return new Response(
      JSON.stringify({
        expected_url: expectedWebhookUrl,
        webhook_info: {
          url: webhookInfo.url || null,
          pending_update_count: webhookInfo.pending_update_count ?? 0,
          last_error_date: webhookInfo.last_error_date ?? null,
          last_error_message: webhookInfo.last_error_message ?? null,
          max_connections: webhookInfo.max_connections ?? null,
          ip_address: webhookInfo.ip_address ?? null,
          allowed_updates: webhookInfo.allowed_updates ?? [],
        },
        url_match: webhookInfo.url === expectedWebhookUrl,
        env: {
          has_webhook_secret: !!webhookSecret,
          has_supabase_url: !!supabaseUrl,
          has_service_role_key: !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
        }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Diagnostics error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
