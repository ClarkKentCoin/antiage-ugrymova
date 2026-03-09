import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendAdminNotification } from "../_shared/adminNotifications.ts";
import { logUserNotification } from "../_shared/userNotificationLogger.ts";
import { getDayWordRu, formatDaysRu } from "../_shared/textFormatters.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Replace template variables with actual values
// Handles backward compatibility: "{days} дней" → "{days} {days_word}"
function replaceVariables(template: string, variables: Record<string, string>): string {
  let result = template;
  result = result.replace(/\{days\}\s*дней/g, `{days} {days_word}`);
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

const DEFAULT_PAYMENT_REMINDER = `⏰ Напоминание о списании

Через {days} {days_word} будет списана оплата за продление подписки на канал "{channel_name}".

💰 Сумма: {amount}₽
📅 Дата списания: {payment_date}

Если хотите отключить автопродление, сделайте это в настройках подписки.`;

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
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log("Processing upcoming payment notifications");

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Fetch ALL tenant settings with bot token configured
    const { data: allSettings, error: settingsError } = await supabaseAdmin
      .from("admin_settings")
      .select("tenant_id, telegram_bot_token, channel_name, notification_payment_reminder, reminder_days_before")
      .not("telegram_bot_token", "is", null);

    if (settingsError || !allSettings || allSettings.length === 0) {
      console.error("No tenants with Telegram bot configured:", settingsError);
      return new Response(
        JSON.stringify({ error: "No Telegram bot configured for any tenant" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date();
    const allResults: Array<{ subscriber_id: string; success: boolean; message: string }> = [];

    for (const settings of allSettings) {
      const tenantId = settings.tenant_id;
      if (!tenantId) continue;

      console.log(`[notify-upcoming] Processing tenant ${tenantId}`);

      const reminderDays = settings.reminder_days_before || 3;
      const channelName = settings.channel_name || "Канал";
      const messageTemplate = settings.notification_payment_reminder || DEFAULT_PAYMENT_REMINDER;

      const targetDate = new Date(now.getTime() + reminderDays * 24 * 60 * 60 * 1000);
      const nextDay = new Date(now.getTime() + (reminderDays + 1) * 24 * 60 * 60 * 1000);

      const { data: subscriptions, error: subError } = await supabaseAdmin
        .from("subscribers")
        .select(`
          id,
          telegram_user_id,
          telegram_username,
          first_name,
          last_name,
          email,
          status,
          subscription_end,
          next_payment_notification_sent,
          subscription_tiers (
            name,
            price
          )
        `)
        .eq("tenant_id", tenantId)
        .eq("auto_renewal", true)
        .eq("status", "active")
        .eq("next_payment_notification_sent", false)
        .gte("subscription_end", targetDate.toISOString())
        .lt("subscription_end", nextDay.toISOString());

      if (subError) {
        console.error(`[notify-upcoming] Error fetching subscriptions for tenant ${tenantId}:`, subError);
        continue;
      }

      if (!subscriptions || subscriptions.length === 0) {
        console.log(`[notify-upcoming] No subscriptions to notify for tenant ${tenantId}`);
        continue;
      }

      console.log(`[notify-upcoming] Found ${subscriptions.length} subscriptions for tenant ${tenantId}`);

      for (const subscription of subscriptions) {
        try {
          const tierData = subscription.subscription_tiers;
          const tier = Array.isArray(tierData) ? tierData[0] : tierData;
          
          if (!tier) {
            console.error(`No tier found for subscription ${subscription.id}`);
            allResults.push({ subscriber_id: subscription.id, success: false, message: "No tier found" });
            continue;
          }

          const amount = Number(tier.price).toLocaleString('ru-RU');
          const paymentDate = new Date(subscription.subscription_end);
          const formattedDate = paymentDate.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          });

          const message = replaceVariables(messageTemplate, {
            channel_name: channelName,
            days: String(reminderDays),
            days_word: getDayWordRu(reminderDays),
            days_label: formatDaysRu(reminderDays),
            amount: amount,
            payment_date: formattedDate,
          });

          const response = await fetch(
            `https://api.telegram.org/bot${settings.telegram_bot_token}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: subscription.telegram_user_id,
                text: message,
                parse_mode: "HTML",
              }),
            }
          );

          const result = await response.json();

          await logUserNotification({
            supabaseAdmin,
            source: "notify-upcoming-payments",
            notificationKey: "auto_payment_reminder",
            subscriberId: subscription.id,
            telegramUserId: subscription.telegram_user_id,
            subscriptionEnd: subscription.subscription_end,
            days: reminderDays,
            telegramOk: result.ok,
            telegramError: result.ok ? null : result.description,
            textPreview: message,
          });

          if (result.ok) {
            await supabaseAdmin
              .from("subscribers")
              .update({ next_payment_notification_sent: true })
              .eq("id", subscription.id);

            console.log(`Notification sent to ${subscription.telegram_user_id}`);
            allResults.push({ subscriber_id: subscription.id, success: true, message: "Notification sent" });

            await sendAdminNotification({
              supabaseAdmin,
              tenantId,
              eventType: "EXPIRING_IN_3_DAYS",
              subscriber: {
                id: subscription.id ?? null,
                name: [subscription.first_name, subscription.last_name].filter(Boolean).join(" ") || null,
                username: subscription.telegram_username ?? null,
                telegram_user_id: subscription.telegram_user_id ?? null,
                email: subscription.email ?? null,
              },
              plan: tier.name ?? null,
              status: subscription.status ?? "active",
              method: "recurring",
              subscriptionEndISO: subscription.subscription_end ?? null,
              relatedAtISO: subscription.subscription_end ?? null,
              source: "notify-upcoming-payments",
            });
          } else {
            console.error(`Failed to send notification to ${subscription.telegram_user_id}:`, result);
            allResults.push({ subscriber_id: subscription.id, success: false, message: result.description || "Failed to send" });
          }

        } catch (notifyError) {
          console.error(`Error notifying subscription ${subscription.id}:`, notifyError);
          allResults.push({
            subscriber_id: subscription.id,
            success: false,
            message: notifyError instanceof Error ? notifyError.message : "Unknown error"
          });
        }
      }
    }

    const successCount = allResults.filter(r => r.success).length;
    console.log(`Notified ${successCount} of ${allResults.length} subscriptions`);

    return new Response(
      JSON.stringify({
        success: true,
        notified: successCount,
        total: allResults.length,
        results: allResults
      }),
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
