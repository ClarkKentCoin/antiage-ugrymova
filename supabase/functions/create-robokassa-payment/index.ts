import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";
import { encode } from "https://deno.land/std@0.168.0/encoding/hex.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// MD5 hash function using Deno std crypto
async function md5(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hash = await crypto.subtle.digest("MD5", data);
  const hexBytes = encode(new Uint8Array(hash));
  return new TextDecoder().decode(hexBytes);
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

    // Authentication check - require valid user session
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("No authorization header provided");
      return new Response(
        JSON.stringify({ error: "Unauthorized - No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create a client with the user's token to verify their identity
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    );

    // Verify the user's token
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    
    if (authError || !user) {
      console.error("Auth error:", authError?.message || "No user found");
      return new Response(
        JSON.stringify({ error: "Unauthorized - Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Authenticated user: ${user.id}`);

    // Check if user has admin role
    const { data: roleData, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (roleError) {
      console.error("Role check error:", roleError.message);
      return new Response(
        JSON.stringify({ error: "Error checking permissions" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!roleData) {
      console.error(`User ${user.id} does not have admin role`);
      return new Response(
        JSON.stringify({ error: "Forbidden - Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Admin access verified for user: ${user.id}`);

    // Parse request body
    const { subscriber_id, tier_id, is_recurring, ip_address, user_agent } = await req.json();

    if (!subscriber_id || !tier_id) {
      return new Response(
        JSON.stringify({ error: "subscriber_id and tier_id are required" }),
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

    // Get subscriber info
    const { data: subscriber, error: subscriberError } = await supabaseAdmin
      .from("subscribers")
      .select("telegram_user_id, telegram_username")
      .eq("id", subscriber_id)
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
          subscriber_id,
          consent_type: "auto_renewal_enabled",
          ip_address: ip_address || null,
          user_agent: user_agent || null,
        });

      if (consentError) {
        console.error("Failed to log consent:", consentError);
      } else {
        console.log(`Logged auto_renewal consent for subscriber ${subscriber_id}`);
      }

      // Update subscriber with consent date and auto_renewal flag
      const { error: updateError } = await supabaseAdmin
        .from("subscribers")
        .update({
          auto_renewal: true,
          auto_renewal_consent_date: new Date().toISOString(),
          next_payment_notification_sent: false,
        })
        .eq("id", subscriber_id);

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
        subscriber_id,
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
        JSON.stringify({ error: "Failed to create payment record" }),
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
        tax: "none"
      }]
    };

    const receiptJson = JSON.stringify(receipt);
    const receiptEncoded = encodeURIComponent(receiptJson);

    // Robokassa parameters
    const merchantLogin = settings.robokassa_merchant_login;
    const outSum = Number(tier.price).toFixed(2);
    const description = encodeURIComponent(tier.name);
    const password1 = settings.robokassa_password1;
    const isTest = settings.robokassa_test_mode ? 1 : 0;

    // Shp parameters in alphabetical order
    const shpSource = "telegram";
    const shpSubscriberId = subscriber_id;

    // Build signature string
    // Format: MerchantLogin:OutSum:InvoiceID:Receipt:Password1:Shp_source=value:Shp_subscriber_id=value
    const signatureString = `${merchantLogin}:${outSum}:${invoiceId}:${receiptJson}:${password1}:Shp_source=${shpSource}:Shp_subscriber_id=${shpSubscriberId}`;
    
    console.log("Signature string (without password):", signatureString.replace(password1, "***"));
    
    const signature = await md5(signatureString);

    // Build payment URL
    let paymentUrl = `https://auth.robokassa.ru/Merchant/Index.aspx`;
    paymentUrl += `?MerchantLogin=${encodeURIComponent(merchantLogin)}`;
    paymentUrl += `&OutSum=${outSum}`;
    paymentUrl += `&InvoiceID=${invoiceId}`;
    paymentUrl += `&Description=${description}`;
    paymentUrl += `&SignatureValue=${signature}`;
    paymentUrl += `&Receipt=${receiptEncoded}`;
    
    if (is_recurring) {
      paymentUrl += `&Recurring=true`;
    }
    
    if (isTest) {
      paymentUrl += `&IsTest=1`;
    }
    
    paymentUrl += `&Shp_source=${shpSource}`;
    paymentUrl += `&Shp_subscriber_id=${shpSubscriberId}`;

    console.log(`Generated payment URL for subscriber ${subscriber_id}`);

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
