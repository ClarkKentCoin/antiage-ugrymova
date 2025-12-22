import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("Processing upcoming payment notifications");

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Find subscriptions expiring in exactly 3 days with auto_renewal enabled
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const fourDaysFromNow = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);

    const { data: subscriptions, error: subError } = await supabaseAdmin
      .from("subscribers")
      .select(`
        id,
        telegram_user_id,
        subscription_end,
        next_payment_notification_sent,
        subscription_tiers (
          name,
          price
        )
      `)
      .eq("auto_renewal", true)
      .eq("status", "active")
      .eq("next_payment_notification_sent", false)
      .gte("subscription_end", threeDaysFromNow.toISOString())
      .lt("subscription_end", fourDaysFromNow.toISOString());

    if (subError) {
      console.error("Error fetching subscriptions:", subError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch subscriptions" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${subscriptions?.length || 0} subscriptions to notify`);

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, notified: 0, message: "No notifications to send" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get Telegram settings
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("admin_settings")
      .select("telegram_bot_token")
      .limit(1)
      .single();

    if (settingsError || !settings?.telegram_bot_token) {
      console.error("Telegram bot not configured:", settingsError);
      return new Response(
        JSON.stringify({ error: "Telegram bot not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: Array<{ subscriber_id: string; success: boolean; message: string }> = [];

    for (const subscription of subscriptions) {
      try {
        const tierData = subscription.subscription_tiers;
        const tier = Array.isArray(tierData) ? tierData[0] : tierData;
        
        if (!tier) {
          console.error(`No tier found for subscription ${subscription.id}`);
          results.push({ subscriber_id: subscription.id, success: false, message: "No tier found" });
          continue;
        }

        const amount = Number(tier.price).toLocaleString('ru-RU');
        const paymentDate = new Date(subscription.subscription_end);
        const formattedDate = paymentDate.toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        });

        const message = `⏰ <b>Уведомление об автоматическом продлении</b>

Через 3 дня будет списана оплата за продление подписки:
💰 Сумма: <b>${amount}₽</b>
📅 Дата списания: <b>${formattedDate}</b>

Отключить автопродление можно в настройках подписки.`;

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

        if (result.ok) {
          // Update notification sent flag
          await supabaseAdmin
            .from("subscribers")
            .update({ next_payment_notification_sent: true })
            .eq("id", subscription.id);

          console.log(`Notification sent to ${subscription.telegram_user_id}`);
          results.push({ subscriber_id: subscription.id, success: true, message: "Notification sent" });
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
    console.log(`Notified ${successCount} of ${results.length} subscriptions`);

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
