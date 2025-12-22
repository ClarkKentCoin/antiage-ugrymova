import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TelegramResponse {
  ok: boolean;
  result?: any;
  description?: string;
}

async function callTelegramApi(botToken: string, method: string, params: Record<string, any> = {}): Promise<TelegramResponse> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  
  return response.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get admin settings for bot token and channel ID
    const { data: settings, error: settingsError } = await supabase
      .from("admin_settings")
      .select("telegram_bot_token, telegram_channel_id")
      .limit(1)
      .single();

    if (settingsError || !settings?.telegram_bot_token || !settings?.telegram_channel_id) {
      console.error("Settings error:", settingsError);
      return new Response(
        JSON.stringify({ error: "Telegram bot not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { telegram_bot_token: botToken, telegram_channel_id } = settings;
    const { action, telegram_user_id, subscriber_id } = await req.json();
    
    // Ensure channel ID is properly formatted (add -100 prefix if needed for supergroups/channels)
    let channelId = telegram_channel_id.toString();
    if (!channelId.startsWith("-100") && channelId.startsWith("-")) {
      channelId = "-100" + channelId.substring(1);
    }

    console.log(`Processing action: ${action} for user: ${telegram_user_id}, channel: ${channelId}`);

    if (action === "create_invite_link") {
      // Create a unique invite link for the user
      const result = await callTelegramApi(botToken, "createChatInviteLink", {
        chat_id: channelId,
        member_limit: 1, // Single-use link
        creates_join_request: false,
      });

      if (!result.ok) {
        console.error("Failed to create invite link:", result.description);
        return new Response(
          JSON.stringify({ error: result.description || "Failed to create invite link" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, invite_link: result.result.invite_link }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "unban_user") {
      // First unban user (in case they were banned before)
      const unbanResult = await callTelegramApi(botToken, "unbanChatMember", {
        chat_id: channelId,
        user_id: telegram_user_id,
        only_if_banned: true,
      });

      console.log("Unban result:", unbanResult);

      // Create invite link for the user
      const inviteResult = await callTelegramApi(botToken, "createChatInviteLink", {
        chat_id: channelId,
        member_limit: 1,
        creates_join_request: false,
      });

      if (!inviteResult.ok) {
        return new Response(
          JSON.stringify({ error: inviteResult.description || "Failed to create invite link" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          invite_link: inviteResult.result.invite_link,
          message: "User unbanned and invite link created" 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "kick_user") {
      // Kick user from channel (ban and immediately unban to remove access)
      const banResult = await callTelegramApi(botToken, "banChatMember", {
        chat_id: channelId,
        user_id: telegram_user_id,
        revoke_messages: false,
      });

      if (!banResult.ok) {
        console.error("Failed to kick user:", banResult.description);
        return new Response(
          JSON.stringify({ error: banResult.description || "Failed to remove user from channel" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Update subscriber status
      if (subscriber_id) {
        await supabase
          .from("subscribers")
          .update({ is_in_channel: false })
          .eq("id", subscriber_id);
      }

      return new Response(
        JSON.stringify({ success: true, message: "User removed from channel" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "check_membership") {
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
          await supabase
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
        await supabase
          .from("subscribers")
          .update({ is_in_channel: isMember })
          .eq("id", subscriber_id);
      }

      return new Response(
        JSON.stringify({ is_member: isMember, status }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "send_invite") {
      // Send invite link directly to the user via bot
      console.log(`Creating invite link for channel ${channelId}`);
      
      // First create the invite link
      const inviteResult = await callTelegramApi(botToken, "createChatInviteLink", {
        chat_id: channelId,
        member_limit: 1,
        creates_join_request: false,
      });

      console.log("createChatInviteLink result:", JSON.stringify(inviteResult));

      if (!inviteResult.ok) {
        console.error("Failed to create invite link:", inviteResult.description);
        return new Response(
          JSON.stringify({ error: inviteResult.description || "Failed to create invite link" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Send the invite link to the user
      console.log(`Sending invite link to user ${telegram_user_id}`);
      const messageResult = await callTelegramApi(botToken, "sendMessage", {
        chat_id: telegram_user_id,
        text: `🎉 Ваша подписка активирована!\n\nПерейдите по ссылке, чтобы присоединиться к каналу:\n${inviteResult.result.invite_link}\n\n⚠️ Ссылка одноразовая и действует только для вас.`,
        parse_mode: "HTML",
      });

      console.log("sendMessage result:", JSON.stringify(messageResult));

      if (!messageResult.ok) {
        console.error("Failed to send message:", messageResult.description);
        // Return 200 with invite link even if message sending failed (user can copy link)
        return new Response(
          JSON.stringify({ 
            success: true, 
            invite_link: inviteResult.result.invite_link,
            message_sent: false,
            error: messageResult.description || "Could not send message to user. They may need to start the bot first."
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          invite_link: inviteResult.result.invite_link,
          message_sent: true 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
