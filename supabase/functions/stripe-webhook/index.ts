import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { DateTime } from "https://esm.sh/luxon@3.4.4";
import { sendAdminNotification } from "../_shared/adminNotifications.ts";
import { logUserNotification } from "../_shared/userNotificationLogger.ts";

// ---------- helpers ----------

function computeNextEndISO(
  nowISO: string,
  currentEndISO: string | null,
  unit: string,
  count: number,
  tz: string,
): string {
  const nowUTC = DateTime.fromISO(nowISO, { zone: "utc" });
  const currentEndUTC = currentEndISO ? DateTime.fromISO(currentEndISO, { zone: "utc" }) : null;
  const startFromUTC = (currentEndUTC && currentEndUTC > nowUTC) ? currentEndUTC : nowUTC;
  const startLocal = startFromUTC.setZone(tz);
  let endLocal: DateTime;
  switch (unit) {
    case "week": endLocal = startLocal.plus({ weeks: count }); break;
    case "month": endLocal = startLocal.plus({ months: count }); break;
    case "year": endLocal = startLocal.plus({ years: count }); break;
    case "day":
    default: endLocal = startLocal.plus({ days: count }); break;
  }
  return endLocal.toUTC().toISO()!;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const keyData = new TextEncoder().encode(key);
  const msgData = new TextEncoder().encode(message);
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface ParsedSigHeader {
  t: number | null;
  v1: string[];
}
function parseStripeSignatureHeader(header: string): ParsedSigHeader {
  const out: ParsedSigHeader = { t: null, v1: [] };
  for (const part of header.split(",")) {
    const [k, v] = part.split("=");
    if (!k || !v) continue;
    if (k.trim() === "t") {
      const n = parseInt(v.trim(), 10);
      if (!isNaN(n)) out.t = n;
    } else if (k.trim() === "v1") {
      out.v1.push(v.trim());
    }
  }
  return out;
}

async function verifyStripeSignature(
  rawBody: string,
  sigHeader: string,
  secret: string,
  toleranceSec = 300,
): Promise<{ ok: boolean; reason?: string }> {
  const parsed = parseStripeSignatureHeader(sigHeader);
  if (!parsed.t || parsed.v1.length === 0) return { ok: false, reason: "malformed_signature_header" };
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - parsed.t) > toleranceSec) return { ok: false, reason: "timestamp_out_of_tolerance" };
  const expected = await hmacSha256Hex(secret, `${parsed.t}.${rawBody}`);
  for (const sig of parsed.v1) {
    if (timingSafeEqualHex(expected, sig)) return { ok: true };
  }
  return { ok: false, reason: "no_matching_v1" };
}

async function safeLog(
  supabaseAdmin: ReturnType<typeof createClient>,
  row: Record<string, unknown>,
) {
  try { await supabaseAdmin.from("system_logs").insert(row); } catch (e) { console.warn("[stripe-webhook] log failed", e); }
}

// ---------- main ----------

serve(async (req) => {
  if (req.method === "GET") return new Response("OK", { status: 200 });
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // 1) read raw body exactly once
  const rawBody = await req.text();
  const sigHeader = req.headers.get("stripe-signature") || req.headers.get("Stripe-Signature") || "";

  // 2) Parse unverified JSON to resolve tenant/secret
  let unverifiedEvent: any = null;
  try { unverifiedEvent = JSON.parse(rawBody); } catch { /* noop */ }

  if (!unverifiedEvent || typeof unverifiedEvent !== "object") {
    await safeLog(supabaseAdmin, {
      level: "error", event_type: "payment.webhook_error", source: "stripe",
      message: "Invalid JSON body", payload: { has_signature: !!sigHeader },
    });
    return new Response("invalid_body", { status: 400 });
  }

  const eventId: string | undefined = unverifiedEvent.id;
  const eventType: string | undefined = unverifiedEvent.type;
  const eventLivemode: boolean = Boolean(unverifiedEvent.livemode);
  const dataObject: any = unverifiedEvent?.data?.object ?? {};
  const metadata: Record<string, string> = (dataObject.metadata ?? {}) as Record<string, string>;

  // Early foreign-service ignore (unverified — used only to skip, never to fulfill).
  // Backward compat: if metadata.service is missing, do not ignore.
  const unverifiedService = typeof metadata.service === "string" ? metadata.service.trim().toLowerCase() : "";
  if (unverifiedService && unverifiedService !== "channly") {
    await safeLog(supabaseAdmin, {
      level: "info", event_type: "payment.webhook_ignored_foreign_service", source: "stripe",
      message: "Ignored foreign-service Stripe event (pre-verify)",
      payload: {
        event_id: unverifiedEvent.id ?? null,
        event_type: unverifiedEvent.type ?? null,
        service: metadata.service ?? null,
        delivery_platform: metadata.delivery_platform ?? null,
        product: metadata.product ?? null,
      },
    });
    return new Response("ignored_foreign_service", { status: 200 });
  }


  // 3) Resolve tenant
  let tenantId: string | null = (metadata.tenant_id as string) || null;
  const metaPaymentId: string | null = (metadata.payment_id as string) || null;
  const sessionId: string | null = (dataObject.id && String(dataObject.id).startsWith("cs_") ? String(dataObject.id) : null);
  const paymentIntentId: string | null = (dataObject.id && String(dataObject.id).startsWith("pi_") ? String(dataObject.id) : (dataObject.payment_intent ?? null));

  if (!tenantId && metaPaymentId) {
    const { data: ph } = await supabaseAdmin
      .from("payment_history").select("tenant_id").eq("id", metaPaymentId).maybeSingle();
    if (ph?.tenant_id) tenantId = ph.tenant_id as string;
  }
  if (!tenantId && sessionId) {
    const { data: scs } = await supabaseAdmin
      .from("stripe_checkout_sessions").select("tenant_id")
      .eq("stripe_checkout_session_id", sessionId).maybeSingle();
    if (scs?.tenant_id) tenantId = scs.tenant_id as string;
  }
  if (!tenantId && paymentIntentId) {
    const { data: ph } = await supabaseAdmin
      .from("payment_history").select("tenant_id").eq("stripe_payment_intent_id", paymentIntentId).maybeSingle();
    if (ph?.tenant_id) tenantId = ph.tenant_id as string;
  }

  if (!tenantId) {
    await safeLog(supabaseAdmin, {
      level: "error", event_type: "payment.webhook_error", source: "stripe",
      message: "Unable to resolve tenant for webhook",
      payload: { event_id: eventId ?? null, event_type: eventType ?? null, has_signature: !!sigHeader },
    });
    return new Response("tenant_not_resolved", { status: 400 });
  }

  // 4) Load tenant's stripe webhook secret + provider mode (mode from tenant_payment_providers, not RPC)
  let webhookSecret: string | null = null;
  let providerMode: string | null = null;
  let providerEnabled: boolean = false;
  try {
    const { data: providerRow, error: providerErr } = await supabaseAdmin
      .from("tenant_payment_providers")
      .select("mode, is_enabled")
      .eq("tenant_id", tenantId)
      .eq("provider_code", "stripe")
      .maybeSingle();
    if (providerErr) throw providerErr;
    if (!providerRow) {
      await safeLog(supabaseAdmin, {
        level: "error", event_type: "payment.webhook_error", source: "stripe",
        tenant_id: tenantId, message: "Stripe provider not configured for tenant",
        payload: { event_id: eventId ?? null },
      });
      return new Response("provider_not_configured", { status: 400 });
    }
    providerMode = (providerRow.mode as string) ?? null;
    providerEnabled = Boolean(providerRow.is_enabled);
    if (!providerEnabled) {
      await safeLog(supabaseAdmin, {
        level: "error", event_type: "payment.webhook_error", source: "stripe",
        tenant_id: tenantId, message: "Stripe provider disabled for tenant",
        payload: { event_id: eventId ?? null, provider_mode: providerMode },
      });
      return new Response("provider_disabled", { status: 400 });
    }
  } catch (e) {
    await safeLog(supabaseAdmin, {
      level: "error", event_type: "payment.webhook_error", source: "stripe",
      tenant_id: tenantId, message: "Failed to load tenant_payment_providers",
      payload: { error: e instanceof Error ? e.message : String(e), event_id: eventId ?? null },
    });
    return new Response("provider_load_failed", { status: 400 });
  }

  try {
    const { data: secretData, error: secretErr } = await supabaseAdmin.rpc(
      "get_tenant_payment_provider_secret",
      { p_tenant_id: tenantId, p_provider_code: "stripe" },
    );
    if (secretErr || !secretData) throw secretErr ?? new Error("no_secret_data");
    webhookSecret = (secretData as any)?.stripe_webhook_secret ?? null;
  } catch (e) {
    await safeLog(supabaseAdmin, {
      level: "error", event_type: "payment.webhook_error", source: "stripe",
      tenant_id: tenantId,
      message: "Failed to load tenant stripe webhook secret",
      payload: { error: e instanceof Error ? e.message : String(e), event_id: eventId ?? null },
    });
    return new Response("secret_unavailable", { status: 400 });
  }
  if (!webhookSecret) {
    await safeLog(supabaseAdmin, {
      level: "error", event_type: "payment.webhook_error", source: "stripe",
      tenant_id: tenantId, message: "Webhook secret not configured", payload: { event_id: eventId ?? null },
    });
    return new Response("secret_missing", { status: 400 });
  }

  // 5) Verify signature on raw body
  if (!sigHeader) {
    await safeLog(supabaseAdmin, {
      level: "error", event_type: "payment.webhook_error", source: "stripe",
      tenant_id: tenantId, message: "Missing Stripe-Signature header", payload: { event_id: eventId ?? null },
    });
    return new Response("stripe_signature_verification_failed", { status: 400 });
  }
  const verifyResult = await verifyStripeSignature(rawBody, sigHeader, webhookSecret);
  if (!verifyResult.ok) {
    await safeLog(supabaseAdmin, {
      level: "error", event_type: "payment.webhook_error", source: "stripe",
      tenant_id: tenantId, message: "Stripe signature verification failed",
      payload: { event_id: eventId ?? null, reason: verifyResult.reason ?? null },
    });
    return new Response("stripe_signature_verification_failed", { status: 400 });
  }

  // Verified foreign-service ignore. Backward compat: missing service is processed normally.
  const verifiedService = typeof metadata.service === "string" ? metadata.service.trim().toLowerCase() : "";
  if (verifiedService && verifiedService !== "channly") {
    await safeLog(supabaseAdmin, {
      level: "info", event_type: "payment.webhook_ignored_foreign_service", source: "stripe",
      tenant_id: tenantId,
      message: "Ignored foreign-service Stripe event (post-verify)",
      payload: {
        event_id: eventId ?? null,
        event_type: eventType ?? null,
        service: metadata.service ?? null,
        delivery_platform: metadata.delivery_platform ?? null,
        product: metadata.product ?? null,
        stripe_checkout_session_id: sessionId,
        stripe_payment_intent_id: paymentIntentId,
      },
    });
    try {
      await supabaseAdmin.from("stripe_webhook_events").insert({
        tenant_id: tenantId,
        stripe_event_id: eventId,
        event_type: eventType,
        livemode: eventLivemode,
        api_version: unverifiedEvent.api_version ?? null,
        status: "ignored",
        raw_payload: unverifiedEvent,
        stripe_checkout_session_id: sessionId,
        stripe_payment_intent_id: paymentIntentId,
        error_message: "ignored_foreign_service",
        received_at: new Date().toISOString(),
        processed_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn("[stripe-webhook] foreign-service event insert warn:", e);
    }
    return new Response("ignored_foreign_service", { status: 200 });
  }


  // 6) Idempotency
  if (!eventId || !eventType) {
    return new Response("missing_event_metadata", { status: 400 });
  }

  // Check if already processed
  const { data: existingEvent } = await supabaseAdmin
    .from("stripe_webhook_events")
    .select("id, status, processed_at")
    .eq("stripe_event_id", eventId)
    .maybeSingle();

  if (existingEvent?.status === "processed" || existingEvent?.processed_at) {
    return new Response("duplicate_ignored", { status: 200 });
  }

  const metaSubscriberIdEarly: string | null = (metadata.subscriber_id as string) || null;
  const metaTierIdEarly: string | null = (metadata.tier_id as string) || null;

  // Insert (or upsert) webhook event row
  const baseEventRow: Record<string, unknown> = {
    tenant_id: tenantId,
    stripe_event_id: eventId,
    event_type: eventType,
    livemode: eventLivemode,
    api_version: unverifiedEvent.api_version ?? null,
    status: "received",
    raw_payload: unverifiedEvent,
    stripe_checkout_session_id: sessionId,
    stripe_payment_intent_id: paymentIntentId,
    stripe_customer_id: dataObject.customer ?? null,
    payment_id: metaPaymentId,
    subscriber_id: metaSubscriberIdEarly,
    tier_id: metaTierIdEarly,
    received_at: new Date().toISOString(),
  };
  if (!existingEvent) {
    const { error: insertEvErr } = await supabaseAdmin
      .from("stripe_webhook_events").insert(baseEventRow);
    if (insertEvErr) {
      console.warn("[stripe-webhook] insert webhook event failed:", insertEvErr.message);
    }
  }

  const markEvent = async (status: string, errorMessage?: string | null) => {
    try {
      await supabaseAdmin
        .from("stripe_webhook_events")
        .update({
          status,
          processed_at: new Date().toISOString(),
          error_message: errorMessage ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_event_id", eventId);
    } catch (e) {
      console.warn("[stripe-webhook] markEvent failed:", e);
    }
  };

  // ----- handlers -----
  try {
    if (eventType === "checkout.session.expired") {
      const payId = metaPaymentId;
      if (payId) {
        const { data: ph } = await supabaseAdmin
          .from("payment_history").select("id, status, stripe_data").eq("id", payId).eq("tenant_id", tenantId).maybeSingle();
        if (ph && ph.status === "pending") {
          const mergedStripe = { ...(ph.stripe_data as Record<string, unknown> ?? {}), expired_at: new Date().toISOString(), webhook_event_id: eventId };
          await supabaseAdmin.from("payment_history").update({ status: "failed", stripe_data: mergedStripe }).eq("id", payId);
        }
      }
      if (sessionId) {
        await supabaseAdmin.from("stripe_checkout_sessions")
          .update({ status: "expired", updated_at: new Date().toISOString() })
          .eq("stripe_checkout_session_id", sessionId);
      }
      await markEvent("processed");
      return new Response("ok_expired", { status: 200 });
    }

    if (eventType === "payment_intent.payment_failed") {
      let payRow: any = null;
      if (metaPaymentId) {
        const { data } = await supabaseAdmin.from("payment_history")
          .select("id, status, stripe_data").eq("id", metaPaymentId).eq("tenant_id", tenantId).maybeSingle();
        payRow = data;
      }
      if (!payRow && paymentIntentId) {
        const { data } = await supabaseAdmin.from("payment_history")
          .select("id, status, stripe_data").eq("stripe_payment_intent_id", paymentIntentId).eq("tenant_id", tenantId).maybeSingle();
        payRow = data;
      }
      if (payRow && payRow.status === "pending") {
        const lastError = dataObject?.last_payment_error ?? null;
        const mergedStripe = {
          ...(payRow.stripe_data as Record<string, unknown> ?? {}),
          webhook_event_id: eventId,
          failed_at: new Date().toISOString(),
          failure_code: lastError?.code ?? null,
          failure_type: lastError?.type ?? null,
          failure_message: lastError?.message ?? null,
        };
        await supabaseAdmin.from("payment_history")
          .update({ status: "failed", stripe_data: mergedStripe })
          .eq("id", payRow.id);
      }
      await markEvent("processed");
      return new Response("ok_failed", { status: 200 });
    }

    if (eventType !== "checkout.session.completed") {
      await markEvent("ignored");
      return new Response("ignored", { status: 200 });
    }

    // ---------- checkout.session.completed ----------
    const session = dataObject;

    // Business validation
    if (session.payment_status !== "paid") {
      await safeLog(supabaseAdmin, {
        level: "warn", event_type: "payment.webhook_error", source: "stripe", tenant_id: tenantId,
        message: "checkout.session.completed but payment_status not paid",
        payload: { event_id: eventId, payment_status: session.payment_status ?? null, session_status: session.status ?? null },
      });
      await markEvent("ignored", "payment_status_not_paid");
      return new Response("business_validation_failed", { status: 200 });
    }
    if (session.status !== "complete") {
      await safeLog(supabaseAdmin, {
        level: "warn", event_type: "payment.webhook_error", source: "stripe", tenant_id: tenantId,
        message: "checkout.session.completed but status not complete",
        payload: { event_id: eventId, session_status: session.status ?? null },
      });
      await markEvent("ignored", "session_status_not_complete");
      return new Response("business_validation_failed", { status: 200 });
    }
    const consentTos = session?.consent?.terms_of_service ?? null;
    if (consentTos !== "accepted") {
      await safeLog(supabaseAdmin, {
        level: "warn", event_type: "payment.webhook_error", source: "stripe", tenant_id: tenantId,
        message: "Terms of service not accepted on checkout session",
        payload: { event_id: eventId, consent_terms_of_service: consentTos },
      });
      await markEvent("ignored", "tos_not_accepted");
      return new Response("business_validation_failed", { status: 200 });
    }

    const paymentId = metaPaymentId;
    const metaTenantId = metadata.tenant_id;
    const metaSubscriberId = metadata.subscriber_id;
    const metaTierId = metadata.tier_id;
    if (!paymentId || !metaTenantId || !metaSubscriberId || !metaTierId) {
      await safeLog(supabaseAdmin, {
        level: "error", event_type: "payment.webhook_error", source: "stripe", tenant_id: tenantId,
        message: "Missing required metadata on checkout session",
        payload: { event_id: eventId, has_payment_id: !!paymentId, has_tenant_id: !!metaTenantId, has_subscriber_id: !!metaSubscriberId, has_tier_id: !!metaTierId },
      });
      await markEvent("ignored", "missing_metadata");
      return new Response("business_validation_failed", { status: 200 });
    }

    // Load payment + subscriber + tier
    const { data: payment, error: payErr } = await supabaseAdmin
      .from("payment_history")
      .select("*, subscribers(*), subscription_tiers(*)")
      .eq("id", paymentId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (payErr || !payment) {
      await safeLog(supabaseAdmin, {
        level: "error", event_type: "payment.webhook_error", source: "stripe", tenant_id: tenantId,
        message: "Payment not found for stripe checkout session",
        payload: { event_id: eventId, payment_id: paymentId, error: payErr?.message ?? null },
      });
      await markEvent("ignored", "payment_not_found");
      return new Response("payment_not_found", { status: 200 });
    }

    // If payment is in terminal non-completed state — abort
    if (payment.status === "failed" || payment.status === "cancelled") {
      await safeLog(supabaseAdmin, {
        level: "warn", event_type: "payment.webhook_error", source: "stripe", tenant_id: tenantId,
        message: "Payment already in terminal non-completed state",
        payload: { event_id: eventId, payment_id: paymentId, status: payment.status },
      });
      await markEvent("ignored", `payment_status_${payment.status}`);
      return new Response("payment_not_pending", { status: 200 });
    }

    const existingStripeData: Record<string, unknown> =
      (payment.stripe_data as Record<string, unknown>) ?? {};
    const hasActivationMarker = Boolean(
      existingStripeData.subscriber_activated_at &&
        (existingStripeData.computed_subscription_end || existingStripeData.subscription_end),
    );

    // Fully completed AND activated → safe to return already_completed
    if (payment.status === "completed" && hasActivationMarker) {
      await markEvent("processed", "already_completed");
      return new Response("already_completed", { status: 200 });
    }

    // Amount/currency validation — only when payment is still pending (already validated on prior run otherwise)
    if (payment.status !== "completed") {
      const expectedCents = Math.round(Number(payment.amount) * 100);
      const stripeCents = Number(session.amount_total);
      const amountMatch = expectedCents === stripeCents;
      const currencyMatch =
        String(payment.currency || "").toLowerCase() === String(session.currency || "").toLowerCase();
      if (!amountMatch || !currencyMatch) {
        const mergedStripe = {
          ...existingStripeData,
          webhook_event_id: eventId,
          amount_mismatch: !amountMatch,
          currency_mismatch: !currencyMatch,
          expected_amount_cents: expectedCents,
          stripe_amount_total: stripeCents,
          expected_currency: payment.currency,
          stripe_currency: session.currency,
          mismatch_at: new Date().toISOString(),
        };
        await supabaseAdmin.from("payment_history")
          .update({ status: "failed", stripe_data: mergedStripe }).eq("id", payment.id);
        await safeLog(supabaseAdmin, {
          level: "error", event_type: "payment.webhook_error", source: "stripe",
          subscriber_id: payment.subscriber_id, tier_id: payment.tier_id, tenant_id: tenantId,
          message: "Amount/currency mismatch with Stripe session",
          payload: { event_id: eventId, payment_id: payment.id, expected_amount_cents: expectedCents, stripe_amount_total: stripeCents, expected_currency: payment.currency, stripe_currency: session.currency },
        });
        await markEvent("ignored", "amount_or_currency_mismatch");
        return new Response("amount_mismatch", { status: 200 });
      }
    }

    // Livemode vs provider mode (always)
    if (providerMode === "test" && session.livemode === true) {
      await safeLog(supabaseAdmin, {
        level: "error", event_type: "payment.webhook_error", source: "stripe", tenant_id: tenantId,
        message: "Livemode mismatch: provider=test, event livemode",
        payload: { event_id: eventId, provider_mode: providerMode, livemode: session.livemode },
      });
      await markEvent("ignored", "mode_mismatch");
      return new Response("mode_mismatch", { status: 200 });
    }
    if (providerMode === "live" && session.livemode !== true) {
      await safeLog(supabaseAdmin, {
        level: "error", event_type: "payment.webhook_error", source: "stripe", tenant_id: tenantId,
        message: "Livemode mismatch: provider=live, event not livemode",
        payload: { event_id: eventId, provider_mode: providerMode, livemode: session.livemode },
      });
      await markEvent("ignored", "mode_mismatch");
      return new Response("mode_mismatch", { status: 200 });
    }

    // ---------- All validations passed: idempotent fulfillment ----------
    const subscriber = payment.subscribers as any;
    const tier = payment.subscription_tiers as any;
    if (!subscriber || !tier) {
      await safeLog(supabaseAdmin, {
        level: "error", event_type: "payment.webhook_error", source: "stripe", tenant_id: tenantId,
        message: "Missing subscriber or tier on payment",
        payload: { event_id: eventId, payment_id: payment.id, has_subscriber: !!subscriber, has_tier: !!tier },
      });
      await markEvent("ignored", "missing_relations");
      return new Response("missing_relations", { status: 200 });
    }

    const customerEmail = session?.customer_details?.email ?? null;
    const nowISO = new Date().toISOString();

    // Load current subscriber state for stacking + telegram flow
    const { data: currentSubscriber } = await supabaseAdmin
      .from("subscribers")
      .select("subscription_start, subscription_end, email, is_in_channel, telegram_user_id, first_name, last_name, telegram_username, status")
      .eq("id", payment.subscriber_id)
      .maybeSingle();

    // Compute OR reuse subscription end (never double-extend on retries)
    let newEndISO: string;
    let reusedComputedEnd = false;
    if (typeof existingStripeData.computed_subscription_end === "string" && existingStripeData.computed_subscription_end) {
      newEndISO = existingStripeData.computed_subscription_end as string;
      reusedComputedEnd = true;
    } else {
      const currentEndISO = currentSubscriber?.subscription_end ?? null;
      const intervalUnit = tier.interval_unit || "day";
      const intervalCount = tier.interval_count || tier.duration_days || 30;
      const billingTimezone = tier.billing_timezone || "Europe/Moscow";
      newEndISO = computeNextEndISO(nowISO, currentEndISO, intervalUnit, intervalCount, billingTimezone);
    }

    // Persist activation plan BEFORE touching the subscriber, so retries reuse the same end
    let workingStripeData: Record<string, unknown> = { ...existingStripeData };
    if (!reusedComputedEnd) {
      workingStripeData = {
        ...existingStripeData,
        activation_started_at: existingStripeData.activation_started_at ?? nowISO,
        activation_base_subscription_end: currentSubscriber?.subscription_end ?? null,
        computed_subscription_end: newEndISO,
        activation_plan_created_by: "stripe-webhook",
        webhook_event_id: eventId,
        checkout_session_id: session.id,
      };
      const { error: planErr } = await supabaseAdmin
        .from("payment_history")
        .update({ stripe_data: workingStripeData })
        .eq("id", payment.id);
      if (planErr) {
        await safeLog(supabaseAdmin, {
          level: "error", event_type: "payment.webhook_error", source: "stripe", tenant_id: tenantId,
          message: "Failed to persist activation plan",
          payload: { event_id: eventId, payment_id: payment.id, error: planErr.message },
        });
        await markEvent("error", planErr.message);
        return new Response("internal_error", { status: 500 });
      }
    }

    // Activate subscriber FIRST (idempotent: subscription_end is fixed)
    const currentStartISO = currentSubscriber?.subscription_start ?? null;
    const subUpdate: Record<string, unknown> = {
      status: "active",
      tier_id: payment.tier_id,
      subscription_end: newEndISO,
      subscriber_payment_method: "stripe_single",
      auto_renewal: false,
      single_expiry_notification_sent: false,
      next_payment_notification_sent: false,
    };
    if (!currentStartISO) subUpdate.subscription_start = nowISO;
    if (!currentSubscriber?.email && customerEmail) subUpdate.email = customerEmail;

    const { error: activateErr } = await supabaseAdmin
      .from("subscribers").update(subUpdate).eq("id", payment.subscriber_id);
    if (activateErr) {
      await safeLog(supabaseAdmin, {
        level: "error", event_type: "payment.webhook_error", source: "stripe", tenant_id: tenantId,
        message: "Failed to activate subscriber",
        payload: { event_id: eventId, payment_id: payment.id, error: activateErr.message },
      });
      await markEvent("error", activateErr.message);
      return new Response("internal_error", { status: 500 });
    }

    // Only AFTER subscriber update succeeds → mark payment completed with activation marker
    const completedAtISO = new Date().toISOString();
    const finalStripeData = {
      ...workingStripeData,
      webhook_event_id: eventId,
      checkout_session_id: session.id,
      payment_intent_id: session.payment_intent ?? null,
      customer_id: session.customer ?? null,
      customer_email: customerEmail,
      payment_status: session.payment_status,
      session_status: session.status,
      amount_total: session.amount_total,
      currency: session.currency,
      consent_terms_of_service: consentTos,
      livemode: Boolean(session.livemode),
      completed_at: workingStripeData.completed_at ?? completedAtISO,
      subscriber_activated_at: completedAtISO,
      subscription_end: newEndISO,
      processed_by: "stripe-webhook",
    };

    if (payment.status !== "completed") {
      const { error: updatePayErr } = await supabaseAdmin
        .from("payment_history")
        .update({
          status: "completed",
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: session.payment_intent ?? null,
          stripe_customer_id: session.customer ?? null,
          payment_date: completedAtISO,
          stripe_data: finalStripeData,
        })
        .eq("id", payment.id);
      if (updatePayErr) {
        // Subscriber already activated; do NOT mark webhook processed so Stripe retries
        await safeLog(supabaseAdmin, {
          level: "error", event_type: "payment.webhook_error", source: "stripe", tenant_id: tenantId,
          message: "Failed to update payment_history to completed after subscriber activation",
          payload: { event_id: eventId, payment_id: payment.id, error: updatePayErr.message },
        });
        await markEvent("error", updatePayErr.message);
        return new Response("internal_error", { status: 500 });
      }
    } else {
      // Payment was already completed but missing activation marker — backfill marker only
      await supabaseAdmin.from("payment_history")
        .update({ stripe_data: { ...finalStripeData, recovered_by: "stripe-webhook" } })
        .eq("id", payment.id);
    }

    // Update stripe_checkout_sessions
    if (sessionId) {
      try {
        await supabaseAdmin.from("stripe_checkout_sessions").update({
          status: session.status ?? "complete",
          stripe_payment_intent_id: session.payment_intent ?? null,
          stripe_customer_id: session.customer ?? null,
          updated_at: new Date().toISOString(),
        }).eq("stripe_checkout_session_id", sessionId);
      } catch (e) {
        console.warn("[stripe-webhook] failed to update stripe_checkout_sessions:", e);
      }
    }

    await safeLog(supabaseAdmin, {
      level: "info", event_type: "payment.succeeded", source: "stripe",
      subscriber_id: payment.subscriber_id,
      telegram_user_id: currentSubscriber?.telegram_user_id ?? null,
      tier_id: payment.tier_id, tenant_id: tenantId,
      request_id: session.id ?? payment.invoice_id ?? null,
      message: "Stripe payment completed successfully",
      payload: {
        amount: Number(payment.amount),
        currency: payment.currency,
        payment_method: "stripe_single",
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: session.payment_intent ?? null,
        subscription_end: newEndISO,
        livemode: Boolean(session.livemode),
        consent_terms_of_service: consentTos,
        reused_computed_end: reusedComputedEnd,
      },
    });

    // Admin notification — numeric amount + currency in note
    try {
      const stripeNoteParts: string[] = [];
      if (payment.payment_note) stripeNoteParts.push(String(payment.payment_note));
      stripeNoteParts.push(`Stripe payment, currency: ${payment.currency}`);
      await sendAdminNotification({
        supabaseAdmin,
        tenantId,
        eventType: "PAYMENT_SUCCESS",
        subscriber: {
          id: payment.subscriber_id,
          name: [currentSubscriber?.first_name, currentSubscriber?.last_name].filter(Boolean).join(" ") || null,
          username: currentSubscriber?.telegram_username ?? null,
          telegram_user_id: currentSubscriber?.telegram_user_id ?? null,
          email: currentSubscriber?.email ?? customerEmail ?? null,
        },
        plan: tier.name ?? null,
        status: "active",
        method: "stripe_single",
        amount: Number(payment.amount),
        subscriptionEndISO: newEndISO,
        note: stripeNoteParts.join(" — "),
        paymentId: payment.id,
        relatedAtISO: newEndISO,
        source: "stripe-webhook",
      });
    } catch (e) {
      console.warn("[stripe-webhook] admin notification failed:", e);
    }



    // ----- Telegram success message + invite -----
    try {
      const { data: settings } = await supabaseAdmin
        .from("admin_settings")
        .select("telegram_bot_token, telegram_channel_id, channel_name, notification_payment_success")
        .eq("tenant_id", tenantId)
        .maybeSingle();

      const telegramBotToken = settings?.telegram_bot_token as string | null;
      const telegramChannelId = settings?.telegram_channel_id as string | null;
      const channelName = settings?.channel_name as string | null;
      const notificationPaymentSuccess = settings?.notification_payment_success as string | null;
      const telegramUserId = currentSubscriber?.telegram_user_id ?? null;

      if (telegramBotToken && telegramChannelId && telegramUserId) {
        let channelId = telegramChannelId.toString();
        if (!channelId.startsWith("-100") && channelId.startsWith("-")) {
          channelId = "-100" + channelId.substring(1);
        }

        if (notificationPaymentSuccess) {
          const expiresDate = DateTime.fromISO(newEndISO, { zone: "utc" })
            .setZone("Europe/Moscow")
            .toLocaleString({ day: "numeric", month: "long", year: "numeric" }, { locale: "ru" });
          const amountRaw = Number(payment.amount).toLocaleString("ru-RU");
          const currencyCode = String(payment.currency || "EUR").toUpperCase();
          const amountWithCurrency = currencyCode === "RUB" ? `${amountRaw}₽` : `${amountRaw} ${currencyCode}`;
          const successMessage = notificationPaymentSuccess
            .replace(/{channel_name}/g, channelName || "канал")
            // Strip currency suffixes that templates may hardcode for RUB, to avoid e.g. "49 EUR₽".
            .replace(/\{amount\}\s*₽/g, amountWithCurrency)
            .replace(/\{amount\}\s*руб\.?/gi, amountWithCurrency)
            .replace(/\{amount\}\s*RUB/gi, amountWithCurrency)
            .replace(/{amount}/g, amountWithCurrency)
            .replace(/{expires_date}/g, expiresDate);

          const msgResult = await fetch(
            `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: telegramUserId,
                text: successMessage,
                parse_mode: "HTML",
              }),
            },
          );
          const msgResponse = await msgResult.json().catch(() => ({}));
          await logUserNotification({
            supabaseAdmin,
            source: "stripe-webhook",
            notificationKey: "payment_success",
            subscriberId: payment.subscriber_id,
            telegramUserId,
            subscriptionEnd: newEndISO,
            telegramOk: !!msgResponse?.ok,
            telegramError: msgResponse?.ok ? null : msgResponse?.description,
            textPreview: successMessage,
          });
        }

        if (currentSubscriber?.is_in_channel === true) {
          await safeLog(supabaseAdmin, {
            level: "info", event_type: "telegram.invite_skipped_existing", source: "stripe",
            subscriber_id: payment.subscriber_id, telegram_user_id: telegramUserId,
            tier_id: payment.tier_id, tenant_id: tenantId, request_id: session.id,
            message: "User already in channel, skipped invite creation", payload: { event_id: eventId },
          });
        } else {
          // Check existing valid invite
          const { data: existingInvite } = await supabaseAdmin
            .from("invite_links")
            .select("id, invite_link, expires_at")
            .eq("subscriber_id", payment.subscriber_id)
            .eq("revoked", false)
            .gt("expires_at", new Date().toISOString())
            .order("created_at", { ascending: false })
            .limit(1).maybeSingle();

          if (existingInvite) {
            await safeLog(supabaseAdmin, {
              level: "info", event_type: "telegram.invite_skipped_existing", source: "stripe",
              subscriber_id: payment.subscriber_id, telegram_user_id: telegramUserId,
              tier_id: payment.tier_id, tenant_id: tenantId, request_id: session.id,
              message: "Valid invite already exists, skipped creation",
              payload: { event_id: eventId, expires_at: existingInvite.expires_at },
            });
          } else {
            // Unban
            try {
              await fetch(`https://api.telegram.org/bot${telegramBotToken}/unbanChatMember`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: channelId, user_id: telegramUserId, only_if_banned: true }),
              });
            } catch (e) { console.warn("[stripe-webhook] unban failed:", e); }

            // Revoke previous non-revoked invites
            const { data: previousLinks } = await supabaseAdmin
              .from("invite_links").select("id, invite_link")
              .eq("subscriber_id", payment.subscriber_id).eq("revoked", false);
            for (const link of previousLinks ?? []) {
              try {
                await fetch(`https://api.telegram.org/bot${telegramBotToken}/revokeChatInviteLink`, {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ chat_id: channelId, invite_link: link.invite_link }),
                });
              } catch (e) { console.warn("[stripe-webhook] revoke failed:", e); }
              await supabaseAdmin.from("invite_links")
                .update({ revoked: true, revoked_at: new Date().toISOString() })
                .eq("id", link.id);
            }

            // Create new 10-minute single-use invite
            const nowUnix = Math.floor(Date.now() / 1000);
            const expireTimestamp = nowUnix + 600;
            const expiresAtISO = new Date(expireTimestamp * 1000).toISOString();
            const inviteResponse = await fetch(
              `https://api.telegram.org/bot${telegramBotToken}/createChatInviteLink`,
              {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: channelId,
                  member_limit: 1,
                  creates_join_request: false,
                  expire_date: expireTimestamp,
                }),
              },
            );
            const inviteResult = await inviteResponse.json().catch(() => ({}));
            if (inviteResult?.ok) {
              const newInviteLink = inviteResult.result.invite_link;
              await supabaseAdmin.from("invite_links").insert({
                subscriber_id: payment.subscriber_id,
                invite_link: newInviteLink,
                expires_at: expiresAtISO,
                revoked: false,
                tenant_id: tenantId,
              });
              await safeLog(supabaseAdmin, {
                level: "info", event_type: "telegram.invite_created", source: "stripe",
                subscriber_id: payment.subscriber_id, telegram_user_id: telegramUserId,
                tier_id: payment.tier_id, tenant_id: tenantId, request_id: session.id,
                message: "Invite link created after stripe payment",
                payload: { event_id: eventId, invite_link: newInviteLink, expires_at: expiresAtISO },
              });
              try {
                await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: telegramUserId,
                    text: `🔗 Перейдите по ссылке, чтобы присоединиться к каналу:\n${newInviteLink}\n\n⚠️ Ссылка одноразовая и действует 10 минут.`,
                    parse_mode: "HTML",
                  }),
                });
              } catch (e) { console.warn("[stripe-webhook] send invite msg failed:", e); }
            } else {
              await safeLog(supabaseAdmin, {
                level: "error", event_type: "telegram.invite_error", source: "stripe",
                subscriber_id: payment.subscriber_id, telegram_user_id: telegramUserId,
                tier_id: payment.tier_id, tenant_id: tenantId, request_id: session.id,
                message: "Failed to create Telegram invite link",
                payload: { event_id: eventId, telegram_error: inviteResult?.description ?? null },
              });
            }
          }
        }
      }
    } catch (telegramErr) {
      console.error("[stripe-webhook] telegram flow failed (non-fatal):", telegramErr);
      await safeLog(supabaseAdmin, {
        level: "error", event_type: "telegram.invite_error", source: "stripe", tenant_id: tenantId,
        message: "Telegram post-payment flow failed",
        payload: { event_id: eventId, error: telegramErr instanceof Error ? telegramErr.message : String(telegramErr) },
      });
    }

    await markEvent("processed");
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("[stripe-webhook] handler exception:", err);
    await safeLog(supabaseAdmin, {
      level: "error", event_type: "payment.webhook_error", source: "stripe", tenant_id: tenantId,
      message: "Webhook processing exception",
      payload: { event_id: eventId ?? null, error: err instanceof Error ? err.message : String(err) },
    });
    try { await markEvent("error", err instanceof Error ? err.message : String(err)); } catch { /* noop */ }
    return new Response("internal_error", { status: 500 });
  }
});
