import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// MD5 hash function
async function md5(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("MD5", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Parse form data from POST body
async function parseFormData(req: Request): Promise<Record<string, string>> {
  const contentType = req.headers.get("content-type") || "";
  
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    const params = new URLSearchParams(text);
    const result: Record<string, string> = {};
    params.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
  
  if (contentType.includes("application/json")) {
    return await req.json();
  }
  
  // Try to parse as form data anyway
  const text = await req.text();
  const params = new URLSearchParams(text);
  const result: Record<string, string> = {};
  params.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

serve(async (req) => {
  // This is a PUBLIC webhook - no authentication required
  // Robokassa sends POST requests here
  
  console.log("Robokassa webhook received");
  console.log("Method:", req.method);
  
  if (req.method === "GET") {
    // Return OK for health checks
    return new Response("OK", { status: 200 });
  }

  try {
    // Create Supabase client with service role
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Parse POST data
    const data = await parseFormData(req);
    
    console.log("Received data:", JSON.stringify(data));

    // Extract parameters
    const outSum = data.OutSum || data.out_sum;
    const invId = data.InvId || data.inv_id;
    const signatureValue = (data.SignatureValue || data.signature_value || "").toUpperCase();
    const shpSource = data.Shp_source || data.shp_source || "";
    const shpSubscriberId = data.Shp_subscriber_id || data.shp_subscriber_id || "";
    const shpTelegramUserId = data.Shp_telegram_user_id || data.shp_telegram_user_id || "";
    const fee = data.Fee || data.fee || "";
    const email = data.EMail || data.email || "";
    const paymentMethod = data.PaymentMethod || data.payment_method || "";
    const incCurrLabel = data.IncCurrLabel || data.inc_curr_label || "";

    console.log(`Processing payment: InvId=${invId}, OutSum=${outSum}, Subscriber=${shpSubscriberId}, TelegramUser=${shpTelegramUserId}, Email=${email}`);

    if (!outSum || !invId || !signatureValue || !shpSubscriberId) {
      console.error("Missing required parameters");
      return new Response("bad sign", { status: 400 });
    }

    // Get Password2 from admin_settings
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("admin_settings")
      .select("robokassa_password2")
      .limit(1)
      .single();

    if (settingsError || !settings?.robokassa_password2) {
      console.error("Settings error:", settingsError);
      return new Response("config error", { status: 500 });
    }

    const password2 = settings.robokassa_password2;

    // Build signature verification string
    // Format: OutSum:InvId:Password2:Shp_source=value:Shp_subscriber_id=value:Shp_telegram_user_id=value
    // Shp parameters MUST be in alphabetical order
    const verifyString = `${outSum}:${invId}:${password2}:Shp_source=${shpSource}:Shp_subscriber_id=${shpSubscriberId}:Shp_telegram_user_id=${shpTelegramUserId}`;
    
    console.log("Verify string (without password):", verifyString.replace(password2, "***"));
    
    const calculatedSignature = (await md5(verifyString)).toUpperCase();

    console.log(`Signature check: received=${signatureValue}, calculated=${calculatedSignature}`);

    if (signatureValue !== calculatedSignature) {
      console.error("Signature mismatch!");
      return new Response("bad sign", { status: 400 });
    }

    console.log("Signature verified successfully");

    // Find payment by invoice_id
    const { data: payment, error: paymentError } = await supabaseAdmin
      .from("payment_history")
      .select("*, subscribers(*), subscription_tiers(*)")
      .eq("invoice_id", invId)
      .maybeSingle();

    if (paymentError) {
      console.error("Payment lookup error:", paymentError);
    }

    // Store Robokassa data
    const robokassaData = {
      out_sum: outSum,
      inv_id: invId,
      fee,
      email,
      payment_method: paymentMethod,
      inc_curr_label: incCurrLabel,
      shp_source: shpSource,
      shp_subscriber_id: shpSubscriberId,
      shp_telegram_user_id: shpTelegramUserId,
      received_at: new Date().toISOString(),
    };

    // Update subscriber email if provided
    if (email && shpSubscriberId) {
      const { error: emailUpdateError } = await supabaseAdmin
        .from("subscribers")
        .update({ email: email })
        .eq("id", shpSubscriberId);

      if (emailUpdateError) {
        console.error("Failed to update subscriber email:", emailUpdateError);
      } else {
        console.log(`Updated email for subscriber ${shpSubscriberId}: ${email}`);
      }
    }

    if (payment) {
      // Update existing payment
      const { error: updatePaymentError } = await supabaseAdmin
        .from("payment_history")
        .update({
          status: "completed",
          robokassa_data: robokassaData,
        })
        .eq("id", payment.id);

      if (updatePaymentError) {
        console.error("Payment update error:", updatePaymentError);
      }

      console.log(`Updated payment ${payment.id} to completed`);

      // Check if this is a recurring payment (first one)
      if (payment.payment_method === "robokassa_recurring") {
        // Save invoice ID for future recurring payments
        const { error: subscriberUpdateError } = await supabaseAdmin
          .from("subscribers")
          .update({
            robokassa_invoice_id: invId,
            next_payment_notification_sent: false, // Reset for next cycle
          })
          .eq("id", shpSubscriberId);

        if (subscriberUpdateError) {
          console.error("Failed to save robokassa_invoice_id:", subscriberUpdateError);
        } else {
          console.log(`Saved robokassa_invoice_id ${invId} for recurring payments`);
        }
      }

      // For recurring payments (transaction_type = 'recurring'), reset notification flag
      if (payment.transaction_type === "recurring") {
        await supabaseAdmin
          .from("subscribers")
          .update({
            next_payment_notification_sent: false,
          })
          .eq("id", shpSubscriberId);
        console.log(`Reset next_payment_notification_sent for ${shpSubscriberId}`);
      }

      // Calculate subscription end date
      const tier = payment.subscription_tiers;
      if (tier) {
        const now = new Date();
        const endDate = new Date(now.getTime() + tier.duration_days * 24 * 60 * 60 * 1000);

        // Activate subscription
        const { error: activateError } = await supabaseAdmin
          .from("subscribers")
          .update({
            status: "active",
            tier_id: payment.tier_id,
            subscription_start: now.toISOString(),
            subscription_end: endDate.toISOString(),
            subscriber_payment_method: payment.payment_method,
          })
          .eq("id", shpSubscriberId);

        if (activateError) {
          console.error("Subscription activation error:", activateError);
        } else {
          console.log(`Activated subscription for ${shpSubscriberId} until ${endDate.toISOString()}`);
        }
      }
    } else {
      // No pending payment found - create a completed one
      console.log("No pending payment found, creating new record");

      // Get subscriber and tier info
      const { data: subscriber } = await supabaseAdmin
        .from("subscribers")
        .select("tier_id")
        .eq("id", shpSubscriberId)
        .single();

      if (subscriber?.tier_id) {
        const { error: createPaymentError } = await supabaseAdmin
          .from("payment_history")
          .insert({
            subscriber_id: shpSubscriberId,
            tier_id: subscriber.tier_id,
            amount: parseFloat(outSum),
            invoice_id: invId,
            transaction_type: "initial",
            payment_method: "robokassa_single",
            status: "completed",
            robokassa_data: robokassaData,
          });

        if (createPaymentError) {
          console.error("Failed to create payment record:", createPaymentError);
        }
      }
    }

    // Send invite to the subscriber
    try {
      const { data: subscriber } = await supabaseAdmin
        .from("subscribers")
        .select("telegram_user_id")
        .eq("id", shpSubscriberId)
        .single();

      if (subscriber?.telegram_user_id) {
        // Get telegram settings
        const { data: telegramSettings } = await supabaseAdmin
          .from("admin_settings")
          .select("telegram_bot_token, telegram_channel_id")
          .limit(1)
          .single();

        if (telegramSettings?.telegram_bot_token && telegramSettings?.telegram_channel_id) {
          // Create invite link
          let channelId = telegramSettings.telegram_channel_id.toString();
          if (!channelId.startsWith("-100") && channelId.startsWith("-")) {
            channelId = "-100" + channelId.substring(1);
          }

          const inviteResponse = await fetch(
            `https://api.telegram.org/bot${telegramSettings.telegram_bot_token}/createChatInviteLink`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: channelId,
                member_limit: 1,
                creates_join_request: false,
              }),
            }
          );

          const inviteResult = await inviteResponse.json();

          if (inviteResult.ok) {
            // Send invite to user
            await fetch(
              `https://api.telegram.org/bot${telegramSettings.telegram_bot_token}/sendMessage`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: subscriber.telegram_user_id,
                  text: `🎉 Оплата получена! Спасибо!\n\nПерейдите по ссылке, чтобы присоединиться к каналу:\n${inviteResult.result.invite_link}\n\n⚠️ Ссылка одноразовая и действует только для вас.`,
                  parse_mode: "HTML",
                }),
              }
            );
            console.log(`Sent invite link to user ${subscriber.telegram_user_id}`);
          }
        }
      }
    } catch (inviteError) {
      console.error("Failed to send invite:", inviteError);
      // Don't fail the webhook if invite sending fails
    }

    // Return OK with invoice ID as required by Robokassa
    console.log(`Returning OK${invId}`);
    return new Response(`OK${invId}`, { status: 200 });

  } catch (error) {
    console.error("Webhook error:", error);
    return new Response("error", { status: 500 });
  }
});
