import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import md5 from "https://esm.sh/md5@2.3.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Robokassa signatures: SignatureValue is MD5 (Password#1)
function robokassaSignature(message: string): string {
  return String(md5(message)).toUpperCase();
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
    const { subscriber_id, tier_id, is_recurring, ip_address, user_agent, telegram_user_id, telegram_username, first_name, last_name } = await req.json();

    console.log("Request received:", { subscriber_id, tier_id, is_recurring, telegram_user_id, telegram_username, first_name, last_name });

    if (!tier_id) {
      return new Response(
        JSON.stringify({ error: "tier_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

      // Find or create subscriber by telegram_user_id
      let { data: subscriber, error: subError } = await supabaseAdmin
        .from("subscribers")
        .select("id")
        .eq("telegram_user_id", telegram_user_id)
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
          .limit(1)
          .single();

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

        // Create new subscriber with user info
        const { data: newSubscriber, error: createError } = await supabaseAdmin
          .from("subscribers")
          .insert({
            telegram_user_id: telegram_user_id,
            telegram_username: tgUsername,
            first_name: tgFirstName,
            last_name: tgLastName,
            status: "inactive",
            tier_id: tier_id,
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
        console.log(`Created new subscriber: ${subscriber.id} for telegram_user_id: ${telegram_user_id} with username: ${tgUsername}`);
      }

      resolvedSubscriberId = subscriber.id;
    }

    if (!resolvedSubscriberId) {
      return new Response(
        JSON.stringify({ error: "subscriber_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get Robokassa settings
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("admin_settings")
      .select("robokassa_merchant_login, robokassa_password1, robokassa_test_mode")
      .limit(1)
      .single();

    if (settingsError || !settings?.robokassa_merchant_login || !settings?.robokassa_password1) {
      console.error("Settings error:", settingsError);
      return new Response(
        JSON.stringify({ error: "Robokassa not configured. Please set merchant login and password1 in settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get tier information
    const { data: tier, error: tierError } = await supabaseAdmin
      .from("subscription_tiers")
      .select("name, price")
      .eq("id", tier_id)
      .single();

    if (tierError || !tier) {
      console.error("Tier error:", tierError);
      return new Response(
        JSON.stringify({ error: "Subscription tier not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

    // If recurring, save consent
    if (is_recurring) {
      // Log consent
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
    }

    // Generate unique InvoiceID
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    const invoiceId = `${timestamp}${random}`;

    // Create payment record with pending status
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
      })
      .select()
      .single();

    if (paymentError) {
      console.error("Payment creation error:", paymentError);
      return new Response(
        JSON.stringify({ error: "Failed to create payment record", details: paymentError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Created payment record: ${payment.id}, invoice: ${invoiceId}`);

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

    const signature = robokassaSignature(signatureString);

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

    console.log(`Generated payment URL for subscriber ${resolvedSubscriberId}, telegram_user_id: ${shpTelegramUserId}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        payment_url: paymentUrl,
        invoice_id: invoiceId,
        amount: tier.price
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
