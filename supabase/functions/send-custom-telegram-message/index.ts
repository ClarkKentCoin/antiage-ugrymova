import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveTenantFromRequest, getAdminSettingsForTenant } from "../_shared/tenant.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Verify admin auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;

    // Check admin role
    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { subscriber_id, message, parse_mode = "HTML" } = body;

    if (!subscriber_id || !message?.trim()) {
      return new Response(
        JSON.stringify({ error: "subscriber_id and message are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve tenant
    const tenant = await resolveTenantFromRequest({ req, supabaseAdmin, body });

    // Load subscriber
    const { data: subscriber, error: subError } = await supabaseAdmin
      .from("subscribers")
      .select("id, telegram_user_id, tenant_id, telegram_username, first_name")
      .eq("id", subscriber_id)
      .maybeSingle();

    if (subError || !subscriber) {
      return new Response(
        JSON.stringify({ error: "Subscriber not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Tenant safety: ensure subscriber belongs to resolved tenant
    if (subscriber.tenant_id && subscriber.tenant_id !== tenant.tenantId) {
      return new Response(
        JSON.stringify({ error: "Subscriber does not belong to this tenant" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load bot token from admin_settings
    const { data: settings, error: settingsError } = await getAdminSettingsForTenant(
      supabaseAdmin,
      tenant.tenantId,
      "telegram_bot_token"
    );

    if (settingsError || !settings?.telegram_bot_token) {
      return new Response(
        JSON.stringify({ error: "Telegram bot token not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const botToken = settings.telegram_bot_token as string;
    const telegramUserId = subscriber.telegram_user_id;

    // Send message via Telegram Bot API
    let telegramMessageId: number | null = null;
    let status = "sent";
    let errorMessage: string | null = null;

    try {
      const tgResponse = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: telegramUserId,
            text: message,
            parse_mode: parse_mode,
          }),
        }
      );

      const tgResult = await tgResponse.json();

      if (tgResult.ok) {
        telegramMessageId = tgResult.result?.message_id ?? null;
        status = "sent";
      } else {
        status = "failed";
        errorMessage = tgResult.description || "Unknown Telegram error";
      }
    } catch (err) {
      status = "failed";
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    // Save message record
    const { error: insertError } = await supabaseAdmin
      .from("subscriber_messages")
      .insert({
        tenant_id: tenant.tenantId,
        subscriber_id: subscriber.id,
        telegram_user_id: telegramUserId,
        direction: "outbound",
        message_text: message,
        parse_mode: parse_mode,
        telegram_message_id: telegramMessageId,
        status,
        error_message: errorMessage,
        sent_by_user_id: userId,
      });

    if (insertError) {
      console.error("Failed to save message record:", insertError);
    }

    if (status === "failed") {
      return new Response(
        JSON.stringify({ error: "telegram_send_failed", message: errorMessage }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        telegram_message_id: telegramMessageId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
