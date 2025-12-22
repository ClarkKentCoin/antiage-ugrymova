import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// MD5 hash function
async function md5(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("MD5", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

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
          price
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

    // Get Robokassa settings
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("admin_settings")
      .select("robokassa_merchant_login, robokassa_password1, robokassa_test_mode")
      .limit(1)
      .single();

    if (settingsError || !settings?.robokassa_merchant_login || !settings?.robokassa_password1) {
      console.error("Robokassa not configured:", settingsError);
      return new Response(
        JSON.stringify({ error: "Robokassa not configured" }),
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
        const signature = await md5(signatureString);

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

        // Check if response contains OK
        if (responseText.toUpperCase().includes("OK")) {
          // Update payment status
          await supabaseAdmin
            .from("payment_history")
            .update({ status: "processing" })
            .eq("id", payment.id);

          results.push({ 
            subscriber_id: subscription.id, 
            success: true, 
            message: "Recurring payment initiated" 
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
