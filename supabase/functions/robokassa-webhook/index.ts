import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DateTime } from "https://esm.sh/luxon@3.4.4";
import { sendAdminNotification } from "../_shared/adminNotifications.ts";
import { logUserNotification } from "../_shared/userNotificationLogger.ts";

// SHA256 hash function (Robokassa signatures)
async function sha256(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
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
    
    // Store computed subscription end date for use in Telegram notification
    let computedNewEndISO: string | null = null;

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
    
    const calculatedSignature = await sha256(verifyString);

    console.log(`Signature check: received=${signatureValue}, calculated=${calculatedSignature}`);

    if (signatureValue !== calculatedSignature) {
      console.error("Signature mismatch!");
      // Log signature failure
      try {
        await supabaseAdmin.from("system_logs").insert({
          level: "error",
          event_type: "payment.webhook_error",
          source: "robokassa",
          subscriber_id: shpSubscriberId || null,
          telegram_user_id: shpTelegramUserId ? parseInt(shpTelegramUserId, 10) : null,
          request_id: invId,
          message: "Signature verification failed",
          payload: {
            inv_id: invId,
            out_sum: outSum,
            has_signature: !!signatureValue,
          },
        });
      } catch (logError) {
        console.warn("Failed to log webhook error:", logError);
      }
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
            single_expiry_notification_sent: false, // Reset for single expiry cycle
          })
          .eq("id", shpSubscriberId);

        if (subscriberUpdateError) {
          console.error("Failed to save robokassa_invoice_id:", subscriberUpdateError);
        } else {
          console.log(`Saved robokassa_invoice_id ${invId} for recurring payments`);
        }
      }

      // For recurring payments (transaction_type = 'recurring'), reset notification flags
      if (payment.transaction_type === "recurring") {
        await supabaseAdmin
          .from("subscribers")
          .update({
            next_payment_notification_sent: false,
            single_expiry_notification_sent: false,
          })
          .eq("id", shpSubscriberId);
        console.log(`Reset notification flags for ${shpSubscriberId}`);
      }

      // For single payments, also reset the single_expiry_notification_sent flag
      if (payment.payment_method === "robokassa_single") {
        await supabaseAdmin
          .from("subscribers")
          .update({
            single_expiry_notification_sent: false,
          })
          .eq("id", shpSubscriberId);
        console.log(`Reset single_expiry_notification_sent for ${shpSubscriberId}`);
      }

      // Calculate subscription end date using calendar intervals
      const tier = payment.subscription_tiers;
      if (tier) {
        const nowISO = new Date().toISOString();
        
        // Get current subscription_start and subscription_end from subscriber
        const { data: currentSubscriber } = await supabaseAdmin
          .from("subscribers")
          .select("subscription_start, subscription_end")
          .eq("id", shpSubscriberId)
          .maybeSingle();
        
        const currentStartISO = currentSubscriber?.subscription_start || null;
        const currentEndISO = currentSubscriber?.subscription_end || null;
        
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

        // Activate subscription - only set subscription_start if it's currently null
        // Also set auto_renewal based on payment method
        const isRecurringPayment = payment.payment_method === "robokassa_recurring";
        
        const updateData: Record<string, any> = {
          status: "active",
          tier_id: payment.tier_id,
          subscription_end: newEndISO,
          subscriber_payment_method: payment.payment_method,
          auto_renewal: isRecurringPayment,
        };
        
        // Only set subscription_start on first activation, not on renewals
        if (!currentStartISO) {
          updateData.subscription_start = nowISO;
        }
        
        console.log(`[robokassa-webhook] Setting auto_renewal=${isRecurringPayment} for payment_method=${payment.payment_method}`);

        const { error: activateError } = await supabaseAdmin
          .from("subscribers")
          .update(updateData)
          .eq("id", shpSubscriberId);

        if (activateError) {
          console.error("Subscription activation error:", activateError);
        } else {
          console.log(`Activated subscription for ${shpSubscriberId} until ${newEndISO}`);
        }
        
        // Store newEndISO for use in Telegram notification
        computedNewEndISO = newEndISO;

        // Log payment success
        try {
          await supabaseAdmin.from("system_logs").insert({
            level: "info",
            event_type: "payment.succeeded",
            source: "robokassa",
            subscriber_id: shpSubscriberId,
            telegram_user_id: shpTelegramUserId ? parseInt(shpTelegramUserId, 10) : null,
            tier_id: payment.tier_id,
            request_id: invId,
            message: "Payment completed successfully",
            payload: {
              inv_id: invId,
              out_sum: outSum,
              amount: parseFloat(outSum),
              payment_method: payment.payment_method,
              has_signature: !!signatureValue,
              email: email || null,
              subscription_end: newEndISO,
              fee: fee || null,
            },
            });
        } catch (logError) {
          console.warn("Failed to log payment.succeeded event:", logError);
        }

        // Send admin notification (safe, never throws)
        // Fetch full subscriber data for notification
        const { data: fullSubscriber } = await supabaseAdmin
          .from("subscribers")
          .select("id, first_name, last_name, telegram_username, telegram_user_id, email, status")
          .eq("id", shpSubscriberId)
          .maybeSingle();

        await sendAdminNotification({
          supabaseAdmin,
          eventType: "PAYMENT_SUCCESS",
          subscriber: {
            id: fullSubscriber?.id ?? shpSubscriberId,
            name: [fullSubscriber?.first_name, fullSubscriber?.last_name].filter(Boolean).join(" ") || null,
            username: fullSubscriber?.telegram_username ?? null,
            telegram_user_id: fullSubscriber?.telegram_user_id ?? shpTelegramUserId ?? null,
            email: fullSubscriber?.email ?? email ?? null,
          },
          plan: tier.name ?? null,
          status: fullSubscriber?.status ?? "active",
          method: payment.payment_method ?? "robokassa",
          amount: outSum ?? null,
          subscriptionEndISO: newEndISO ?? null,
          note: payment.payment_note ?? null,
          paymentId: payment.id ?? null,
          relatedAtISO: newEndISO ?? null,
          source: "robokassa-webhook",
        });
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

    // Send invite and success message to the subscriber
    try {
      const { data: subscriberData } = await supabaseAdmin
        .from("subscribers")
        .select("telegram_user_id, is_in_channel")
        .eq("id", shpSubscriberId)
        .single();

      if (subscriberData?.telegram_user_id) {
        // Get telegram settings including notification template
        const { data: telegramSettings } = await supabaseAdmin
          .from("admin_settings")
          .select("telegram_bot_token, telegram_channel_id, channel_name, notification_payment_success")
          .limit(1)
          .single();

        if (telegramSettings?.telegram_bot_token && telegramSettings?.telegram_channel_id) {
          let channelId = telegramSettings.telegram_channel_id.toString();
          if (!channelId.startsWith("-100") && channelId.startsWith("-")) {
            channelId = "-100" + channelId.substring(1);
          }

          // First send the success payment message from settings
          if (telegramSettings.notification_payment_success) {
            const expiresDate = computedNewEndISO 
              ? DateTime.fromISO(computedNewEndISO, { zone: 'utc' })
                  .setZone('Europe/Moscow')
                  .toLocaleString({ day: 'numeric', month: 'long', year: 'numeric' }, { locale: 'ru' })
              : 'неизвестно';
            
            const formattedAmount = Math.round(parseFloat(outSum)).toString();
            let successMessage = telegramSettings.notification_payment_success
              .replace(/{channel_name}/g, telegramSettings.channel_name || 'канал')
              .replace(/{amount}/g, formattedAmount)
              .replace(/{expires_date}/g, expiresDate);

            const msgResult = await fetch(
              `https://api.telegram.org/bot${telegramSettings.telegram_bot_token}/sendMessage`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: subscriberData.telegram_user_id,
                  text: successMessage,
                  parse_mode: "HTML",
                }),
              }
            );
            const msgResponse = await msgResult.json();
            console.log(`[robokassa] Sent success payment message to user ${subscriberData.telegram_user_id}`);

            // Log user notification
            await logUserNotification({
              supabaseAdmin,
              source: "robokassa-webhook",
              notificationKey: "payment_success",
              subscriberId: shpSubscriberId,
              telegramUserId: subscriberData.telegram_user_id,
              subscriptionEnd: computedNewEndISO,
              telegramOk: msgResponse.ok,
              telegramError: msgResponse.ok ? null : msgResponse.description,
              textPreview: successMessage,
            });
          }

          // Check if user is already in channel - skip invite generation
          if (subscriberData.is_in_channel === true) {
            console.log(`[robokassa] User ${subscriberData.telegram_user_id} already in channel, skipping invite generation`);
          } else {
            // Check for existing valid (non-expired, non-revoked) invite before creating new one
            const nowISO = new Date().toISOString();
            const { data: existingInvite, error: existingError } = await supabaseAdmin
              .from("invite_links")
              .select("id, invite_link, expires_at")
              .eq("subscriber_id", shpSubscriberId)
              .eq("revoked", false)
              .gt("expires_at", nowISO)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (existingError) {
              console.error("[robokassa] Failed to check existing invite:", existingError);
            }

            if (existingInvite) {
              // Valid invite already exists - skip creating new one to prevent duplicates
              console.log(`[robokassa] existing active invite found (expires: ${existingInvite.expires_at}), skip creating new one`);
              // Log skip event
              try {
                await supabaseAdmin.from("system_logs").insert({
                  level: "info",
                  event_type: "telegram.invite_skipped_existing",
                  source: "robokassa",
                  subscriber_id: shpSubscriberId,
                  telegram_user_id: subscriberData?.telegram_user_id ? Number(subscriberData.telegram_user_id) : null,
                  request_id: invId,
                  message: "Skipped invite creation - valid invite already exists",
                  payload: { expires_at: existingInvite.expires_at, inv_id: invId },
                });
              } catch (logErr) {
                console.warn("[robokassa] Failed to log invite skip:", logErr);
              }
            } else {
              // No valid invite - proceed with full flow
              
              // Step 1: Unban the user if they were previously banned
              console.log(`[robokassa] Unbanning user ${subscriberData.telegram_user_id} if banned`);
              const unbanResponse = await fetch(
                `https://api.telegram.org/bot${telegramSettings.telegram_bot_token}/unbanChatMember`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: channelId,
                    user_id: subscriberData.telegram_user_id,
                    only_if_banned: true,
                  }),
                }
              );
              const unbanResult = await unbanResponse.json();
              if (unbanResult.ok) {
                console.log(`[robokassa] User ${subscriberData.telegram_user_id} unbanned successfully`);
              } else {
                console.log(`[robokassa] Unban result: ${unbanResult.description || 'user was not banned'}`);
              }

              // Step 2: Revoke previous non-revoked invite links for this subscriber
              const { data: previousLinks, error: linksError } = await supabaseAdmin
                .from("invite_links")
                .select("id, invite_link")
                .eq("subscriber_id", shpSubscriberId)
                .eq("revoked", false);

            if (linksError) {
              console.error("[robokassa] Failed to fetch previous invite links:", linksError);
            } else if (previousLinks && previousLinks.length > 0) {
              console.log(`[robokassa] Found ${previousLinks.length} previous invite links to revoke`);
              
              for (const link of previousLinks) {
                const revokeResponse = await fetch(
                  `https://api.telegram.org/bot${telegramSettings.telegram_bot_token}/revokeChatInviteLink`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      chat_id: channelId,
                      invite_link: link.invite_link,
                    }),
                  }
                );
                const revokeResult = await revokeResponse.json();
                
                if (!revokeResult.ok) {
                  console.error(`[robokassa] Failed to revoke link ${link.id}:`, revokeResult.description);
                }

                await supabaseAdmin
                  .from("invite_links")
                  .update({ 
                    revoked: true, 
                    revoked_at: new Date().toISOString() 
                  })
                  .eq("id", link.id);
              }
              
              console.log(`[robokassa] invite revoked count: ${previousLinks.length}`);
            }

            // Step 3: Create new invite link with expire_date (10 minutes = 600 seconds)
            const nowUnix = Math.floor(Date.now() / 1000);
            const expireTimestamp = nowUnix + 600;
            const expiresAtISO = new Date(expireTimestamp * 1000).toISOString();

            const inviteResponse = await fetch(
              `https://api.telegram.org/bot${telegramSettings.telegram_bot_token}/createChatInviteLink`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: channelId,
                  member_limit: 1,
                  creates_join_request: false,
                  expire_date: expireTimestamp,
                }),
              }
            );

            const inviteResult = await inviteResponse.json();

            if (inviteResult.ok) {
              const newInviteLink = inviteResult.result.invite_link;

              // Step 4: Store new invite link in invite_links table
              const { error: insertError } = await supabaseAdmin
                .from("invite_links")
                .insert({
                  subscriber_id: shpSubscriberId,
                  invite_link: newInviteLink,
                  expires_at: expiresAtISO,
                  revoked: false,
                });

              if (insertError) {
                console.error("[robokassa] Failed to store invite link:", insertError);
              } else {
                console.log(`[robokassa] invite created (10 min, single-use) for subscriber ${shpSubscriberId}`);
                // Log invite creation
                try {
                  await supabaseAdmin.from("system_logs").insert({
                    level: "info",
                    event_type: "telegram.invite_created",
                    source: "robokassa",
                    subscriber_id: shpSubscriberId,
                    telegram_user_id: subscriberData?.telegram_user_id ? Number(subscriberData.telegram_user_id) : null,
                    request_id: invId,
                    message: "Invite link created after payment",
                    payload: { invite_link: newInviteLink, expires_at: expiresAtISO, inv_id: invId, out_sum: outSum },
                  });
                } catch (logErr) {
                  console.warn("[robokassa] Failed to log invite creation:", logErr);
                }
              }

              await fetch(
                `https://api.telegram.org/bot${telegramSettings.telegram_bot_token}/sendMessage`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: subscriberData.telegram_user_id,
                    text: `🔗 Перейдите по ссылке, чтобы присоединиться к каналу:\n${newInviteLink}\n\n⚠️ Ссылка одноразовая и действует 10 минут.`,
                    parse_mode: "HTML",
                  }),
                }
              );
              console.log(`[robokassa] Sent invite link to user ${subscriberData.telegram_user_id}`);
            } else {
              console.error("[robokassa] Failed to create invite link:", inviteResult.description);
            }
            } // end of "else no valid invite" block
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
    
    // Log webhook exception
    try {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );
      await supabaseAdmin.from("system_logs").insert({
        level: "error",
        event_type: "payment.webhook_error",
        source: "robokassa",
        message: "Webhook processing exception",
        payload: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    } catch (logError) {
      console.warn("Failed to log webhook exception:", logError);
    }
    
    return new Response("error", { status: 500 });
  }
});
