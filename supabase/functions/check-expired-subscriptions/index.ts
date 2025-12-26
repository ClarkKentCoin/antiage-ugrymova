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
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

const DEFAULT_GRACE_PERIOD_WARNING = `⚠️ Последнее предупреждение

Ваша подписка на канал "{channel_name}" истекла.

У вас осталось {days} дней для продления. После этого вы будете удалены из канала и потеряете доступ к архиву сообщений.

💎 Продлите сейчас, чтобы сохранить доступ.`;

const DEFAULT_SUBSCRIPTION_EXPIRED = `❗ Подписка завершена

Ваша подписка на канал "{channel_name}" завершена, и вы были удалены из канала.

Чтобы вернуть доступ и историю сообщений, оформите новую подписку.`;

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

  // Accept either SCHEDULED_TASK_SECRET or anon key for cron jobs
  const authHeader = req.headers.get("Authorization");
  const expectedSecret = Deno.env.get("SCHEDULED_TASK_SECRET");
  // Hardcode anon key for cron job compatibility
  const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptZXdmaG5heWNqdXZwanhraWluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0MTcwNDUsImV4cCI6MjA4MTk5MzA0NX0.y4GssGSn_PIMg8CgoYU2fSyujoAA8VV07I8PKDfipRo";
  
  const bearerToken = authHeader?.replace("Bearer ", "");
  const isValidSecret = bearerToken === expectedSecret;
  const isValidAnonKey = bearerToken === anonKey;
  
  if (!authHeader || (!isValidSecret && !isValidAnonKey)) {
    console.error("Unauthorized scheduled task execution attempt");
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    console.log("Starting check-expired-subscriptions function");
    
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get admin settings including notification templates
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("admin_settings")
      .select("telegram_bot_token, telegram_channel_id, grace_period_days, channel_name, notification_grace_period_warning, notification_subscription_expired")
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
    const channelName = settings.channel_name || "Канал";
    const gracePeriodWarningTemplate = settings.notification_grace_period_warning || DEFAULT_GRACE_PERIOD_WARNING;
    const subscriptionExpiredTemplate = settings.notification_subscription_expired || DEFAULT_SUBSCRIPTION_EXPIRED;
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
          // Grace period has ended or no grace period - kick user using ban + unban
          console.log(`Kicking user ${subscriber.telegram_user_id} - grace period ended`);
          
          // Step 1: Ban user (removes from channel)
          const banResult = await callTelegramApi(botToken, "banChatMember", {
            chat_id: channelId,
            user_id: subscriber.telegram_user_id,
            revoke_messages: false,
          });

          if (banResult.ok) {
            // Step 2: Small delay for reliability
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Step 3: Unban user (removes from banned list so they can rejoin with new invite)
            const unbanResult = await callTelegramApi(botToken, "unbanChatMember", {
              chat_id: channelId,
              user_id: subscriber.telegram_user_id,
              only_if_banned: true,
            });
            
            if (!unbanResult.ok) {
              console.error(`Failed to unban user ${subscriber.telegram_user_id} (not critical):`, unbanResult.description);
            } else {
              console.log(`User ${subscriber.telegram_user_id} successfully removed and unbanned`);
            }
            
            await supabaseAdmin
              .from("subscribers")
              .update({ 
                status: "expired", 
                is_in_channel: false 
              })
              .eq("id", subscriber.id);
            
            // Send subscription expired notification
            const expiredMessage = replaceVariables(subscriptionExpiredTemplate, {
              channel_name: channelName,
            });
            
            await callTelegramApi(botToken, "sendMessage", {
              chat_id: subscriber.telegram_user_id,
              text: expiredMessage,
              parse_mode: "HTML",
            });
            
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
          
          const { error: updateError } = await supabaseAdmin
            .from("subscribers")
            .update({ status: "grace_period" })
            .eq("id", subscriber.id);
          
          if (updateError) {
            console.error(`Failed to update status for ${subscriber.id}:`, updateError);
            results.errors++;
            continue;
          }
          
          console.log(`Successfully updated status to grace_period for ${subscriber.id}`);
          
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
          // Grace period has ended - kick user using ban + unban
          console.log(`Kicking grace period user ${subscriber.telegram_user_id}`);
          
          // Step 1: Ban user (removes from channel)
          const banResult = await callTelegramApi(botToken, "banChatMember", {
            chat_id: channelId,
            user_id: subscriber.telegram_user_id,
            revoke_messages: false,
          });

          if (banResult.ok) {
            // Step 2: Small delay for reliability
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Step 3: Unban user (removes from banned list so they can rejoin with new invite)
            const unbanResult = await callTelegramApi(botToken, "unbanChatMember", {
              chat_id: channelId,
              user_id: subscriber.telegram_user_id,
              only_if_banned: true,
            });
            
            if (!unbanResult.ok) {
              console.error(`Failed to unban user ${subscriber.telegram_user_id} (not critical):`, unbanResult.description);
            } else {
              console.log(`User ${subscriber.telegram_user_id} successfully removed and unbanned`);
            }
            
            await supabaseAdmin
              .from("subscribers")
              .update({ 
                status: "expired", 
                is_in_channel: false 
              })
              .eq("id", subscriber.id);
            
            // Send subscription expired notification
            const expiredMessage = replaceVariables(subscriptionExpiredTemplate, {
              channel_name: channelName,
            });
            
            await callTelegramApi(botToken, "sendMessage", {
              chat_id: subscriber.telegram_user_id,
              text: expiredMessage,
              parse_mode: "HTML",
            });
            
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
