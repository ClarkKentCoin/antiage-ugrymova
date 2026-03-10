import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendAdminNotification } from "../_shared/adminNotifications.ts";
import { logUserNotification } from "../_shared/userNotificationLogger.ts";
import { getDayWordRu, formatDaysRu } from "../_shared/textFormatters.ts";

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
// Handles backward compatibility: "{days} дней" → "{days} {days_word}"
function replaceVariables(template: string, variables: Record<string, string>): string {
  let result = template;
  result = result.replace(/\{days\}\s*дней/g, `{days} {days_word}`);
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return result;
}

const DEFAULT_GRACE_PERIOD_WARNING = `⚠️ Последнее предупреждение

Ваша подписка на канал "{channel_name}" истекла.

У вас осталось {days} {days_word} для продления. После этого вы будете удалены из канала и потеряете доступ к архиву сообщений.

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

  // Accept Supabase anon key JWT (from cron) or SCHEDULED_TASK_SECRET
  const authHeader = req.headers.get("Authorization");
  const bearerToken = authHeader?.replace("Bearer ", "");
  const expectedSecret = Deno.env.get("SCHEDULED_TASK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1];
  
  let isValidAuth = expectedSecret && bearerToken === expectedSecret;
  
  if (!isValidAuth && bearerToken && projectRef) {
    try {
      const payloadBase64 = bearerToken.split('.')[1];
      if (payloadBase64) {
        const payload = JSON.parse(atob(payloadBase64));
        isValidAuth = payload.ref === projectRef && payload.role === 'anon';
      }
    } catch (e) {}
  }

  if (!isValidAuth) {
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

    // Fetch ALL tenant settings with bot token and channel configured
    const { data: allSettings, error: settingsError } = await supabaseAdmin
      .from("admin_settings")
      .select(
        "tenant_id, telegram_bot_token, telegram_channel_id, grace_period_days, channel_name, notification_grace_period_warning, notification_subscription_expired",
      )
      .not("telegram_bot_token", "is", null)
      .not("telegram_channel_id", "is", null);

    if (settingsError || !allSettings || allSettings.length === 0) {
      console.log("No tenants with Telegram bot configured, skipping");
      return new Response(JSON.stringify({ message: "No Telegram bot configured for any tenant" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const globalResults = {
      moved_to_grace_period: 0,
      kicked: 0,
      errors: 0,
    };

    for (const settings of allSettings) {
      const tenantId = settings.tenant_id;
      if (!tenantId) continue;

      console.log(`[check-expired] Processing tenant ${tenantId}`);

      const gracePeriodDays = settings.grace_period_days || 0;
      const channelName = settings.channel_name || "Канал";
      const gracePeriodWarningTemplate = settings.notification_grace_period_warning || DEFAULT_GRACE_PERIOD_WARNING;
      const subscriptionExpiredTemplate = settings.notification_subscription_expired || DEFAULT_SUBSCRIPTION_EXPIRED;

      const botToken = settings.telegram_bot_token;
      let channelId = settings.telegram_channel_id.toString();
      if (!channelId.startsWith("-100") && channelId.startsWith("-")) {
        channelId = "-100" + channelId.substring(1);
      }

      // Find expired active subscriptions for THIS tenant
      const { data: expiredSubscribers, error: subscribersError } = await supabaseAdmin
        .from("subscribers")
        .select(`
          *,
          subscription_tiers (
            name,
            grace_period_enabled
          )
        `)
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .lt("subscription_end", now.toISOString());

      if (subscribersError) {
        console.error(`[check-expired] Error fetching expired subscribers for tenant ${tenantId}:`, subscribersError);
        globalResults.errors++;
        continue;
      }

      // Find grace_period subscribers for THIS tenant
      const { data: gracePeriodSubscribers, error: graceError } = await supabaseAdmin
        .from("subscribers")
        .select(`
          *,
          subscription_tiers (
            name,
            grace_period_enabled
          )
        `)
        .eq("tenant_id", tenantId)
        .eq("status", "grace_period");

      if (graceError) {
        console.error(`[check-expired] Error fetching grace period subscribers for tenant ${tenantId}:`, graceError);
      }

      console.log(`[check-expired] Tenant ${tenantId}: ${expiredSubscribers?.length || 0} expired, ${gracePeriodSubscribers?.length || 0} in grace`);

      // Process expired active subscriptions
      for (const subscriber of expiredSubscribers || []) {
        try {
          const subscriptionEnd = new Date(subscriber.subscription_end);
          const graceEndDate = new Date(subscriptionEnd);
          graceEndDate.setDate(graceEndDate.getDate() + gracePeriodDays);

          if (now >= graceEndDate) {
            // Grace period has ended or no grace period - ban user permanently
            console.log(`[check-expired] Banning user ${subscriber.telegram_user_id} - grace period ended`);

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
              globalResults.errors++;
              continue;
            }

            if (!updated || updated.length === 0) {
              console.log(`[check-expired] duplicate skipped (already moved) for ${subscriber.telegram_user_id}`);
              continue;
            }

            console.log(`[check-expired] moved to expired: ${subscriber.telegram_user_id}`);

            const banResult = await callTelegramApi(botToken, "banChatMember", {
              chat_id: channelId,
              user_id: subscriber.telegram_user_id,
              revoke_messages: false,
            });

            if (banResult.ok) {
              console.log(`[check-expired] User ${subscriber.telegram_user_id} banned and remains banned`);

              const expiredMessage = replaceVariables(subscriptionExpiredTemplate, {
                channel_name: channelName,
              });

              const expiredMsgResult = await callTelegramApi(botToken, "sendMessage", {
                chat_id: subscriber.telegram_user_id,
                text: expiredMessage,
                parse_mode: "HTML",
              });

              await logUserNotification({
                supabaseAdmin,
                source: "check-expired-subscriptions",
                notificationKey: "subscription_expired",
                subscriberId: subscriber.id,
                telegramUserId: subscriber.telegram_user_id,
                subscriptionEnd: subscriber.subscription_end,
                telegramOk: expiredMsgResult.ok,
                telegramError: expiredMsgResult.ok ? null : expiredMsgResult.description,
                textPreview: expiredMessage,
              });

              const tier = subscriber.subscription_tiers;
              await sendAdminNotification({
                supabaseAdmin,
                tenantId,
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

              globalResults.kicked++;
            } else {
              console.error(`[check-expired] Failed to ban user ${subscriber.telegram_user_id}:`, banResult.description);
              globalResults.errors++;
            }
          } else {
            // Move to grace period
            console.log(`[check-expired] Attempting to move user ${subscriber.telegram_user_id} to grace period`);

            const { data: updated, error: updateError } = await supabaseAdmin
              .from("subscribers")
              .update({ status: "grace_period" })
              .eq("id", subscriber.id)
              .eq("status", "active")
              .select("id");

            if (updateError) {
              console.error(`[check-expired] Failed to update status for ${subscriber.id}:`, updateError);
              globalResults.errors++;
              continue;
            }

            if (!updated || updated.length === 0) {
              console.log(`[check-expired] duplicate skipped (already moved) for ${subscriber.telegram_user_id}`);
              continue;
            }

            console.log(`[check-expired] moved to grace: ${subscriber.telegram_user_id}`);

            const daysLeft = Math.ceil((graceEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            const warningMessage = replaceVariables(gracePeriodWarningTemplate, {
              channel_name: channelName,
              days: String(daysLeft),
              days_word: getDayWordRu(daysLeft),
              days_label: formatDaysRu(daysLeft),
            });

            const warningMsgResult = await callTelegramApi(botToken, "sendMessage", {
              chat_id: subscriber.telegram_user_id,
              text: warningMessage,
              parse_mode: "HTML",
            });

            await logUserNotification({
              supabaseAdmin,
              source: "check-expired-subscriptions",
              notificationKey: "grace_warning",
              subscriberId: subscriber.id,
              telegramUserId: subscriber.telegram_user_id,
              subscriptionEnd: subscriber.subscription_end,
              days: daysLeft,
              telegramOk: warningMsgResult.ok,
              telegramError: warningMsgResult.ok ? null : warningMsgResult.description,
              textPreview: warningMessage,
            });

            const tier = subscriber.subscription_tiers;
            await sendAdminNotification({
              supabaseAdmin,
              tenantId,
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

            globalResults.moved_to_grace_period++;
          }
        } catch (error) {
          console.error(`[check-expired] Error processing subscriber ${subscriber.id}:`, error);
          globalResults.errors++;
        }
      }

      // Process grace period subscribers - check if grace period has ended
      for (const subscriber of gracePeriodSubscribers || []) {
        try {
          const subscriptionEnd = new Date(subscriber.subscription_end);
          const graceEndDate = new Date(subscriptionEnd);
          graceEndDate.setDate(graceEndDate.getDate() + gracePeriodDays);

          if (now >= graceEndDate) {
            console.log(`[check-expired] Grace period ended for user ${subscriber.telegram_user_id}`);

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
              globalResults.errors++;
              continue;
            }

            if (!updated || updated.length === 0) {
              console.log(`[check-expired] duplicate skipped (already expired) for ${subscriber.telegram_user_id}`);
              continue;
            }

            console.log(`[check-expired] moved to expired: ${subscriber.telegram_user_id}`);

            const banResult = await callTelegramApi(botToken, "banChatMember", {
              chat_id: channelId,
              user_id: subscriber.telegram_user_id,
              revoke_messages: false,
            });

            if (banResult.ok) {
              console.log(`[check-expired] User ${subscriber.telegram_user_id} banned and remains banned`);

              const expiredMessage = replaceVariables(subscriptionExpiredTemplate, {
                channel_name: channelName,
              });

              const expiredMsgResult = await callTelegramApi(botToken, "sendMessage", {
                chat_id: subscriber.telegram_user_id,
                text: expiredMessage,
                parse_mode: "HTML",
              });

              await logUserNotification({
                supabaseAdmin,
                source: "check-expired-subscriptions",
                notificationKey: "subscription_expired",
                subscriberId: subscriber.id,
                telegramUserId: subscriber.telegram_user_id,
                subscriptionEnd: subscriber.subscription_end,
                telegramOk: expiredMsgResult.ok,
                telegramError: expiredMsgResult.ok ? null : expiredMsgResult.description,
                textPreview: expiredMessage,
              });

              const tier = subscriber.subscription_tiers;
              await sendAdminNotification({
                supabaseAdmin,
                tenantId,
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

              globalResults.kicked++;
            } else {
              console.error(`[check-expired] Failed to ban user ${subscriber.telegram_user_id}:`, banResult.description);
              globalResults.errors++;
            }
          }
        } catch (error) {
          console.error(`[check-expired] Error processing grace period subscriber ${subscriber.id}:`, error);
          globalResults.errors++;
        }
      }
    }

    console.log("Check expired subscriptions completed:", globalResults);

    return new Response(
      JSON.stringify({
        success: true,
        results: globalResults,
        message: `Processed: ${globalResults.moved_to_grace_period} moved to grace period, ${globalResults.kicked} kicked, ${globalResults.errors} errors`,
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
