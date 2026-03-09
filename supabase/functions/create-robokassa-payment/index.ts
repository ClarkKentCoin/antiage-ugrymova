import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveTenantIdFromSlug, resolveTenantFromRequest, DEFAULT_TENANT_ID } from "../_shared/tenant.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Robokassa signatures: SignatureValue uses SHA256 (Password#1) when configured in merchant settings
async function robokassaSignature(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}


serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create Supabase client with service role for database operations
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Parse request body first to check source
    const { subscriber_id, tier_id, is_recurring, ip_address, user_agent, telegram_user_id, telegram_username, first_name, last_name, tenant_slug } = await req.json();

    console.log("Request received:", { subscriber_id, tier_id, is_recurring, telegram_user_id, telegram_username, first_name, last_name, tenant_slug });

    if (!tier_id) {
      return new Response(
        JSON.stringify({ error: "tier_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve tenant ID from slug (or use default)
    const tenantId = await resolveTenantId(supabaseAdmin, tenant_slug);
    console.log(`[create-robokassa-payment] Resolved tenant_id: ${tenantId} from slug: ${tenant_slug || 'null'}`);

    // Check if this is a request from Telegram mini app (has telegram_user_id) or from admin panel
    const authHeader = req.headers.get("Authorization");
    let isAdmin = false;
    let resolvedSubscriberId = subscriber_id;

    // If there's an auth header, verify admin access
    if (authHeader) {
      const supabaseUser = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        {
          global: {
            headers: { Authorization: authHeader },
          },
        }
      );

      const { data: { user } } = await supabaseUser.auth.getUser();
      
      if (user) {
        console.log(`Authenticated user: ${user.id}`);
        
        // Check if user has admin role
        const { data: roleData } = await supabaseAdmin
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .maybeSingle();

        isAdmin = !!roleData;
        if (isAdmin) {
          console.log(`Admin access verified for user: ${user.id}`);
        }
      }
    }

    // If not admin, require telegram_user_id for validation
    if (!isAdmin) {
      if (!telegram_user_id) {
        console.log("Non-admin request without telegram_user_id");
        return new Response(
          JSON.stringify({ error: "Unauthorized - telegram_user_id required for non-admin requests" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`Telegram user request: ${telegram_user_id}`);

      // Find or create subscriber by telegram_user_id for this tenant
      let { data: subscriber, error: subError } = await supabaseAdmin
        .from("subscribers")
        .select("id")
        .eq("telegram_user_id", telegram_user_id)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (subError) {
        console.error("Error finding subscriber:", subError);
        return new Response(
          JSON.stringify({ error: "Error finding subscriber" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!subscriber) {
        // Get admin settings to fetch telegram bot token
        const { data: settingsForBot } = await supabaseAdmin
          .from("admin_settings")
          .select("telegram_bot_token")
          .eq("tenant_id", tenantId)
          .maybeSingle();

        // Try to get user info from Telegram API
        let tgUsername = telegram_username || null;
        let tgFirstName = first_name || null;
        let tgLastName = last_name || null;

        if (settingsForBot?.telegram_bot_token) {
          try {
            const telegramResponse = await fetch(
              `https://api.telegram.org/bot${settingsForBot.telegram_bot_token}/getChat?chat_id=${telegram_user_id}`
            );
            const telegramData = await telegramResponse.json();
            
            if (telegramData.ok && telegramData.result) {
              tgUsername = telegramData.result.username || tgUsername;
              tgFirstName = telegramData.result.first_name || tgFirstName;
              tgLastName = telegramData.result.last_name || tgLastName;
              console.log(`Got user info from Telegram: @${tgUsername}, ${tgFirstName} ${tgLastName}`);
            }
          } catch (tgError) {
            console.error("Failed to fetch user info from Telegram:", tgError);
          }
        }

        // Create new subscriber with user info and tenant_id
        const { data: newSubscriber, error: createError } = await supabaseAdmin
          .from("subscribers")
          .insert({
            telegram_user_id: telegram_user_id,
            telegram_username: tgUsername,
            first_name: tgFirstName,
            last_name: tgLastName,
            status: "inactive",
            tier_id: tier_id,
            tenant_id: tenantId,
          })
          .select("id")
          .single();

        if (createError) {
          console.error("Error creating subscriber:", createError);
          return new Response(
            JSON.stringify({ error: "Error creating subscriber" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        subscriber = newSubscriber;
        console.log(`Created new subscriber: ${subscriber.id} for telegram_user_id: ${telegram_user_id} with username: ${tgUsername}, tenant_id: ${tenantId}`);
      }

      resolvedSubscriberId = subscriber.id;
    }

    if (!resolvedSubscriberId) {
      return new Response(
        JSON.stringify({ error: "subscriber_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get Robokassa settings for this tenant
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("admin_settings")
      .select("robokassa_merchant_login, robokassa_password1, robokassa_test_mode")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (settingsError || !settings?.robokassa_merchant_login || !settings?.robokassa_password1) {
      console.error("Settings error:", settingsError);
      return new Response(
        JSON.stringify({ error: "Robokassa not configured. Please set merchant login and password1 in settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get tier information for this tenant
    const { data: tier, error: tierError } = await supabaseAdmin
      .from("subscription_tiers")
      .select("name, price, purchase_once_only")
      .eq("id", tier_id)
      .eq("tenant_id", tenantId)
      .single();

    if (tierError || !tier) {
      console.error("Tier error:", tierError);
      return new Response(
        JSON.stringify({ error: "Subscription tier not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Block auto-renewal for purchase_once_only tiers
    if (tier.purchase_once_only && is_recurring) {
      console.log(`[create-robokassa-payment] Rejected is_recurring=true for purchase_once_only tier ${tier_id}`);
      return new Response(
        JSON.stringify({
          error: "tier_no_recurring",
          message: "Автопродление недоступно для этого тарифа.",
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify subscriber exists
    const { data: subscriber, error: subscriberError } = await supabaseAdmin
      .from("subscribers")
      .select("id, telegram_user_id, telegram_username")
      .eq("id", resolvedSubscriberId)
      .single();

    if (subscriberError || !subscriber) {
      console.error("Subscriber error:", subscriberError);
      return new Response(
        JSON.stringify({ error: "Subscriber not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Enforce purchase_once_only: check if subscriber already has a completed payment for this tier
    if (tier.purchase_once_only) {
      const { data: existingPayments, error: checkError } = await supabaseAdmin
        .from("payment_history")
        .select("id")
        .eq("subscriber_id", resolvedSubscriberId)
        .eq("tier_id", tier_id)
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .limit(1);

      if (checkError) {
        console.error("Error checking purchase_once_only:", checkError);
      }

      if (existingPayments && existingPayments.length > 0) {
        console.log(`[create-robokassa-payment] Rejected: subscriber ${resolvedSubscriberId} already purchased once-only tier ${tier_id}`);
        return new Response(
          JSON.stringify({
            error: "tier_already_purchased_once",
            message: "Этот тариф можно купить только один раз. Пожалуйста, выберите другой тариф.",
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Update auto_renewal based on payment type
    if (is_recurring) {
      // Log consent for recurring payments
      const { error: consentError } = await supabaseAdmin
        .from("subscription_consent_log")
        .insert({
          subscriber_id: resolvedSubscriberId,
          consent_type: "auto_renewal_enabled",
          ip_address: ip_address || null,
          user_agent: user_agent || null,
        });

      if (consentError) {
        console.error("Failed to log consent:", consentError);
      } else {
        console.log(`Logged auto_renewal consent for subscriber ${resolvedSubscriberId}`);
      }

      // Update subscriber with consent date and auto_renewal flag
      const { error: updateError } = await supabaseAdmin
        .from("subscribers")
        .update({
          auto_renewal: true,
          auto_renewal_consent_date: new Date().toISOString(),
          next_payment_notification_sent: false,
        })
        .eq("id", resolvedSubscriberId);

      if (updateError) {
        console.error("Failed to update subscriber consent date:", updateError);
      }
    } else {
      // For single payments, explicitly disable auto_renewal
      const { error: updateError } = await supabaseAdmin
        .from("subscribers")
        .update({
          auto_renewal: false,
        })
        .eq("id", resolvedSubscriberId);

      if (updateError) {
        console.error("Failed to disable auto_renewal for single payment:", updateError);
      } else {
        console.log(`Disabled auto_renewal for single payment: subscriber ${resolvedSubscriberId}`);
      }
    }

    // Generate unique InvoiceID
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    const invoiceId = `${timestamp}${random}`;

    // Create payment record with pending status and tenant_id
    const { data: payment, error: paymentError } = await supabaseAdmin
      .from("payment_history")
      .insert({
        subscriber_id: resolvedSubscriberId,
        tier_id,
        amount: tier.price,
        invoice_id: invoiceId,
        transaction_type: is_recurring ? "initial" : "initial",
        payment_method: is_recurring ? "robokassa_recurring" : "robokassa_single",
        status: "pending",
        tenant_id: tenantId,
      })
      .select()
      .single();

    if (paymentError) {
      console.error("Payment creation error:", paymentError);
      // Log payment creation error
      await supabaseAdmin.from("system_logs").insert({
        level: "error",
        event_type: "payment.creation_error",
        source: "robokassa",
        subscriber_id: resolvedSubscriberId,
        telegram_user_id: subscriber.telegram_user_id,
        tier_id,
        tenant_id: tenantId,
        message: "Failed to create payment record",
        payload: { error: paymentError.message },
      });

      return new Response(
        JSON.stringify({ error: "Failed to create payment record", details: paymentError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Created payment record: ${payment.id}, invoice: ${invoiceId}`);

    // Log successful payment creation
    try {
      await supabaseAdmin.from("system_logs").insert({
        level: "info",
        event_type: "payment.created",
        source: "robokassa",
        subscriber_id: resolvedSubscriberId,
        telegram_user_id: subscriber.telegram_user_id,
        tier_id,
        request_id: payment.id,
        tenant_id: tenantId,
        message: "Payment attempt created",
        payload: {
          payment_id: payment.id,
          invoice_id: invoiceId,
          amount: tier.price,
          payment_method: is_recurring ? "robokassa_recurring" : "robokassa_single",
          status: "pending",
          tier_name: tier.name,
          is_recurring: !!is_recurring,
          is_test_mode: settings.robokassa_test_mode,
        },
      });
    } catch (logError) {
      console.warn("Failed to log payment.created event:", logError);
    }

    // Build Receipt for fiscalization
    const receipt = {
      sno: "osn",
      items: [{
        name: tier.name,
        quantity: 1,
        sum: Number(tier.price),
        payment_method: "full_payment",
        payment_object: "service",
        tax: "none",
      }],
    };

    const receiptJson = JSON.stringify(receipt);

    // IMPORTANT (Robokassa docs):
    // - For SignatureValue calculation you must use URL-encoded Receipt (once).
    // - For GET requests, if the value contains non-latin symbols, it must be URL-encoded *again* when forming the URL.
    //   (In our case Receipt contains tier.name, which is often in Russian.)
    const receiptEncodedForSignature = encodeURIComponent(receiptJson);
    const receiptEncodedForUrl = encodeURIComponent(receiptEncodedForSignature);

    // Robokassa parameters
    const merchantLogin = settings.robokassa_merchant_login;
    const outSum = Number(tier.price).toFixed(2);
    const description = encodeURIComponent(tier.name);
    const password1 = settings.robokassa_password1;
    const isTest = settings.robokassa_test_mode ? 1 : 0;

    // Shp parameters in alphabetical order
    const shpSource = "telegram";
    const shpSubscriberId = resolvedSubscriberId;
    const shpTelegramUserId = subscriber.telegram_user_id.toString();

    // Build signature string
    // Format: MerchantLogin:OutSum:InvId:Receipt:Password1:Shp_xxx=yyy...
    // Receipt here must be encoded ONCE (same as docs example for SignatureValue base).
    const signatureString = `${merchantLogin}:${outSum}:${invoiceId}:${receiptEncodedForSignature}:${password1}:Shp_source=${shpSource}:Shp_subscriber_id=${shpSubscriberId}:Shp_telegram_user_id=${shpTelegramUserId}`;

    console.log(
      "Signature string (without password):",
      signatureString.replace(password1, "***")
    );

    const signature = await robokassaSignature(signatureString);

    // Build payment URL (Robokassa expects InvId param name)
    let paymentUrl = `https://auth.robokassa.ru/Merchant/Index.aspx`;
    paymentUrl += `?MerchantLogin=${encodeURIComponent(merchantLogin)}`;
    paymentUrl += `&OutSum=${outSum}`;
    paymentUrl += `&InvId=${invoiceId}`;
    paymentUrl += `&Description=${description}`;
    paymentUrl += `&SignatureValue=${signature}`;
    paymentUrl += `&Receipt=${receiptEncodedForUrl}`;

    if (is_recurring) {
      paymentUrl += `&Recurring=true`;
    }

    if (isTest) {
      paymentUrl += `&IsTest=1`;
    }

    paymentUrl += `&Shp_source=${shpSource}`;
    paymentUrl += `&Shp_subscriber_id=${shpSubscriberId}`;
    paymentUrl += `&Shp_telegram_user_id=${shpTelegramUserId}`;

    console.log(`Generated payment URL for subscriber ${resolvedSubscriberId}, telegram_user_id: ${shpTelegramUserId}, tenant_id: ${tenantId}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        payment_url: paymentUrl,
        invoice_id: invoiceId,
        amount: tier.price,
        _debug: {
          tenant_id_used: tenantId,
          tenant_slug_used: tenant_slug || null,
        }
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
