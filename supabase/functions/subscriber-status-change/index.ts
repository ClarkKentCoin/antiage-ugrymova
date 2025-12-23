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

// Replace template variables with actual values
function replaceVariables(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return result;
}

const DEFAULT_PAYMENT_SUCCESS = `✅ Оплата успешна

Ваша подписка на канал "{channel_name}" успешно оформлена!

💰 Сумма: {amount}₽
📅 Действует до: {expires_date}

Спасибо что с нами! 💙`;

const DEFAULT_SUBSCRIPTION_RENEWED = `✅ Подписка продлена

Ваша подписка на канал "{channel_name}" успешно продлена!

📅 Действует до: {expires_date}

Спасибо что остаётесь с нами! 💙`;

const DEFAULT_GRACE_PERIOD_WARNING = `⚠️ Последнее предупреждение

Ваша подписка на канал "{channel_name}" истекла.

У вас осталось {days} дней для продления. После этого вы будете удалены из канала и потеряете доступ к архиву сообщений.

💎 Продлите сейчас, чтобы сохранить доступ.`;

const DEFAULT_SUBSCRIPTION_EXPIRED = `❗ Подписка завершена

Ваша подписка на канал "{channel_name}" завершена, и вы были удалены из канала.

Чтобы вернуть доступ и историю сообщений, оформите новую подписку.`;

async function callTelegramApi(
  botToken: string,
  method: string,
  params: Record<string, any> = {}
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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Authentication check - require valid user session with admin role
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("No authorization header provided");
      return new Response(
        JSON.stringify({ error: "Unauthorized - No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create a client with the user's token to verify their identity
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    );

    // Verify the user's token
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();

    if (authError || !user) {
      console.error("Auth error:", authError?.message || "No user found");
      return new Response(
        JSON.stringify({ error: "Unauthorized - Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user has admin role
    const { data: roleData, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (roleError || !roleData) {
      console.error("Admin check failed:", roleError?.message || "No admin role");
      return new Response(
        JSON.stringify({ error: "Forbidden - Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const {
      action,
      subscriber_id,
      telegram_user_id,
      old_status,
      new_status,
      subscription_end,
      amount,
      tier_name,
    } = body;

    console.log(`Processing action: ${action}, subscriber: ${subscriber_id}, telegram_user: ${telegram_user_id}`);
    console.log(`Status change: ${old_status} -> ${new_status}`);

    // Get admin settings
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("admin_settings")
      .select(
        `telegram_bot_token, telegram_channel_id, grace_period_days, channel_name,
         notification_payment_success, notification_grace_period_warning, 
         notification_subscription_expired`
      )
      .limit(1)
      .maybeSingle();

    if (settingsError || !settings?.telegram_bot_token) {
      console.error("Settings error:", settingsError);
      return new Response(
        JSON.stringify({ error: "Telegram bot not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const botToken = settings.telegram_bot_token;
    const channelName = settings.channel_name || "Канал";
    const gracePeriodDays = settings.grace_period_days || 0;

    // Format channel ID
    let channelId = settings.telegram_channel_id?.toString() || "";
    if (channelId && !channelId.startsWith("-100") && channelId.startsWith("-")) {
      channelId = "-100" + channelId.substring(1);
    }

    const results: {
      kicked?: boolean;
      notification_sent?: boolean;
      invite_sent?: boolean;
      error?: string;
    } = {};

    // Handle different actions
    if (action === "status_change") {
      // Status changed from active to cancelled/expired/inactive - kick user
      if (
        old_status === "active" &&
        (new_status === "cancelled" || new_status === "expired" || new_status === "inactive")
      ) {
        console.log(`Kicking user ${telegram_user_id} due to status change to ${new_status}`);

        if (channelId) {
          // Step 1: Ban user (removes from channel)
          const banResult = await callTelegramApi(botToken, "banChatMember", {
            chat_id: channelId,
            user_id: telegram_user_id,
            revoke_messages: false,
          });

          if (banResult.ok) {
            // Step 2: Small delay for reliability
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Step 3: Unban user (removes from banned list so they can rejoin)
            const unbanResult = await callTelegramApi(botToken, "unbanChatMember", {
              chat_id: channelId,
              user_id: telegram_user_id,
              only_if_banned: true,
            });

            if (!unbanResult.ok) {
              console.error(`Failed to unban user (not critical):`, unbanResult.description);
            }

            // Update is_in_channel
            await supabaseAdmin
              .from("subscribers")
              .update({ is_in_channel: false })
              .eq("id", subscriber_id);

            results.kicked = true;
            console.log(`User ${telegram_user_id} kicked successfully`);
          } else {
            console.error(`Failed to kick user:`, banResult.description);
            results.error = banResult.description;
          }
        }

        // Send subscription expired notification
        const template =
          settings.notification_subscription_expired || DEFAULT_SUBSCRIPTION_EXPIRED;
        const message = replaceVariables(template, {
          channel_name: channelName,
        });

        const msgResult = await callTelegramApi(botToken, "sendMessage", {
          chat_id: telegram_user_id,
          text: message,
          parse_mode: "HTML",
        });

        results.notification_sent = msgResult.ok;
        if (!msgResult.ok) {
          console.error(`Failed to send notification:`, msgResult.description);
        }
      }

      // Status changed to grace_period - send warning
      if (new_status === "grace_period" && old_status !== "grace_period") {
        console.log(`Sending grace period warning to ${telegram_user_id}`);

        const template =
          settings.notification_grace_period_warning || DEFAULT_GRACE_PERIOD_WARNING;
        const message = replaceVariables(template, {
          channel_name: channelName,
          days: String(gracePeriodDays),
        });

        const msgResult = await callTelegramApi(botToken, "sendMessage", {
          chat_id: telegram_user_id,
          text: message,
          parse_mode: "HTML",
        });

        results.notification_sent = msgResult.ok;
      }

      // Status changed to active (renewal/reactivation) - send notification + invite
      if (new_status === "active" && old_status !== "active") {
        console.log(`Sending renewal notification and invite to ${telegram_user_id}`);

        // Format expiry date
        let expiresDate = "—";
        if (subscription_end) {
          const endDate = new Date(subscription_end);
          expiresDate = endDate.toLocaleDateString("ru-RU", {
            day: "numeric",
            month: "long",
            year: "numeric",
          });
        }

        // Send renewal notification
        const template = DEFAULT_SUBSCRIPTION_RENEWED;
        const message = replaceVariables(template, {
          channel_name: channelName,
          expires_date: expiresDate,
        });

        const msgResult = await callTelegramApi(botToken, "sendMessage", {
          chat_id: telegram_user_id,
          text: message,
          parse_mode: "HTML",
        });

        results.notification_sent = msgResult.ok;

        // Send invite link
        if (channelId) {
          // First unban user (in case they were banned)
          await callTelegramApi(botToken, "unbanChatMember", {
            chat_id: channelId,
            user_id: telegram_user_id,
            only_if_banned: true,
          });

          // Create invite link
          const inviteResult = await callTelegramApi(botToken, "createChatInviteLink", {
            chat_id: channelId,
            member_limit: 1,
            creates_join_request: false,
          });

          if (inviteResult.ok) {
            // Send invite to user
            const inviteMsgResult = await callTelegramApi(botToken, "sendMessage", {
              chat_id: telegram_user_id,
              text: `🎉 Перейдите по ссылке, чтобы присоединиться к каналу:\n${inviteResult.result.invite_link}\n\n⚠️ Ссылка одноразовая и действует только для вас.`,
              parse_mode: "HTML",
            });

            results.invite_sent = inviteMsgResult.ok;
          }
        }
      }
    }

    // Handle new subscriber action (manual add by admin)
    if (action === "new_subscriber") {
      console.log(`New subscriber added: ${telegram_user_id}`);

      // Format expiry date
      let expiresDate = "—";
      if (subscription_end) {
        const endDate = new Date(subscription_end);
        expiresDate = endDate.toLocaleDateString("ru-RU", {
          day: "numeric",
          month: "long",
          year: "numeric",
        });
      }

      // Send payment success notification
      const template =
        settings.notification_payment_success || DEFAULT_PAYMENT_SUCCESS;
      const message = replaceVariables(template, {
        channel_name: channelName,
        amount: amount ? String(amount) : "—",
        expires_date: expiresDate,
      });

      const msgResult = await callTelegramApi(botToken, "sendMessage", {
        chat_id: telegram_user_id,
        text: message,
        parse_mode: "HTML",
      });

      results.notification_sent = msgResult.ok;
      if (!msgResult.ok) {
        console.error(`Failed to send notification:`, msgResult.description);
      }
    }

    console.log("Action completed:", results);

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
