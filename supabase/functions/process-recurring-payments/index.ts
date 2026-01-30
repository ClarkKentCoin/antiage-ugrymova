import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DateTime } from "https://esm.sh/luxon@3.4.4";
import { sendAdminNotification } from "../_shared/adminNotifications.ts";
import { logUserNotification } from "../_shared/userNotificationLogger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// SHA256 hash function (Robokassa signatures)
async function sha256(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// Replace template variables with actual values
function replaceVariables(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

/**
 * Compute next subscription end date using calendar-based intervals.
 * Preserves time-of-day in the specified timezone.
 * 
 * @param nowISO - Current time as UTC ISO string
 * @param currentEndISO - Current subscription end as UTC ISO string (can be null)
 * @param unit - Interval unit: 'day', 'week', 'month', 'year'
 * @param count - Number of units to add
 * @param tz - IANA timezone (e.g., 'Europe/Moscow')
 * @returns New end date as UTC ISO string
 */
function computeNextEndISO(
  nowISO: string,
  currentEndISO: string | null,
  unit: string,
  count: number,
  tz: string
): string {
  const nowUTC = DateTime.fromISO(nowISO, { zone: 'utc' });
  const currentEndUTC = currentEndISO 
    ? DateTime.fromISO(currentEndISO, { zone: 'utc' }) 
    : null;

  // Renewal stacking: extend from max(now, currentEnd if in future)
  const startFromUTC = (currentEndUTC && currentEndUTC > nowUTC) ? currentEndUTC : nowUTC;
  
  // Convert to local timezone
  const startLocal = startFromUTC.setZone(tz);
  
  // Add interval based on unit
  let endLocal: DateTime;
  switch (unit) {
    case 'week':
      endLocal = startLocal.plus({ weeks: count });
      break;
    case 'month':
      endLocal = startLocal.plus({ months: count });
      break;
    case 'year':
      endLocal = startLocal.plus({ years: count });
      break;
    case 'day':
    default:
      endLocal = startLocal.plus({ days: count });
      break;
  }
  
  // Convert back to UTC and return as ISO string
  const endUTC = endLocal.toUTC();
  
  console.log(`[computeNextEndISO] nowISO=${nowISO}, currentEndISO=${currentEndISO}, startFromISO=${startFromUTC.toISO()}, interval_unit=${unit}, interval_count=${count}, billing_timezone=${tz}, newEndISO=${endUTC.toISO()}`);
  
  return endUTC.toISO()!;
}

const DEFAULT_PAYMENT_SUCCESS = `✅ Оплата успешна

Ваша подписка на канал "{channel_name}" успешно продлена!

💰 Списано: {amount}₽
📅 Действует до: {expires_date}

Спасибо что с нами! 💙`;

const DEFAULT_PAYMENT_FAILED = `❌ Ошибка оплаты

Не удалось списать средства за продление подписки на канал "{channel_name}".

💰 Сумма: {amount}₽
❗ Причина: {error_message}

У вас есть {grace_days} дней для продления вручную. После этого доступ к каналу будет закрыт.`;

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

  console.log("Processing recurring payments");

  try {
    // Create Supabase client with service role
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Find subscriptions expiring in 1-3 days that have auto_renewal enabled
    const now = new Date();
    const oneDayFromNow = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const { data: subscriptions, error: subError } = await supabaseAdmin
      .from("subscribers")
      .select(`
        id,
        telegram_user_id,
        tier_id,
        subscription_end,
        robokassa_invoice_id,
        subscription_tiers (
          name,
          price,
          duration_days,
          interval_unit,
          interval_count,
          billing_timezone
        )
      `)
      .eq("auto_renewal", true)
      .eq("subscriber_payment_method", "robokassa_recurring")
      .eq("status", "active")
      .not("robokassa_invoice_id", "is", null)
      .not("auto_renewal_consent_date", "is", null) // Must have consent
      .gte("subscription_end", oneDayFromNow.toISOString())
      .lte("subscription_end", threeDaysFromNow.toISOString());

    if (subError) {
      console.error("Error fetching subscriptions:", subError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch subscriptions" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${subscriptions?.length || 0} subscriptions to process`);

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: "No recurring payments to process" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get Robokassa and notification settings
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("admin_settings")
      .select("robokassa_merchant_login, robokassa_password1, robokassa_test_mode, telegram_bot_token, channel_name, grace_period_days, notification_payment_success, notification_payment_failed")
      .limit(1)
      .maybeSingle();

    if (settingsError || !settings?.robokassa_merchant_login || !settings?.robokassa_password1) {
      console.error("Robokassa not configured:", settingsError);
      return new Response(
        JSON.stringify({ error: "Robokassa not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const channelName = settings.channel_name || "Канал";
    const graceDays = settings.grace_period_days || 0;
    const successTemplate = settings.notification_payment_success || DEFAULT_PAYMENT_SUCCESS;
    const failedTemplate = settings.notification_payment_failed || DEFAULT_PAYMENT_FAILED;
    const botToken = settings.telegram_bot_token;

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

        // Generate new InvoiceID
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000);
        const newInvoiceId = `${timestamp}${random}`;

        // Create payment record
        const { data: payment, error: paymentError } = await supabaseAdmin
          .from("payment_history")
          .insert({
            subscriber_id: subscription.id,
            tier_id: subscription.tier_id,
            amount: tier.price,
            invoice_id: newInvoiceId,
            transaction_type: "recurring",
            payment_method: "robokassa_recurring",
            status: "processing",
          })
          .select()
          .single();

        if (paymentError) {
          console.error(`Failed to create payment for ${subscription.id}:`, paymentError);
          results.push({ subscriber_id: subscription.id, success: false, message: "Failed to create payment" });
          continue;
        }

        // Build signature for recurring payment
        // Format: MD5(MerchantLogin:PreviousInvoiceID:InvoiceID:OutSum:Password1)
        const merchantLogin = settings.robokassa_merchant_login;
        const previousInvoiceId = subscription.robokassa_invoice_id;
        const outSum = Number(tier.price).toFixed(2);
        const password1 = settings.robokassa_password1;

        const signatureString = `${merchantLogin}:${previousInvoiceId}:${newInvoiceId}:${outSum}:${password1}`;
        const signature = await sha256(signatureString);

        console.log(`Sending recurring payment request for ${subscription.id}`);

        // Send recurring payment request to Robokassa
        const formData = new URLSearchParams();
        formData.append("MerchantLogin", merchantLogin);
        formData.append("InvoiceID", newInvoiceId);
        formData.append("PreviousInvoiceID", previousInvoiceId!);
        formData.append("OutSum", outSum);
        formData.append("SignatureValue", signature);
        
        if (settings.robokassa_test_mode) {
          formData.append("IsTest", "1");
        }

        const response = await fetch("https://auth.robokassa.ru/Merchant/Recurring", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formData.toString(),
        });

        const responseText = await response.text();
        console.log(`Robokassa response for ${subscription.id}:`, responseText);

        const amount = Number(tier.price).toLocaleString('ru-RU');

        // Check if response contains OK
        if (responseText.toUpperCase().includes("OK")) {
          // Calculate new expiration date using calendar intervals
          const nowISO = new Date().toISOString();
          const currentEndISO = subscription.subscription_end;
          
          // Use tier's interval fields with fallback to duration_days
          const intervalUnit = tier.interval_unit || 'day';
          const intervalCount = tier.interval_count || tier.duration_days || 30;
          const billingTimezone = tier.billing_timezone || 'Europe/Moscow';
          
          const newEndISO = computeNextEndISO(
            nowISO,
            currentEndISO,
            intervalUnit,
            intervalCount,
            billingTimezone
          );
          
          // Format expires date in Moscow timezone for notification
          const expiresDate = DateTime.fromISO(newEndISO, { zone: 'utc' })
            .setZone(billingTimezone)
            .toLocaleString({ day: 'numeric', month: 'long', year: 'numeric' }, { locale: 'ru' });

          // Update payment status and subscription
          await supabaseAdmin
            .from("payment_history")
            .update({ status: "completed" })
            .eq("id", payment.id);

          await supabaseAdmin
            .from("subscribers")
            .update({ 
              subscription_end: newEndISO,
              robokassa_invoice_id: newInvoiceId,
              next_payment_notification_sent: false,
              single_expiry_notification_sent: false,
            })
            .eq("id", subscription.id);

          // Send success notification
          if (botToken) {
            const successMessage = replaceVariables(successTemplate, {
              channel_name: channelName,
              amount: amount,
              expires_date: expiresDate,
            });

            const msgResult = await fetch(
              `https://api.telegram.org/bot${botToken}/sendMessage`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: subscription.telegram_user_id,
                  text: successMessage,
                  parse_mode: "HTML",
                }),
              }
            );
            const msgResponse = await msgResult.json();

            // Log user notification
            await logUserNotification({
              supabaseAdmin,
              source: "process-recurring-payments",
              notificationKey: "payment_success",
              subscriberId: subscription.id,
              telegramUserId: subscription.telegram_user_id,
              subscriptionEnd: newEndISO,
              telegramOk: msgResponse.ok,
              telegramError: msgResponse.ok ? null : msgResponse.description,
              textPreview: successMessage,
            });
          }

          // Send admin notification for successful payment
          await sendAdminNotification({
            supabaseAdmin,
            eventType: "PAYMENT_SUCCESS",
            subscriber: {
              id: subscription.id,
              name: null,
              username: null,
              telegram_user_id: subscription.telegram_user_id,
              email: null,
            },
            plan: tier.name ?? null,
            status: "active",
            method: "robokassa_recurring",
            amount: tier.price,
            subscriptionEndISO: newEndISO,
            relatedAtISO: newEndISO,
            source: "process-recurring-payments",
          });

          results.push({ 
            subscriber_id: subscription.id, 
            success: true, 
            message: "Recurring payment completed" 
          });
        } else {
          // Mark payment as failed
          await supabaseAdmin
            .from("payment_history")
            .update({ 
              status: "failed",
              robokassa_data: { error: responseText }
            })
            .eq("id", payment.id);

          // Send failure notification
          if (botToken) {
            const failedMessage = replaceVariables(failedTemplate, {
              channel_name: channelName,
              amount: amount,
              error_message: responseText || "Неизвестная ошибка",
              grace_days: String(graceDays),
            });

            const msgResult = await fetch(
              `https://api.telegram.org/bot${botToken}/sendMessage`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: subscription.telegram_user_id,
                  text: failedMessage,
                  parse_mode: "HTML",
                }),
              }
            );
            const msgResponse = await msgResult.json();

            // Log user notification
            await logUserNotification({
              supabaseAdmin,
              source: "process-recurring-payments",
              notificationKey: "payment_failed",
              subscriberId: subscription.id,
              telegramUserId: subscription.telegram_user_id,
              telegramOk: msgResponse.ok,
              telegramError: msgResponse.ok ? null : msgResponse.description,
              textPreview: failedMessage,
            });
          }

          // Send admin notification for failed payment
          await sendAdminNotification({
            supabaseAdmin,
            eventType: "PAYMENT_FAILED",
            subscriber: {
              id: subscription.id,
              name: null,
              username: null,
              telegram_user_id: subscription.telegram_user_id,
              email: null,
            },
            plan: tier.name ?? null,
            status: "active",
            method: "robokassa_recurring",
            amount: tier.price,
            note: responseText || "Unknown error",
            source: "process-recurring-payments",
          });

          results.push({ 
            subscriber_id: subscription.id, 
            success: false, 
            message: `Robokassa error: ${responseText}` 
          });
        }

      } catch (subError) {
        console.error(`Error processing subscription ${subscription.id}:`, subError);
        results.push({ 
          subscriber_id: subscription.id, 
          success: false, 
          message: subError instanceof Error ? subError.message : "Unknown error" 
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`Processed ${results.length} subscriptions, ${successCount} successful`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        processed: results.length,
        successful: successCount,
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
