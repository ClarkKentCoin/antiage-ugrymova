import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveTenantIdFromSlug, resolveTenantFromRequest, DEFAULT_TENANT_ID } from "../_shared/tenant.ts";
import { validateTelegramInitData } from "../_shared/telegramInitData.ts";

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
    const body = await req.json();
    const { subscriber_id, tier_id, is_recurring, ip_address, user_agent, telegram_user_id, telegram_username, first_name, last_name, tenant_slug } = body;
    // Accept both snake_case (init_data) and camelCase (initData) from clients
    const init_data: string = (body.init_data ?? body.initData ?? "") as string;

    console.log("Request received:", { subscriber_id, tier_id, is_recurring, telegram_user_id, telegram_username, first_name, last_name, tenant_slug, hasInitData: !!init_data, initDataLength: init_data?.length ?? 0 });

    if (!tier_id) {
      return new Response(
        JSON.stringify({ error: "tier_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve tenant:
    // - Explicit slug provided → resolve, reject if invalid
    // - No slug + admin auth → resolve from auth (admin's own tenant)
    // - No slug + no auth → default production tenant
    let tenantId: string;
    if (tenant_slug) {
      const resolved = await resolveTenantIdFromSlug(supabaseAdmin, tenant_slug);
      if (resolved.source === "default") {
        return new Response(
          JSON.stringify({ error: "invalid_tenant" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      tenantId = resolved.tenantId;
    } else {
      // For admin requests, resolve from auth header; for MiniApp without slug, use default
      const resolved = await resolveTenantFromRequest({
        req,
        supabaseAdmin,
        body: {}, // no slug to resolve from body
      });
      tenantId = resolved.tenantId;
    }
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

    // If not admin, require telegram_user_id AND validated init_data
    if (!isAdmin) {
      if (!telegram_user_id || !init_data) {
        console.log("Non-admin request missing telegram_user_id or init_data", { hasTelegramUserId: !!telegram_user_id, hasInitData: !!init_data, initDataLength: init_data?.length ?? 0 });
        return new Response(
          JSON.stringify({ error: "telegram_user_id and init_data are required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Load bot token for this tenant
      const { data: settingsForBot } = await supabaseAdmin
        .from("admin_settings")
        .select("telegram_bot_token")
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (!settingsForBot?.telegram_bot_token) {
        return new Response(
          JSON.stringify({ error: "telegram_bot_not_configured" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const validation = await validateTelegramInitData(init_data, settingsForBot.telegram_bot_token);
      if (!validation.ok) {
        console.log("init_data validation failed:", validation.reason);
        return new Response(
          JSON.stringify({ error: "invalid_init_data", reason: validation.reason }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (validation.telegramUserId !== Number(telegram_user_id)) {
        console.log("user_id_mismatch", { validated: validation.telegramUserId, requested: telegram_user_id });
        return new Response(
          JSON.stringify({ error: "user_id_mismatch" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const validatedTelegramUserId = validation.telegramUserId!;
      const validatedUsername = validation.telegramUsername || null;
      const validatedFirstName = validation.telegramFirstName || null;
      const validatedLastName = validation.telegramLastName || null;

      console.log(`Validated Telegram user request: ${validatedTelegramUserId}`);

      // Find subscriber strictly by validated identity
      let { data: subscriber, error: subError } = await supabaseAdmin
        .from("subscribers")
        .select("id, telegram_username, first_name, last_name")
        .eq("telegram_user_id", validatedTelegramUserId)
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
        // Optional fallback for missing identity from init_data
        let tgUsername = validatedUsername;
        let tgFirstName = validatedFirstName;
        let tgLastName = validatedLastName;

        if ((!tgUsername || !tgFirstName) && settingsForBot.telegram_bot_token) {
          try {
            const telegramResponse = await fetch(
              `https://api.telegram.org/bot${settingsForBot.telegram_bot_token}/getChat?chat_id=${validatedTelegramUserId}`
            );
            const telegramData = await telegramResponse.json();
            if (telegramData.ok && telegramData.result) {
              tgUsername = tgUsername || telegramData.result.username || null;
              tgFirstName = tgFirstName || telegramData.result.first_name || null;
              tgLastName = tgLastName || telegramData.result.last_name || null;
            }
          } catch (tgError) {
            console.error("Failed to fetch user info from Telegram:", tgError);
          }
        }

        const { data: newSubscriber, error: createError } = await supabaseAdmin
          .from("subscribers")
          .insert({
            telegram_user_id: validatedTelegramUserId,
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

        subscriber = { id: newSubscriber.id, telegram_username: tgUsername, first_name: tgFirstName, last_name: tgLastName } as any;
        console.log(`Created new subscriber: ${subscriber!.id} for telegram_user_id: ${validatedTelegramUserId}, tenant_id: ${tenantId}`);
      } else {
        // Refresh non-empty identity fields only
        const upd: Record<string, any> = {};
        if (validatedUsername && !subscriber.telegram_username) upd.telegram_username = validatedUsername;
        if (validatedFirstName && !subscriber.first_name) upd.first_name = validatedFirstName;
        if (validatedLastName && !subscriber.last_name) upd.last_name = validatedLastName;
        if (Object.keys(upd).length > 0) {
          await supabaseAdmin.from("subscribers").update(upd).eq("id", subscriber.id);
        }
      }

      resolvedSubscriberId = subscriber!.id;
    }

    if (!resolvedSubscriberId) {
      return new Response(
        JSON.stringify({ error: "subscriber_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Backfill chat_threads with resolved subscriber and identity when missing.
    // Safe: tenant-scoped; never overwrites non-empty identity fields.
    try {
      const { data: subForChat } = await supabaseAdmin
        .from("subscribers")
        .select("first_name, last_name, telegram_username, telegram_user_id")
        .eq("id", resolvedSubscriberId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (subForChat?.telegram_user_id) {
        const { data: threadsToBackfill } = await supabaseAdmin
          .from("chat_threads")
          .select("id, subscriber_id, telegram_first_name, telegram_last_name, telegram_username")
          .eq("tenant_id", tenantId)
          .eq("telegram_user_id", subForChat.telegram_user_id);

        for (const t of threadsToBackfill ?? []) {
          const upd: Record<string, any> = {};
          if (!t.subscriber_id) upd.subscriber_id = resolvedSubscriberId;
          if (!t.telegram_first_name && subForChat.first_name) upd.telegram_first_name = subForChat.first_name;
          if (!t.telegram_last_name && subForChat.last_name) upd.telegram_last_name = subForChat.last_name;
          if (!t.telegram_username && subForChat.telegram_username) upd.telegram_username = subForChat.telegram_username;
          if (Object.keys(upd).length > 0) {
            upd.updated_at = new Date().toISOString();
            await supabaseAdmin.from("chat_threads").update(upd).eq("id", t.id);
          }
        }
      }
    } catch (backfillErr) {
      console.warn("[create-robokassa-payment] chat_threads backfill warning:", backfillErr);
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

    // Verify subscriber exists and belongs to this tenant
    const { data: subscriber, error: subscriberError } = await supabaseAdmin
      .from("subscribers")
      .select("id, telegram_user_id, telegram_username")
      .eq("id", resolvedSubscriberId)
      .eq("tenant_id", tenantId)
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
