import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveTenantFromRequest, getAdminSettingsForTenant } from "../_shared/tenant.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // 1. Authenticate admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const userId = userData.user.id;

    // 2. Check admin role
    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleData) return json({ error: "Forbidden" }, 403);

    // 3. Parse & validate body
    const body = await req.json();
    const { thread_id, text } = body;

    if (!thread_id || typeof thread_id !== "string") {
      return json({ error: "thread_id is required" }, 400);
    }
    if (!text || typeof text !== "string" || !text.trim()) {
      return json({ error: "text is required" }, 400);
    }

    // 4. Resolve tenant
    const tenant = await resolveTenantFromRequest({ req, supabaseAdmin, body });
    console.log(`[send-chat-reply] tenant=${tenant.tenantId} source=${tenant.source}`);

    // 5. Load thread & verify tenant ownership
    const { data: thread, error: threadErr } = await supabaseAdmin
      .from("chat_threads")
      .select("id, tenant_id, telegram_user_id, subscriber_id")
      .eq("id", thread_id)
      .maybeSingle();

    if (threadErr || !thread) {
      return json({ error: "Thread not found" }, 404);
    }
    if (thread.tenant_id !== tenant.tenantId) {
      return json({ error: "Thread does not belong to this tenant" }, 403);
    }

    // 6. Load bot token
    const { data: settings } = await getAdminSettingsForTenant(
      supabaseAdmin,
      tenant.tenantId,
      "telegram_bot_token"
    );
    if (!settings?.telegram_bot_token) {
      return json({ error: "Telegram bot token not configured" }, 500);
    }

    const botToken = settings.telegram_bot_token as string;
    const trimmedText = text.trim();

    // 7. Insert outgoing message with status 'queued'
    const { data: msgRow, error: insertErr } = await supabaseAdmin
      .from("chat_messages")
      .insert({
        tenant_id: tenant.tenantId,
        thread_id: thread.id,
        direction: "outgoing",
        sender_type: "admin",
        message_type: "text",
        text_content: trimmedText,
        is_read_by_admin: true,
        telegram_status: "queued",
      })
      .select("id")
      .single();

    if (insertErr || !msgRow) {
      console.error("[send-chat-reply] Insert error:", insertErr);
      return json({ error: "Failed to create message" }, 500);
    }

    const messageId = msgRow.id;

    // 8. Send via Telegram Bot API
    let telegramMessageId: number | null = null;
    let finalStatus = "sent";
    let errorDescription: string | null = null;

    try {
      const tgRes = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: thread.telegram_user_id,
            text: trimmedText,
          }),
        }
      );
      const tgData = await tgRes.json();

      if (tgData.ok) {
        telegramMessageId = tgData.result?.message_id ?? null;
        finalStatus = "sent";
      } else {
        finalStatus = "failed";
        errorDescription = tgData.description || "Unknown Telegram error";
        console.warn("[send-chat-reply] Telegram rejected:", errorDescription);
      }
    } catch (err) {
      finalStatus = "failed";
      errorDescription = err instanceof Error ? err.message : String(err);
      console.error("[send-chat-reply] Telegram send exception:", errorDescription);
    }

    // 9. Update message status
    await supabaseAdmin
      .from("chat_messages")
      .update({
        telegram_status: finalStatus,
        telegram_message_id: telegramMessageId,
      })
      .eq("id", messageId);

    // 10. Update thread cache fields (no admin_unread_count change for outgoing)
    const preview = trimmedText.length > 100 ? trimmedText.slice(0, 100) + "…" : trimmedText;
    await supabaseAdmin
      .from("chat_threads")
      .update({
        last_message_at: new Date().toISOString(),
        last_message_direction: "outgoing",
        last_message_preview: preview,
        updated_at: new Date().toISOString(),
      })
      .eq("id", thread.id);

    if (finalStatus === "failed") {
      return json(
        { error: "telegram_send_failed", message: errorDescription, message_id: messageId },
        502
      );
    }

    return json({
      success: true,
      message_id: messageId,
      telegram_message_id: telegramMessageId,
    });
  } catch (err) {
    console.error("[send-chat-reply] Unhandled:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
