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
    console.log("Starting check-expired-subscriptions function");
    
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get admin settings
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("admin_settings")
      .select("telegram_bot_token, telegram_channel_id, grace_period_days")
      .limit(1)
      .maybeSingle();

    if (settingsError) {
      console.error("Settings error:", settingsError);
      return new Response(
        JSON.stringify({ error: "Failed to load settings" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!settings?.telegram_bot_token || !settings?.telegram_channel_id) {
      console.log("Telegram bot not configured, skipping");
      return new Response(
        JSON.stringify({ message: "Telegram bot not configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const gracePeriodDays = settings.grace_period_days || 0;
    const now = new Date();
    
    console.log(`Grace period: ${gracePeriodDays} days`);

    // Find all active subscriptions where subscription_end has passed
    const { data: expiredSubscribers, error: subscribersError } = await supabaseAdmin
      .from("subscribers")
      .select("*")
      .eq("status", "active")
      .lt("subscription_end", now.toISOString());

    if (subscribersError) {
      console.error("Error fetching expired subscribers:", subscribersError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch subscribers" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${expiredSubscribers?.length || 0} expired active subscriptions`);

    // Also find grace_period subscribers to check if grace period has ended
    const { data: gracePeriodSubscribers, error: graceError } = await supabaseAdmin
      .from("subscribers")
      .select("*")
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
          // Grace period has ended or no grace period - kick user
          console.log(`Kicking user ${subscriber.telegram_user_id} - grace period ended`);
          
          const banResult = await callTelegramApi(botToken, "banChatMember", {
            chat_id: channelId,
            user_id: subscriber.telegram_user_id,
            revoke_messages: false,
          });

          if (banResult.ok) {
            await supabaseAdmin
              .from("subscribers")
              .update({ 
                status: "expired", 
                is_in_channel: false 
              })
              .eq("id", subscriber.id);
            
            results.kicked++;
            console.log(`User ${subscriber.telegram_user_id} kicked and status set to expired`);
          } else {
            console.error(`Failed to kick user ${subscriber.telegram_user_id}:`, banResult.description);
            // Still update status even if kick failed
            await supabaseAdmin
              .from("subscribers")
              .update({ status: "expired" })
              .eq("id", subscriber.id);
            results.errors++;
          }
        } else {
          // Move to grace period
          console.log(`Moving user ${subscriber.telegram_user_id} to grace period`);
          
          await supabaseAdmin
            .from("subscribers")
            .update({ status: "grace_period" })
            .eq("id", subscriber.id);
          
          // Send reminder message to user
          const daysLeft = Math.ceil((graceEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          await callTelegramApi(botToken, "sendMessage", {
            chat_id: subscriber.telegram_user_id,
            text: `⚠️ Ваша подписка истекла!\n\nУ вас есть ${daysLeft} дней для продления без потери доступа к архиву канала.\n\nПродлите сейчас, чтобы не потерять историю сообщений.`,
            parse_mode: "HTML",
          });
          
          results.moved_to_grace_period++;
        }
      } catch (error) {
        console.error(`Error processing subscriber ${subscriber.id}:`, error);
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
          // Grace period has ended - kick user
          console.log(`Kicking grace period user ${subscriber.telegram_user_id}`);
          
          const banResult = await callTelegramApi(botToken, "banChatMember", {
            chat_id: channelId,
            user_id: subscriber.telegram_user_id,
            revoke_messages: false,
          });

          if (banResult.ok) {
            await supabaseAdmin
              .from("subscribers")
              .update({ 
                status: "expired", 
                is_in_channel: false 
              })
              .eq("id", subscriber.id);
            
            results.kicked++;
          } else {
            console.error(`Failed to kick user ${subscriber.telegram_user_id}:`, banResult.description);
            await supabaseAdmin
              .from("subscribers")
              .update({ status: "expired" })
              .eq("id", subscriber.id);
            results.errors++;
          }
        }
      } catch (error) {
        console.error(`Error processing grace period subscriber ${subscriber.id}:`, error);
        results.errors++;
      }
    }

    console.log("Check expired subscriptions completed:", results);

    return new Response(
      JSON.stringify({ 
        success: true, 
        results,
        message: `Processed: ${results.moved_to_grace_period} moved to grace period, ${results.kicked} kicked, ${results.errors} errors`
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
