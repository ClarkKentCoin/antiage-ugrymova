import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendAdminNotification } from "../_shared/adminNotifications.ts";
import { logUserNotification } from "../_shared/userNotificationLogger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Replace template variables with actual values
function replaceVariables(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

const DEFAULT_SINGLE_EXPIRY_REMINDER = `⏳ Подписка скоро закончится

Через {days} дней закончится ваша подписка на канал "{channel_name}".

📅 Действует до: {expires_date}

Чтобы продлить доступ — откройте Mini App и выберите срок подписки.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Verify scheduled task secret
  const authHeader = req.headers.get("Authorization");
  const expectedSecret = Deno.env.get("SCHEDULED_TASK_SECRET");
  
  if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
    console.error("Unauthorized scheduled task execution attempt");
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log("Processing single expiry notifications");

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get settings including notification template
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("admin_settings")
      .select("telegram_bot_token, channel_name, notification_subscription_expiring_single, reminder_days_before")
      .limit(1)
      .maybeSingle();

    if (settingsError || !settings?.telegram_bot_token) {
      console.error("Telegram bot not configured:", settingsError);
      return new Response(
        JSON.stringify({ error: "Telegram bot not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const reminderDays = settings.reminder_days_before || 3;
    const channelName = settings.channel_name || "Канал";
    const messageTemplate = settings.notification_subscription_expiring_single || DEFAULT_SINGLE_EXPIRY_REMINDER;

    // Find subscriptions expiring in exactly reminderDays days with auto_renewal=false
    const now = new Date();
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
        single_expiry_notification_sent,
        subscription_tiers (
          name,
          price
        )
      `)
      .eq("auto_renewal", false)
      .eq("status", "active")
      .eq("single_expiry_notification_sent", false)
      .gte("subscription_end", targetDate.toISOString())
      .lt("subscription_end", nextDay.toISOString());

    if (subError) {
      console.error("Error fetching subscriptions:", subError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch subscriptions" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${subscriptions?.length || 0} single subscriptions to notify`);

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, notified: 0, message: "No single expiry notifications to send" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: Array<{ subscriber_id: string; success: boolean; message: string }> = [];

    for (const subscription of subscriptions) {
      try {
        const tierData = subscription.subscription_tiers;
        const tier = Array.isArray(tierData) ? tierData[0] : tierData;
        
        const expiresDate = new Date(subscription.subscription_end);
        const formattedDate = expiresDate.toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        });

        // Replace variables in template
        const message = replaceVariables(messageTemplate, {
          channel_name: channelName,
          days: String(reminderDays),
          expires_date: formattedDate,
        });

        // Send notification via Telegram
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

        // Log user notification
        await logUserNotification({
          supabaseAdmin,
          source: "notify-expiring-single-subscriptions",
          notificationKey: "single_expiry_reminder",
          subscriberId: subscription.id,
          telegramUserId: subscription.telegram_user_id,
          subscriptionEnd: subscription.subscription_end,
          days: reminderDays,
          telegramOk: result.ok,
          telegramError: result.ok ? null : result.description,
          textPreview: message,
        });

        if (result.ok) {
          // Update notification sent flag
          await supabaseAdmin
            .from("subscribers")
            .update({ single_expiry_notification_sent: true })
            .eq("id", subscription.id);

          console.log(`Single expiry notification sent to ${subscription.telegram_user_id}`);
          results.push({ subscriber_id: subscription.id, success: true, message: "Notification sent" });

          // Send admin notification
          await sendAdminNotification({
            supabaseAdmin,
            eventType: "EXPIRING_IN_3_DAYS",
            subscriber: {
              id: subscription.id ?? null,
              name: [subscription.first_name, subscription.last_name].filter(Boolean).join(" ") || null,
              username: subscription.telegram_username ?? null,
              telegram_user_id: subscription.telegram_user_id ?? null,
              email: subscription.email ?? null,
            },
            plan: tier?.name ?? null,
            status: subscription.status ?? "active",
            method: "single",
            subscriptionEndISO: subscription.subscription_end ?? null,
            relatedAtISO: subscription.subscription_end ?? null,
            source: "notify-expiring-single-subscriptions",
          });
        } else {
          console.error(`Failed to send notification to ${subscription.telegram_user_id}:`, result);
          results.push({ subscriber_id: subscription.id, success: false, message: result.description || "Failed to send" });
        }

      } catch (notifyError) {
        console.error(`Error notifying subscription ${subscription.id}:`, notifyError);
        results.push({
          subscriber_id: subscription.id,
          success: false,
          message: notifyError instanceof Error ? notifyError.message : "Unknown error"
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`Notified ${successCount} of ${results.length} single subscriptions`);

    return new Response(
      JSON.stringify({
        success: true,
        notified: successCount,
        total: results.length,
        results
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
