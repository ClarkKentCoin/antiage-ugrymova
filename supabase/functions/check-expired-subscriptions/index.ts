import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendAdminNotification } from "../_shared/adminNotifications.ts";

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

const DEFAULT_GRACE_PERIOD_WARNING = `⚠️ Последнее предупреждение

Ваша подписка на канал "{channel_name}" истекла.

У вас осталось {days} дней для продления. После этого вы будете удалены из канала и потеряете доступ к архиву сообщений.

💎 Продлите сейчас, чтобы сохранить доступ.`;

const DEFAULT_SUBSCRIPTION_EXPIRED = `❗ Подписка завершена

Ваша подписка на канал "{channel_name}" завершена, и вы были удалены из канала.

Чтобы вернуть доступ, оформите новую подписку.`;

async function callTelegramApi(
  botToken: string,
  method: string,
  params: Record<string, any> = {},
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

  // Accept either SCHEDULED_TASK_SECRET or anon key for cron jobs
  const authHeader = req.headers.get("Authorization");
  const expectedSecret = Deno.env.get("SCHEDULED_TASK_SECRET");
  // Hardcode anon key for cron job compatibility
  const anonKey =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptZXdmaG5heWNqdXZwanhraWluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0MTcwNDUsImV4cCI6MjA4MTk5MzA0NX0.y4GssGSn_PIMg8CgoYU2fSyujoAA8VV07I8PKDfipRo";

  const bearerToken = authHeader?.replace("Bearer ", "");
  const isValidSecret = bearerToken === expectedSecret;
  const isValidAnonKey = bearerToken === anonKey;

  if (!authHeader || (!isValidSecret && !isValidAnonKey)) {
    console.error("Unauthorized scheduled task execution attempt");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    console.log("Starting check-expired-subscriptions function");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Get admin settings including notification templates
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("admin_settings")
      .select(
        "telegram_bot_token, telegram_channel_id, grace_period_days, channel_name, notification_grace_period_warning, notification_subscription_expired",
      )
      .limit(1)
      .maybeSingle();

    if (settingsError) {
      console.error("Settings error:", settingsError);
      return new Response(JSON.stringify({ error: "Failed to load settings" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!settings?.telegram_bot_token || !settings?.telegram_channel_id) {
      console.log("Telegram bot not configured, skipping");
      return new Response(JSON.stringify({ message: "Telegram bot not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const gracePeriodDays = settings.grace_period_days || 0;
    const channelName = settings.channel_name || "Канал";
    const gracePeriodWarningTemplate = settings.notification_grace_period_warning || DEFAULT_GRACE_PERIOD_WARNING;
    const subscriptionExpiredTemplate = settings.notification_subscription_expired || DEFAULT_SUBSCRIPTION_EXPIRED;
    const now = new Date();

    console.log(`Grace period: ${gracePeriodDays} days`);

    // Find all active subscriptions where subscription_end has passed
    const { data: expiredSubscribers, error: subscribersError } = await supabaseAdmin
      .from("subscribers")
      .select(`
        *,
        subscription_tiers (
          name
        )
      `)
      .eq("status", "active")
      .lt("subscription_end", now.toISOString());

    if (subscribersError) {
      console.error("Error fetching expired subscribers:", subscribersError);
      return new Response(JSON.stringify({ error: "Failed to fetch subscribers" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${expiredSubscribers?.length || 0} expired active subscriptions`);

    // Also find grace_period subscribers to check if grace period has ended
    const { data: gracePeriodSubscribers, error: graceError } = await supabaseAdmin
      .from("subscribers")
      .select(`
        *,
        subscription_tiers (
          name
        )
      `)
      .eq("status", "grace_period");

    if (graceError) {
      console.error("Error fetching grace period subscribers:", graceError);
    }

    const results = {
      moved_to_grace_period: 0,
      kicked: 0,
      errors: 0,
    };

    const botToken = settings.telegram_bot_token;
    let channelId = settings.telegram_channel_id.toString();
    if (!channelId.startsWith("-100") && channelId.startsWith("-")) {
      channelId = "-100" + channelId.substring(1);
    }

    // Process expired active subscriptions
    for (const subscriber of expiredSubscribers || []) {
      try {
        const subscriptionEnd = new Date(subscriber.subscription_end);
        const graceEndDate = new Date(subscriptionEnd);
        graceEndDate.setDate(graceEndDate.getDate() + gracePeriodDays);

        if (now >= graceEndDate) {
          // Grace period has ended or no grace period - ban user permanently
          console.log(`[check-expired] Banning user ${subscriber.telegram_user_id} - grace period ended`);

          // Conditional update: only proceed if status is still "active"
          const { data: updated, error: updateError } = await supabaseAdmin
            .from("subscribers")
            .update({
              status: "expired",
              is_in_channel: false,
            })
            .eq("id", subscriber.id)
            .eq("status", "active")
            .select("id");

          if (updateError) {
            console.error(`[check-expired] Failed to update status for ${subscriber.id}:`, updateError);
            results.errors++;
            continue;
          }

          if (!updated || updated.length === 0) {
            console.log(`[check-expired] duplicate skipped (already moved) for ${subscriber.telegram_user_id}`);
            continue;
          }

          console.log(`[check-expired] moved to expired: ${subscriber.telegram_user_id}`);

          // Ban user (removes from channel) - NO UNBAN after this
          const banResult = await callTelegramApi(botToken, "banChatMember", {
            chat_id: channelId,
            user_id: subscriber.telegram_user_id,
            revoke_messages: false,
          });

          if (banResult.ok) {
            console.log(`[check-expired] User ${subscriber.telegram_user_id} banned and remains banned`);

            // Send subscription expired notification
            const expiredMessage = replaceVariables(subscriptionExpiredTemplate, {
              channel_name: channelName,
            });

            await callTelegramApi(botToken, "sendMessage", {
              chat_id: subscriber.telegram_user_id,
              text: expiredMessage,
              parse_mode: "HTML",
            });

            // Send admin notification for subscription ended (no grace period case)
            const tier = subscriber.subscription_tiers;
            await sendAdminNotification({
              supabaseAdmin,
              eventType: "SUBSCRIPTION_ENDED",
              subscriber: {
                id: subscriber.id ?? null,
                name: [subscriber.first_name, subscriber.last_name].filter(Boolean).join(" ") || null,
                username: subscriber.telegram_username ?? null,
                telegram_user_id: subscriber.telegram_user_id ?? null,
                email: subscriber.email ?? null,
              },
              plan: tier?.name ?? null,
              status: "expired",
              subscriptionEndISO: subscriber.subscription_end ?? null,
              graceEndISO: graceEndDate.toISOString(),
              relatedAtISO: graceEndDate.toISOString(),
              source: "check-expired-subscriptions",
            });

            results.kicked++;
          } else {
            console.error(`[check-expired] Failed to ban user ${subscriber.telegram_user_id}:`, banResult.description);
            results.errors++;
          }
        } else {
          // Move to grace period - conditional update to prevent duplicates
          console.log(`[check-expired] Attempting to move user ${subscriber.telegram_user_id} to grace period`);

          const { data: updated, error: updateError } = await supabaseAdmin
            .from("subscribers")
            .update({ status: "grace_period" })
            .eq("id", subscriber.id)
            .eq("status", "active")
            .select("id");

          if (updateError) {
            console.error(`[check-expired] Failed to update status for ${subscriber.id}:`, updateError);
            results.errors++;
            continue;
          }

          if (!updated || updated.length === 0) {
            console.log(`[check-expired] duplicate skipped (already moved) for ${subscriber.telegram_user_id}`);
            continue;
          }

          console.log(`[check-expired] moved to grace: ${subscriber.telegram_user_id}`);

          // Send grace period warning notification
          const daysLeft = Math.ceil((graceEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          const warningMessage = replaceVariables(gracePeriodWarningTemplate, {
            channel_name: channelName,
            days: String(daysLeft),
          });

          await callTelegramApi(botToken, "sendMessage", {
            chat_id: subscriber.telegram_user_id,
            text: warningMessage,
            parse_mode: "HTML",
          });

          // Send admin notification for grace period started
          const tier = subscriber.subscription_tiers;
          await sendAdminNotification({
            supabaseAdmin,
            eventType: "GRACE_STARTED",
            subscriber: {
              id: subscriber.id ?? null,
              name: [subscriber.first_name, subscriber.last_name].filter(Boolean).join(" ") || null,
              username: subscriber.telegram_username ?? null,
              telegram_user_id: subscriber.telegram_user_id ?? null,
              email: subscriber.email ?? null,
            },
            plan: tier?.name ?? null,
            status: "grace_period",
            subscriptionEndISO: subscriber.subscription_end ?? null,
            graceEndISO: graceEndDate.toISOString(),
            relatedAtISO: graceEndDate.toISOString(),
            source: "check-expired-subscriptions",
          });

          results.moved_to_grace_period++;
        }
      } catch (error) {
        console.error(`[check-expired] Error processing subscriber ${subscriber.id}:`, error);
        results.errors++;
      }
    }

    // Process grace period subscribers - check if grace period has ended
    for (const subscriber of gracePeriodSubscribers || []) {
      try {
        const subscriptionEnd = new Date(subscriber.subscription_end);
        const graceEndDate = new Date(subscriptionEnd);
        graceEndDate.setDate(graceEndDate.getDate() + gracePeriodDays);

        if (now >= graceEndDate) {
          // Grace period has ended - ban user permanently
          console.log(`[check-expired] Grace period ended for user ${subscriber.telegram_user_id}`);

          // Conditional update: only proceed if status is still "grace_period"
          const { data: updated, error: updateError } = await supabaseAdmin
            .from("subscribers")
            .update({
              status: "expired",
              is_in_channel: false,
            })
            .eq("id", subscriber.id)
            .eq("status", "grace_period")
            .select("id");

          if (updateError) {
            console.error(`[check-expired] Failed to update status for ${subscriber.id}:`, updateError);
            results.errors++;
            continue;
          }

          if (!updated || updated.length === 0) {
            console.log(`[check-expired] duplicate skipped (already expired) for ${subscriber.telegram_user_id}`);
            continue;
          }

          console.log(`[check-expired] moved to expired: ${subscriber.telegram_user_id}`);

          // Ban user (removes from channel) - NO UNBAN after this
          const banResult = await callTelegramApi(botToken, "banChatMember", {
            chat_id: channelId,
            user_id: subscriber.telegram_user_id,
            revoke_messages: false,
          });

          if (banResult.ok) {
            console.log(`[check-expired] User ${subscriber.telegram_user_id} banned and remains banned`);

            // Send subscription expired notification
            const expiredMessage = replaceVariables(subscriptionExpiredTemplate, {
              channel_name: channelName,
            });

            await callTelegramApi(botToken, "sendMessage", {
              chat_id: subscriber.telegram_user_id,
              text: expiredMessage,
              parse_mode: "HTML",
            });

            // Send admin notification for grace period ended
            const tier = subscriber.subscription_tiers;
            await sendAdminNotification({
              supabaseAdmin,
              eventType: "GRACE_ENDED",
              subscriber: {
                id: subscriber.id ?? null,
                name: [subscriber.first_name, subscriber.last_name].filter(Boolean).join(" ") || null,
                username: subscriber.telegram_username ?? null,
                telegram_user_id: subscriber.telegram_user_id ?? null,
                email: subscriber.email ?? null,
              },
              plan: tier?.name ?? null,
              status: "expired",
              subscriptionEndISO: subscriber.subscription_end ?? null,
              graceEndISO: graceEndDate.toISOString(),
              relatedAtISO: graceEndDate.toISOString(),
              source: "check-expired-subscriptions",
            });

            results.kicked++;
          } else {
            console.error(`[check-expired] Failed to ban user ${subscriber.telegram_user_id}:`, banResult.description);
            results.errors++;
          }
        }
      } catch (error) {
        console.error(`[check-expired] Error processing grace period subscriber ${subscriber.id}:`, error);
        results.errors++;
      }
    }

    console.log("Check expired subscriptions completed:", results);

    return new Response(
      JSON.stringify({
        success: true,
        results,
        message: `Processed: ${results.moved_to_grace_period} moved to grace period, ${results.kicked} kicked, ${results.errors} errors`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
