import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { DEFAULT_TENANT_ID, requireAdminSettingsForTenant } from "../_shared/tenant.ts";

interface TelegramResponse {
  ok: boolean;
  result?: any;
  description?: string;
}

const INVITE_LINK_EXPIRY_SECONDS = 600; // 10 minutes

async function callTelegramApi(botToken: string, method: string, params: Record<string, any> = {}): Promise<TelegramResponse> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  
  return response.json();
}

// Revoke old invite links for a subscriber
async function revokeOldInviteLinks(
  supabaseAdmin: any,
  botToken: string,
  channelId: string,
  subscriberId: string
): Promise<void> {
  // Get all non-revoked links for this subscriber
  const { data: oldLinks, error } = await supabaseAdmin
    .from("invite_links")
    .select("id, invite_link")
    .eq("subscriber_id", subscriberId)
    .eq("revoked", false);

  if (error) {
    console.error("Error fetching old invite links:", error.message);
    return;
  }

  if (!oldLinks || oldLinks.length === 0) {
    return;
  }

  console.log(`Revoking ${oldLinks.length} old invite links for subscriber ${subscriberId}`);

  for (const link of oldLinks) {
    // Revoke the link in Telegram
    const revokeResult = await callTelegramApi(botToken, "revokeChatInviteLink", {
      chat_id: channelId,
      invite_link: link.invite_link,
    });

    if (!revokeResult.ok) {
      console.log(`Could not revoke link (may be expired): ${revokeResult.description}`);
    }

    // Mark as revoked in database
    await supabaseAdmin
      .from("invite_links")
      .update({ revoked: true, revoked_at: new Date().toISOString() })
      .eq("id", link.id);
  }
}

// Create and save a new invite link with expiry
async function createAndSaveInviteLink(
  supabaseAdmin: any,
  botToken: string,
  channelId: string,
  subscriberId: string
): Promise<{ success: boolean; invite_link?: string; error?: string }> {
  const expireDate = Math.floor(Date.now() / 1000) + INVITE_LINK_EXPIRY_SECONDS;
  const expiresAt = new Date(Date.now() + INVITE_LINK_EXPIRY_SECONDS * 1000).toISOString();

  // Create invite link with expiration
  const inviteResult = await callTelegramApi(botToken, "createChatInviteLink", {
    chat_id: channelId,
    expire_date: expireDate,
    member_limit: 1, // Also keep member_limit as additional protection
    creates_join_request: false,
  });

  console.log("createChatInviteLink result:", JSON.stringify(inviteResult));

  if (!inviteResult.ok) {
    console.error("Failed to create invite link:", inviteResult.description);
    return { success: false, error: inviteResult.description || "Failed to create invite link" };
  }

  // Save the link to database
  const { error: insertError } = await supabaseAdmin
    .from("invite_links")
    .insert({
      subscriber_id: subscriberId,
      invite_link: inviteResult.result.invite_link,
      expires_at: expiresAt,
      revoked: false,
    });

  if (insertError) {
    console.error("Error saving invite link to database:", insertError.message);
    // Continue anyway - the link was created successfully
  }

  return { success: true, invite_link: inviteResult.result.invite_link };
}

serve(async (req) => {
  const { method, pathname } = { method: req.method, pathname: new URL(req.url).pathname };
  console.log("[telegram-channel] hit", { method, pathname });

  // Handle CORS preflight FIRST
  if (method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  // Only allow POST
  if (method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !anonKey || !serviceKey) {
      console.error("[telegram-channel] missing backend env");
      return new Response(
        JSON.stringify({ ok: false, error: "Server misconfigured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with service role for database operations
    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    // Authentication check - require valid user session
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      console.error("[telegram-channel] No authorization header provided");
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized - No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create a client with the user's token to verify their identity
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify the user's token
    const { data: userData, error: authError } = await supabaseUser.auth.getUser();
    
    if (authError || !userData?.user) {
      console.error("[telegram-channel] Auth error:", authError?.message || "No user found");
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized - Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = userData.user.id;
    console.log(`[telegram-channel] Authenticated user: ${userId}`);

    // Check if user has admin role using RPC
    const { data: isAdmin, error: roleError } = await supabaseUser.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });

    if (roleError) {
      console.error("[telegram-channel] Role check error:", roleError.message);
      return new Response(
        JSON.stringify({ ok: false, error: "Error checking permissions" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!isAdmin) {
      console.warn(`[telegram-channel] Forbidden for user ${userId}`);
      return new Response(
        JSON.stringify({ ok: false, error: "Forbidden - Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[telegram-channel] Admin access verified for user: ${userId}`);

    // Parse request body
    const body = await req.json();
    const { 
      action, 
      telegram_user_id: tgUserId, 
      telegramUserId: tgUserIdCamel,
      subscriber_id: subId,
      subscriberId: subIdCamel,
      tenant_slug: tenantSlug,
    } = body;

    // Support both snake_case and camelCase
    const telegram_user_id = tgUserId ?? tgUserIdCamel;
    const subscriber_id = subId ?? subIdCamel;

    // Resolve tenant (optional - defaults to first admin's settings)
    let tenantId = DEFAULT_TENANT_ID;
    if (tenantSlug) {
      const { data: tenantData } = await supabaseAdmin
        .from("tenants")
        .select("id")
        .eq("slug", tenantSlug)
        .maybeSingle();
      if (tenantData?.id) {
        tenantId = tenantData.id;
      }
    }
    console.log(`[telegram-channel] Using tenant_id: ${tenantId}`);

    // Get admin settings for bot token and channel ID for this tenant
    let settings: any;
    try {
      settings = await requireAdminSettingsForTenant(
        supabaseAdmin,
        tenantId,
        "telegram_bot_token, telegram_channel_id"
      );
    } catch (err) {
      console.error("[telegram-channel] Settings error:", err);
      return new Response(
        JSON.stringify({ ok: false, error: "Telegram bot not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!settings?.telegram_bot_token || !settings?.telegram_channel_id) {
      console.error("[telegram-channel] Missing bot token or channel ID");
      return new Response(
        JSON.stringify({ ok: false, error: "Telegram bot not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const botToken = settings.telegram_bot_token;
    const telegram_channel_id = settings.telegram_channel_id;
    
    // Ensure channel ID is properly formatted (add -100 prefix if needed for supergroups/channels)
    let channelId = telegram_channel_id.toString();
    if (!channelId.startsWith("-100") && channelId.startsWith("-")) {
      channelId = "-100" + channelId.substring(1);
    }

    // Normalize action names (support aliases)
    const normalizedAction = action === "kick" ? "kick_user" : action;

    console.log(`[telegram-channel] Processing action: ${normalizedAction} for user: ${telegram_user_id}, channel: ${channelId}, tenant: ${tenantId}`);

    if (normalizedAction === "create_invite_link") {
      // Revoke old links first if subscriber_id is provided
      if (subscriber_id) {
        await revokeOldInviteLinks(supabaseAdmin, botToken, channelId, subscriber_id);
      }

      // Create a unique invite link for the user with expiration
      const result = await createAndSaveInviteLink(
        supabaseAdmin,
        botToken,
        channelId,
        subscriber_id
      );

      if (!result.success) {
        return new Response(
          JSON.stringify({ error: result.error }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Log invite link creation
      try {
        await supabaseAdmin.from("system_logs").insert({
          level: "info",
          event_type: "telegram.invite_created",
          source: "edge_fn",
          subscriber_id: subscriber_id,
          telegram_user_id: telegram_user_id ? Number(telegram_user_id) : null,
          message: "Invite link created",
          payload: { channel_id: channelId, invite_link: result.invite_link },
        });
      } catch (logErr) {
        console.warn("[telegram-channel] Failed to log:", logErr);
      }

      return new Response(
        JSON.stringify({ success: true, invite_link: result.invite_link }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (normalizedAction === "unban_user") {
      // First unban user (in case they were banned before)
      const unbanResult = await callTelegramApi(botToken, "unbanChatMember", {
        chat_id: channelId,
        user_id: telegram_user_id,
        only_if_banned: true,
      });

      console.log("Unban result:", unbanResult);

      // Revoke old links first if subscriber_id is provided
      if (subscriber_id) {
        await revokeOldInviteLinks(supabaseAdmin, botToken, channelId, subscriber_id);
      }

      // Create invite link with expiration
      const result = await createAndSaveInviteLink(
        supabaseAdmin,
        botToken,
        channelId,
        subscriber_id
      );

      if (!result.success) {
        return new Response(
          JSON.stringify({ error: result.error }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Log unban + invite
      try {
        await supabaseAdmin.from("system_logs").insert({
          level: "info",
          event_type: "telegram.user_unbanned",
          source: "edge_fn",
          subscriber_id: subscriber_id,
          telegram_user_id: telegram_user_id ? Number(telegram_user_id) : null,
          message: "User unbanned and invite link created",
          payload: { channel_id: channelId, invite_link: result.invite_link },
        });
      } catch (logErr) {
        console.warn("[telegram-channel] Failed to log:", logErr);
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          invite_link: result.invite_link,
          message: "User unbanned and invite link created" 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (normalizedAction === "kick_user") {
      // First revoke all old invite links so user can't rejoin with them
      if (subscriber_id) {
        await revokeOldInviteLinks(supabaseAdmin, botToken, channelId, subscriber_id);
      }

      // Kick user from channel using ban + unban to remove from channel but not leave in banned list
      // Step 1: Ban user (removes from channel)
      const banResult = await callTelegramApi(botToken, "banChatMember", {
        chat_id: channelId,
        user_id: telegram_user_id,
        revoke_messages: false,
      });

      if (!banResult.ok) {
        console.error("Failed to ban user:", banResult.description);
        return new Response(
          JSON.stringify({ error: banResult.description || "Failed to remove user from channel" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Step 2: Small delay for reliability
      await new Promise(resolve => setTimeout(resolve, 100));

      // Step 3: Unban user (removes from banned list so they can rejoin with new invite)
      const unbanResult = await callTelegramApi(botToken, "unbanChatMember", {
        chat_id: channelId,
        user_id: telegram_user_id,
        only_if_banned: true,
      });

      if (!unbanResult.ok) {
        console.error("Failed to unban user (not critical):", unbanResult.description);
        // Don't throw error - user is already removed from channel
      } else {
        console.log(`User ${telegram_user_id} successfully removed and unbanned`);
      }

      // Update subscriber status
      if (subscriber_id) {
        await supabaseAdmin
          .from("subscribers")
          .update({ is_in_channel: false })
          .eq("id", subscriber_id);
      }

      // Log kick action
      try {
        await supabaseAdmin.from("system_logs").insert({
          level: "info",
          event_type: "telegram.user_kicked",
          source: "edge_fn",
          subscriber_id: subscriber_id,
          telegram_user_id: telegram_user_id ? Number(telegram_user_id) : null,
          message: "User kicked from channel",
          payload: { channel_id: channelId },
        });
      } catch (logErr) {
        console.warn("[telegram-channel] Failed to log:", logErr);
      }

      return new Response(
        JSON.stringify({ success: true, message: "User removed from channel" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (normalizedAction === "check_membership") {
      // Check if user is a member of the channel
      console.log(`Checking membership for user ${telegram_user_id} in channel ${channelId}`);
      
      const result = await callTelegramApi(botToken, "getChatMember", {
        chat_id: channelId,
        user_id: telegram_user_id,
      });

      console.log("getChatMember result:", JSON.stringify(result));

      if (!result.ok) {
        console.error("getChatMember error:", result.description);
        // Update subscriber as not in channel
        if (subscriber_id) {
          await supabaseAdmin
            .from("subscribers")
            .update({ is_in_channel: false })
            .eq("id", subscriber_id);
        }
        return new Response(
          JSON.stringify({ is_member: false, status: "error", error: result.description }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const status = result.result.status;
      // "left" and "kicked" mean not a member
      const isMember = ["member", "administrator", "creator", "restricted"].includes(status);

      console.log(`User ${telegram_user_id} status: ${status}, isMember: ${isMember}`);

      // Update subscriber in database
      if (subscriber_id) {
        await supabaseAdmin
          .from("subscribers")
          .update({ is_in_channel: isMember })
          .eq("id", subscriber_id);
      }

      return new Response(
        JSON.stringify({ is_member: isMember, status }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (normalizedAction === "send_invite") {
      // Check if user is already in channel
      const { data: subscriber } = await supabaseAdmin
        .from("subscribers")
        .select("is_in_channel")
        .eq("id", subscriber_id)
        .maybeSingle();

      if (subscriber?.is_in_channel) {
        // User is already in channel - send message without invite
        console.log(`User ${telegram_user_id} is already in channel, sending info message`);
        
        const msgResult = await callTelegramApi(botToken, "sendMessage", {
          chat_id: telegram_user_id,
          text: "✅ Вы уже являетесь участником канала!",
          parse_mode: "HTML",
        });

        return new Response(
          JSON.stringify({ 
            success: true, 
            already_member: true,
            message_sent: msgResult.ok 
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Revoke old invite links first
      if (subscriber_id) {
        await revokeOldInviteLinks(supabaseAdmin, botToken, channelId, subscriber_id);
      }

      console.log(`Creating invite link for channel ${channelId} with 10 minute expiry`);
      
      // Create new invite link with expiration
      const result = await createAndSaveInviteLink(
        supabaseAdmin,
        botToken,
        channelId,
        subscriber_id
      );

      if (!result.success) {
        return new Response(
          JSON.stringify({ error: result.error }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Send the invite link to the user
      console.log(`Sending invite link to user ${telegram_user_id}`);
      const messageResult = await callTelegramApi(botToken, "sendMessage", {
        chat_id: telegram_user_id,
        text: `🎉 Ваша подписка активирована!\n\nПерейдите по ссылке, чтобы присоединиться к каналу:\n${result.invite_link}\n\n⚠️ Ссылка одноразовая и действует 10 минут.`,
        parse_mode: "HTML",
      });

      console.log("sendMessage result:", JSON.stringify(messageResult));

      if (!messageResult.ok) {
        console.error("Failed to send message:", messageResult.description);
        // Return 200 with invite link even if message sending failed (user can copy link)
        return new Response(
          JSON.stringify({ 
            success: true, 
            invite_link: result.invite_link,
            message_sent: false,
            error: messageResult.description || "Could not send message to user. They may need to start the bot first."
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          invite_link: result.invite_link,
          message_sent: true 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.error(`[telegram-channel] Unknown action: ${normalizedAction}`);
    return new Response(
      JSON.stringify({ ok: false, error: `Unknown action: ${normalizedAction}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[telegram-channel] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});