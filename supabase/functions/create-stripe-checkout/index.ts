import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveTenantIdFromSlug, resolveTenantFromRequest } from "../_shared/tenant.ts";
import { validateTelegramInitData } from "../_shared/telegramInitData.ts";
import { getCanonicalAppBaseUrl } from "../_shared/appConfig.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const {
      subscriber_id,
      tier_id,
      telegram_user_id,
      tenant_slug,
      legal_acceptance,
    } = body ?? {};
    const init_data: string = (body?.init_data ?? body?.initData ?? "") as string;

    console.log("[create-stripe-checkout] request", {
      tier_id,
      telegram_user_id,
      tenant_slug,
      hasInitData: !!init_data,
      initDataLength: init_data?.length ?? 0,
      hasLegalAcceptance: !!legal_acceptance,
    });

    if (!tier_id) return json({ error: "tier_id is required" }, 400);

    // Validate legal acceptance early — required for Stripe checkout
    const la = (legal_acceptance ?? null) as Record<string, unknown> | null;
    if (!la || la.terms_accepted !== true || la.immediate_access_accepted !== true) {
      return json(
        { error: "legal_consent_required", message: "Legal consent is required before Stripe checkout." },
        400,
      );
    }
    const safeLegalAcceptance = {
      terms_accepted: true,
      immediate_access_accepted: true,
      accepted_at: typeof la.accepted_at === "string" ? la.accepted_at : new Date().toISOString(),
      terms_url: typeof la.terms_url === "string" ? la.terms_url : "https://club.ugrymova.ru/en/terms",
      subscription_terms_url: typeof la.subscription_terms_url === "string" ? la.subscription_terms_url : "https://club.ugrymova.ru/en/subscription-terms",
      privacy_policy_url: typeof la.privacy_policy_url === "string" ? la.privacy_policy_url : "https://club.ugrymova.ru/en/privacy-policy",
      refund_policy_url: typeof la.refund_policy_url === "string" ? la.refund_policy_url : "https://club.ugrymova.ru/en/refund-policy",
      legal_notice_url: typeof la.legal_notice_url === "string" ? la.legal_notice_url : "https://club.ugrymova.ru/en/legal-notice",
      international_payments_url: typeof la.international_payments_url === "string" ? la.international_payments_url : "https://club.ugrymova.ru/en/international-payments",
    };

    // Resolve tenant strictly
    let tenantId: string;
    let resolvedTenantSlug: string | null = null;
    if (tenant_slug) {
      const resolved = await resolveTenantIdFromSlug(supabaseAdmin, tenant_slug);
      if (resolved.source === "default") return json({ error: "invalid_tenant" }, 400);
      tenantId = resolved.tenantId;
      resolvedTenantSlug = resolved.tenantSlug;
    } else {
      const resolved = await resolveTenantFromRequest({ req, supabaseAdmin, body: {} });
      tenantId = resolved.tenantId;
      resolvedTenantSlug = resolved.tenantSlug;
    }

    // Admin detection
    const authHeader = req.headers.get("Authorization");
    let isAdmin = false;
    let adminUserId: string | null = null;
    let resolvedSubscriberId: string | undefined = subscriber_id;

    if (authHeader) {
      const supabaseUser = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user } } = await supabaseUser.auth.getUser();
      if (user) {
        const { data: roleData } = await supabaseAdmin
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .maybeSingle();
        isAdmin = !!roleData;
        if (isAdmin) adminUserId = user.id;
      }
    }

    // Admin tenant ownership check: admin can only act on their own tenant
    if (isAdmin && adminUserId) {
      const { data: tenantRow } = await supabaseAdmin
        .from("tenants")
        .select("id, owner_id")
        .eq("id", tenantId)
        .maybeSingle();
      if (!tenantRow || tenantRow.owner_id !== adminUserId) {
        return json({ error: "forbidden_tenant" }, 403);
      }
    }


    // Non-admin: require validated init_data
    if (!isAdmin) {
      if (!telegram_user_id || !init_data) {
        return json({ error: "telegram_user_id and init_data are required" }, 401);
      }

      const { data: settingsForBot } = await supabaseAdmin
        .from("admin_settings")
        .select("telegram_bot_token")
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (!settingsForBot?.telegram_bot_token) {
        return json({ error: "telegram_bot_not_configured" }, 400);
      }

      const validation = await validateTelegramInitData(init_data, settingsForBot.telegram_bot_token);
      if (!validation.ok) {
        return json({ error: "invalid_init_data", reason: validation.reason }, 401);
      }
      if (validation.telegramUserId !== Number(telegram_user_id)) {
        return json({ error: "user_id_mismatch" }, 401);
      }

      const vId = validation.telegramUserId!;
      const vUsername = validation.telegramUsername || null;
      const vFirst = validation.telegramFirstName || null;
      const vLast = validation.telegramLastName || null;

      let { data: subscriber } = await supabaseAdmin
        .from("subscribers")
        .select("id, telegram_username, first_name, last_name")
        .eq("telegram_user_id", vId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (!subscriber) {
        let tgUsername = vUsername;
        let tgFirst = vFirst;
        let tgLast = vLast;
        if ((!tgUsername || !tgFirst) && settingsForBot.telegram_bot_token) {
          try {
            const r = await fetch(
              `https://api.telegram.org/bot${settingsForBot.telegram_bot_token}/getChat?chat_id=${vId}`,
            );
            const d = await r.json();
            if (d.ok && d.result) {
              tgUsername = tgUsername || d.result.username || null;
              tgFirst = tgFirst || d.result.first_name || null;
              tgLast = tgLast || d.result.last_name || null;
            }
          } catch (e) {
            console.warn("[create-stripe-checkout] tg getChat warn:", e);
          }
        }

        const { data: newSub, error: createError } = await supabaseAdmin
          .from("subscribers")
          .insert({
            telegram_user_id: vId,
            telegram_username: tgUsername,
            first_name: tgFirst,
            last_name: tgLast,
            status: "inactive",
            tier_id,
            tenant_id: tenantId,
          })
          .select("id")
          .single();
        if (createError) {
          console.error("[create-stripe-checkout] create subscriber error:", createError);
          return json({ error: "Error creating subscriber" }, 500);
        }
        subscriber = { id: newSub.id, telegram_username: tgUsername, first_name: tgFirst, last_name: tgLast } as any;
      } else {
        const upd: Record<string, any> = {};
        if (vUsername && !subscriber.telegram_username) upd.telegram_username = vUsername;
        if (vFirst && !subscriber.first_name) upd.first_name = vFirst;
        if (vLast && !subscriber.last_name) upd.last_name = vLast;
        if (Object.keys(upd).length > 0) {
          await supabaseAdmin.from("subscribers").update(upd).eq("id", subscriber.id);
        }
      }

      resolvedSubscriberId = subscriber!.id;

      // chat_threads backfill (safe, tenant-scoped)
      try {
        const { data: subForChat } = await supabaseAdmin
          .from("subscribers")
          .select("first_name, last_name, telegram_username, telegram_user_id")
          .eq("id", resolvedSubscriberId)
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (subForChat?.telegram_user_id) {
          const { data: threads } = await supabaseAdmin
            .from("chat_threads")
            .select("id, subscriber_id, telegram_first_name, telegram_last_name, telegram_username")
            .eq("tenant_id", tenantId)
            .eq("telegram_user_id", subForChat.telegram_user_id);
          for (const t of threads ?? []) {
            const u: Record<string, any> = {};
            if (!t.subscriber_id) u.subscriber_id = resolvedSubscriberId;
            if (!t.telegram_first_name && subForChat.first_name) u.telegram_first_name = subForChat.first_name;
            if (!t.telegram_last_name && subForChat.last_name) u.telegram_last_name = subForChat.last_name;
            if (!t.telegram_username && subForChat.telegram_username) u.telegram_username = subForChat.telegram_username;
            if (Object.keys(u).length > 0) {
              u.updated_at = new Date().toISOString();
              await supabaseAdmin.from("chat_threads").update(u).eq("id", t.id);
            }
          }
        }
      } catch (e) {
        console.warn("[create-stripe-checkout] backfill warn:", e);
      }
    }

    if (!resolvedSubscriberId) return json({ error: "subscriber_id is required" }, 400);

    // Verify subscriber & tier in tenant
    const { data: subscriber, error: subErr } = await supabaseAdmin
      .from("subscribers")
      .select("id, telegram_user_id, telegram_username, email")
      .eq("id", resolvedSubscriberId)
      .eq("tenant_id", tenantId)
      .single();
    if (subErr || !subscriber) return json({ error: "Subscriber not found" }, 404);

    const { data: tier, error: tierErr } = await supabaseAdmin
      .from("subscription_tiers")
      .select("id, name, description, price, purchase_once_only, is_active, stripe_enabled, stripe_price, stripe_currency")
      .eq("id", tier_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (tierErr || !tier) return json({ error: "Subscription tier not found" }, 404);
    if (!tier.is_active) return json({ error: "tier_inactive" }, 400);

    if (tier.stripe_enabled !== true) {
      return json({ error: "stripe_tier_not_enabled", message: "Stripe is not enabled for this tariff." }, 400);
    }
    const stripeAmount = Number(tier.stripe_price);
    if (!Number.isFinite(stripeAmount) || stripeAmount <= 0) {
      return json({ error: "invalid_stripe_tier_price", message: "Stripe price is not configured for this tariff." }, 400);
    }
    if (!tier.stripe_currency || !String(tier.stripe_currency).trim()) {
      return json({ error: "invalid_stripe_currency", message: "Stripe currency is not configured for this tariff." }, 400);
    }

    // purchase_once_only check
    if (tier.purchase_once_only) {
      const { data: existing } = await supabaseAdmin
        .from("payment_history")
        .select("id")
        .eq("subscriber_id", resolvedSubscriberId)
        .eq("tier_id", tier_id)
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .limit(1);
      if (existing && existing.length > 0) {
        return json(
          { error: "tier_already_purchased_once", message: "Этот тариф можно купить только один раз." },
          409,
        );
      }
    }

    // Load Stripe provider config
    const { data: provider, error: providerErr } = await supabaseAdmin
      .from("tenant_payment_providers")
      .select("is_enabled, mode, public_config")
      .eq("tenant_id", tenantId)
      .eq("provider_code", "stripe")
      .maybeSingle();
    if (providerErr || !provider) return json({ error: "stripe_not_configured" }, 400);
    if (!provider.is_enabled) return json({ error: "stripe_disabled" }, 400);

    const pubConfig = (provider.public_config ?? {}) as Record<string, unknown>;
    if (!pubConfig.publishable_key || !pubConfig.has_secret_key) {
      return json({ error: "stripe_not_configured" }, 400);
    }

    // Currency: from tier.stripe_currency
    const currencyUpper = String(tier.stripe_currency || "EUR").toUpperCase();
    const currencyLower = currencyUpper.toLowerCase();

    // Load Stripe secret via RPC
    const { data: secretData, error: secretErr } = await supabaseAdmin.rpc(
      "get_tenant_payment_provider_secret",
      { p_tenant_id: tenantId, p_provider_code: "stripe" },
    );
    if (secretErr || !secretData) {
      console.error("[create-stripe-checkout] secret RPC error:", secretErr?.message);
      return json({ error: "stripe_not_configured" }, 400);
    }
    const stripeSecretKey = (secretData as any)?.stripe_secret_key as string | undefined;
    if (!stripeSecretKey) return json({ error: "stripe_not_configured" }, 400);

    // Build invoice id and Stripe price (separate from Robokassa/RUB price)
    const unitAmount = Math.round(stripeAmount * 100);

    const invoiceId = `stripe_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

    // Insert pending payment
    const { data: payment, error: paymentErr } = await supabaseAdmin
      .from("payment_history")
      .insert({
        subscriber_id: resolvedSubscriberId,
        tier_id,
        amount: stripeAmount,
        currency: currencyUpper,
        invoice_id: invoiceId,
        transaction_type: "initial",
        payment_method: "stripe_single",
        status: "pending",
        tenant_id: tenantId,
        stripe_data: {
          created_at: new Date().toISOString(),
          mode: provider.mode,
          legal_acceptance: safeLegalAcceptance,
        },
      })
      .select("id")
      .single();
    if (paymentErr || !payment) {
      console.error("[create-stripe-checkout] payment insert error:", paymentErr);
      await supabaseAdmin.from("system_logs").insert({
        level: "error",
        event_type: "payment.creation_error",
        source: "stripe",
        subscriber_id: resolvedSubscriberId,
        telegram_user_id: subscriber.telegram_user_id,
        tier_id,
        tenant_id: tenantId,
        message: "Failed to create stripe pending payment",
        payload: { error: paymentErr?.message },
      });
      return json({ error: "Error creating payment record" }, 500);
    }

    await supabaseAdmin.from("system_logs").insert({
      level: "info",
      event_type: "payment.created",
      source: "stripe",
      subscriber_id: resolvedSubscriberId,
      telegram_user_id: subscriber.telegram_user_id,
      tier_id,
      tenant_id: tenantId,
      message: "Stripe pending payment created",
      payload: { payment_id: payment.id, invoice_id: invoiceId, amount: stripeAmount, currency: currencyUpper, mode: provider.mode },
    });

    // Build URLs
    const baseUrl = getCanonicalAppBaseUrl();
    const tSlugParam = resolvedTenantSlug ? `&t=${encodeURIComponent(resolvedTenantSlug)}` : "";
    const successUrl = `${baseUrl}/telegram-app/payment-success?provider=stripe&session_id={CHECKOUT_SESSION_ID}${tSlugParam}`;
    const cancelUrl = `${baseUrl}/telegram-app/payment-cancel?provider=stripe${tSlugParam}`;

    // Channly app-level routing metadata (tenant-safe; product is NOT hardcoded globally).
    // service/delivery_platform/product_type are app identifiers shared across all Channly tenants.
    const SERVICE_ROUTING = {
      service: "channly",
      delivery_platform: "telegram",
      product_type: "telegram_channel_subscription",
      metadata_version: "1",
    } as const;

    // Optional per-tenant channel info (safe — never block checkout if missing)
    let channelName = "";
    let telegramChannelId = "";
    try {
      const { data: chSettings } = await supabaseAdmin
        .from("admin_settings")
        .select("telegram_channel_id, channel_name")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (chSettings) {
        if (chSettings.telegram_channel_id) telegramChannelId = String(chSettings.telegram_channel_id);
        if ((chSettings as any).channel_name) channelName = String((chSettings as any).channel_name);
      }
    } catch (e) {
      console.warn("[create-stripe-checkout] optional channel lookup warn:", e);
    }

    // Dynamic per-tenant product_name (fallbacks: channel_name → tenant_slug → generic)
    const productName =
      channelName
      || (resolvedTenantSlug ? resolvedTenantSlug : "")
      || "Telegram channel subscription";

    // Metadata used in both checkout session and payment_intent (all values must be strings)
    const metadata: Record<string, string> = {
      provider: "stripe",
      service: SERVICE_ROUTING.service,
      delivery_platform: SERVICE_ROUTING.delivery_platform,
      product_type: SERVICE_ROUTING.product_type,
      metadata_version: SERVICE_ROUTING.metadata_version,
      tenant_id: tenantId,
      tenant_slug: resolvedTenantSlug ?? "",
      subscriber_id: resolvedSubscriberId,
      telegram_user_id: subscriber.telegram_user_id ? String(subscriber.telegram_user_id) : "",
      tier_id: tier_id,
      tier_name: tier.name ? String(tier.name) : "",
      payment_id: payment.id,
      invoice_id: invoiceId,
      product_name: productName,
      legal_terms_accepted: "true",
      immediate_access_accepted: "true",
      terms_url: safeLegalAcceptance.terms_url,
      refund_policy_url: safeLegalAcceptance.refund_policy_url,
      subscription_terms_url: safeLegalAcceptance.subscription_terms_url,
    };
    if (channelName) metadata.channel_name = channelName;
    if (telegramChannelId) metadata.telegram_channel_id = telegramChannelId;

    // Create Stripe Checkout Session via REST
    // NOTE: Stripe Dashboard should also be configured manually:
    //   - Public details: website / support info
    //   - Terms of Service URL
    //   - Privacy Policy URL
    //   - Refund Policy URL
    //   - Legal policies enabled in Checkout Settings
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("payment_method_types[0]", "card");
    form.set("success_url", successUrl);
    form.set("cancel_url", cancelUrl);
    form.set("client_reference_id", payment.id);
    form.set("locale", "auto");
    if (subscriber.email) form.set("customer_email", subscriber.email);

    form.set("line_items[0][quantity]", "1");
    form.set("line_items[0][price_data][currency]", currencyLower);
    form.set("line_items[0][price_data][unit_amount]", String(unitAmount));
    form.set("line_items[0][price_data][product_data][name]", String(tier.name));
    const desc = (tier.description && String(tier.description).trim())
      || "Telegram channel subscription";
    form.set("line_items[0][price_data][product_data][description]", desc);

    // Require Terms of Service acceptance on Stripe Checkout
    form.set("consent_collection[terms_of_service]", "required");
    form.set(
      "custom_text[terms_of_service_acceptance][message]",
      "I agree to the [Terms of Service](https://club.ugrymova.ru/en/terms), [Subscription Terms](https://club.ugrymova.ru/en/subscription-terms), [Privacy Policy](https://club.ugrymova.ru/en/privacy-policy), and [Refund Policy](https://club.ugrymova.ru/en/refund-policy). I request immediate access to the digital Telegram club after payment confirmation.",
    );
    form.set(
      "custom_text[submit][message]",
      "After payment confirmation, access is provided through the Telegram bot / Mini App. Please review the refund and subscription terms before paying.",
    );

    for (const [k, v] of Object.entries(metadata)) {
      form.set(`metadata[${k}]`, v);
      form.set(`payment_intent_data[metadata][${k}]`, v);
    }

    const stripeResp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const stripeBody = await stripeResp.json().catch(() => ({}));

    if (!stripeResp.ok) {
      console.error("[create-stripe-checkout] Stripe error:", stripeResp.status, stripeBody?.error?.message);
      await supabaseAdmin.from("payment_history").update({ status: "failed" }).eq("id", payment.id);
      await supabaseAdmin.from("system_logs").insert({
        level: "error",
        event_type: "payment.checkout_error",
        source: "stripe",
        subscriber_id: resolvedSubscriberId,
        telegram_user_id: subscriber.telegram_user_id,
        tier_id,
        tenant_id: tenantId,
        message: "Stripe Checkout Session creation failed",
        payload: {
          status: stripeResp.status,
          stripe_error_code: stripeBody?.error?.code ?? null,
          stripe_error_type: stripeBody?.error?.type ?? null,
          stripe_error_message: stripeBody?.error?.message ?? null,
        },
      });
      return json({ error: "stripe_checkout_failed", message: stripeBody?.error?.message ?? "unknown" }, 502);
    }

    const session = stripeBody as {
      id: string;
      url: string;
      status?: string;
      payment_status?: string;
      payment_intent?: string | null;
      customer?: string | null;
      livemode?: boolean;
    };

    // Update payment_history with stripe identifiers
    await supabaseAdmin
      .from("payment_history")
      .update({
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: session.payment_intent ?? null,
        stripe_customer_id: session.customer ?? null,
        stripe_data: {
          checkout_session_id: session.id,
          payment_intent_id: session.payment_intent ?? null,
          customer_id: session.customer ?? null,
          payment_status: session.payment_status ?? null,
          session_status: session.status ?? null,
          url_created: true,
          livemode: Boolean(session.livemode),
          created_at: new Date().toISOString(),
          mode: provider.mode,
          legal_acceptance: safeLegalAcceptance,
          service_routing: {
            service: SERVICE_ROUTING.service,
            delivery_platform: SERVICE_ROUTING.delivery_platform,
            product: SERVICE_ROUTING.product,
            metadata_version: 1,
            tenant_id: tenantId,
            subscriber_id: resolvedSubscriberId,
            tier_id,
            payment_id: payment.id,
            telegram_user_id: subscriber.telegram_user_id ? String(subscriber.telegram_user_id) : null,
            channel_name: channelName || null,
            telegram_channel_id: telegramChannelId || null,
          },
        },
      })
      .eq("id", payment.id);

    // Insert into stripe_checkout_sessions
    const { error: scsErr } = await supabaseAdmin
      .from("stripe_checkout_sessions")
      .insert({
        tenant_id: tenantId,
        subscriber_id: resolvedSubscriberId,
        tier_id,
        payment_id: payment.id,
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: session.payment_intent ?? null,
        stripe_customer_id: session.customer ?? null,
        mode: "payment",
        status: session.status ?? "open",
        amount: stripeAmount,
        currency: currencyUpper,
        success_url: successUrl,
        cancel_url: cancelUrl,
        livemode: Boolean(session.livemode),
        metadata,
      });
    if (scsErr) {
      console.error("[create-stripe-checkout] stripe_checkout_sessions insert error:", scsErr);
      await supabaseAdmin
        .from("payment_history")
        .update({
          status: "failed",
          stripe_data: {
            checkout_session_id: session.id,
            payment_intent_id: session.payment_intent ?? null,
            customer_id: session.customer ?? null,
            payment_status: session.payment_status ?? null,
            session_status: session.status ?? null,
            url_created: true,
            livemode: Boolean(session.livemode),
            created_at: new Date().toISOString(),
            mode: provider.mode,
            legal_acceptance: safeLegalAcceptance,
            mapping_error: scsErr.message ?? "stripe_checkout_sessions insert failed",
          },
        })
        .eq("id", payment.id);
      await supabaseAdmin.from("system_logs").insert({
        level: "error",
        event_type: "payment.checkout_mapping_error",
        source: "stripe",
        subscriber_id: resolvedSubscriberId,
        telegram_user_id: subscriber.telegram_user_id,
        tier_id,
        tenant_id: tenantId,
        message: "Failed to insert stripe_checkout_sessions mapping",
        payload: {
          payment_id: payment.id,
          checkout_session_id: session.id,
          error: scsErr.message ?? null,
        },
      });
      return json({ error: "stripe_mapping_failed" }, 500);
    }


    await supabaseAdmin.from("system_logs").insert({
      level: "info",
      event_type: "payment.checkout_created",
      source: "stripe",
      subscriber_id: resolvedSubscriberId,
      telegram_user_id: subscriber.telegram_user_id,
      tier_id,
      tenant_id: tenantId,
      message: "Stripe Checkout Session created",
      payload: {
        payment_id: payment.id,
        checkout_session_id: session.id,
        livemode: Boolean(session.livemode),
        mode: provider.mode,
      },
    });

    return json({
      success: true,
      checkout_url: session.url,
      checkout_session_id: session.id,
      payment_id: payment.id,
      invoice_id: invoiceId,
      amount: stripeAmount,
      currency: currencyUpper,
    });
  } catch (err) {
    console.error("[create-stripe-checkout] Unhandled:", err);
    return json({ error: "internal_error" }, 500);
  }
});
