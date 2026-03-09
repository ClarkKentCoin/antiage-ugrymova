import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encode as hexEncode } from "https://deno.land/std@0.168.0/encoding/hex.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveTenantIdFromSlug, DEFAULT_TENANT_ID } from "../_shared/tenant.ts";

// Debug version to track deployed code
const FUNCTION_VERSION = "2026-03-09_01:shared-tenant";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const enc = new TextEncoder();
const dec = new TextDecoder();

async function hmacSha256(key: Uint8Array, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return dec.decode(hexEncode(new Uint8Array(sig)));
}

async function hmacSha256Raw(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return new Uint8Array(sig);
}

function buildDataCheckString(params: URLSearchParams): { dataCheckString: string; receivedHash: string | null } {
  const entries: [string, string][] = [];
  let receivedHash: string | null = null;

  for (const [k, v] of params.entries()) {
    if (k === "hash") {
      receivedHash = v;
      continue;
    }
    entries.push([k, v]);
  }

  entries.sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  return { dataCheckString, receivedHash };
}

async function isValidInitData(initData: string, botToken: string): Promise<{ ok: boolean; telegramUserId?: number; reason?: string }> {
  try {
    const params = new URLSearchParams(initData);
    const { dataCheckString, receivedHash } = buildDataCheckString(params);

    if (!receivedHash) return { ok: false, reason: "missing_hash" };

    // secretKey = HMAC_SHA256(key="WebAppData", message=botToken)
    const secret = await hmacSha256Raw(enc.encode("WebAppData"), botToken);

    // computedHash = HMAC_SHA256(key=secretKey, message=data_check_string)
    const computedHex = await hmacSha256(secret, dataCheckString);

    if (computedHex !== receivedHash) {
      console.log("Hash mismatch:", { computed: computedHex, received: receivedHash });
      return { ok: false, reason: "hash_mismatch" };
    }

    const userStr = params.get("user");
    if (!userStr) return { ok: false, reason: "missing_user" };

    let user: Record<string, unknown>;
    try {
      user = JSON.parse(userStr);
    } catch {
      return { ok: false, reason: "bad_user_json" };
    }

    const id = Number(user?.id);
    if (!Number.isFinite(id)) return { ok: false, reason: "bad_user_id" };

    return { ok: true, telegramUserId: id };
  } catch (e) {
    console.error("isValidInitData error:", e);
    return { ok: false, reason: e instanceof Error ? e.message : "unknown" };
  }
}


serve(async (req) => {
  const { method, pathname } = { method: req.method, pathname: new URL(req.url).pathname };
  console.log("[get-subscriber-status] hit", { method, pathname });

  // Handle CORS preflight FIRST
  if (method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  // Only allow POST
  if (method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { telegram_user_id, init_data, tenant_slug } = await req.json();

    console.log("get-subscriber-status request:", { telegram_user_id, hasInitData: !!init_data, tenant_slug });

    if (!telegram_user_id || !init_data) {
      return new Response(
        JSON.stringify({ error: "telegram_user_id and init_data are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve tenant - reject explicit invalid slugs
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
      tenantId = DEFAULT_TENANT_ID;
    }
    console.log(`[get-subscriber-status] Resolved tenant_id: ${tenantId} from slug: ${tenant_slug || 'null'}`);

    // Get settings for this specific tenant
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("admin_settings")
      .select("telegram_bot_token, grace_period_days")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (settingsError || !settings?.telegram_bot_token) {
      console.error("Settings error:", settingsError);
      return new Response(
        JSON.stringify({ error: "telegram_bot_not_configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const validation = await isValidInitData(init_data, settings.telegram_bot_token);
    console.log("Validation result:", validation);

    if (!validation.ok) {
      return new Response(
        JSON.stringify({ error: "invalid_init_data", reason: validation.reason }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (validation.telegramUserId !== Number(telegram_user_id)) {
      console.log("User ID mismatch:", { validated: validation.telegramUserId, requested: telegram_user_id });
      return new Response(
        JSON.stringify({ error: "user_id_mismatch" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Query subscriber for this specific tenant
    const { data: subscriber, error } = await supabaseAdmin
      .from("subscribers")
      .select(
        `id, telegram_user_id, telegram_username, first_name, last_name, phone_number,
         status, subscription_start, subscription_end, auto_renewal, tier_id, is_in_channel,
         created_at, updated_at, subscriber_payment_method,
         subscription_tiers ( id, name, price, duration_days )`,
      )
      .eq("telegram_user_id", Number(telegram_user_id))
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) {
      console.error("DB error:", error);
      return new Response(
        JSON.stringify({ error: "db_error", details: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Calculate grace period info if subscriber exists and is in grace period
    let graceDaysRemaining: number | null = null;
    let graceEndAt: string | null = null;
    let graceMsRemaining: number | null = null;
    const gracePeriodDays = settings.grace_period_days ?? 3;
    const serverNow = new Date();
    const serverNowMs = serverNow.getTime();
    const expiresAtRaw = subscriber?.subscription_end ?? null;

    if (subscriber?.subscription_end && (subscriber.status === "grace_period" || subscriber.status === "past_due")) {
      const subscriptionEnd = new Date(subscriber.subscription_end).getTime();
      const graceEndMs = subscriptionEnd + (gracePeriodDays * MS_PER_DAY);
      
      // Use Math.ceil to ensure we show "1 day" at the start, not "0 days"
      graceMsRemaining = graceEndMs - serverNowMs;
      graceDaysRemaining = Math.max(0, Math.ceil(graceMsRemaining / MS_PER_DAY));
      graceEndAt = new Date(graceEndMs).toISOString();
      
      console.log(`[get-subscriber-status] Grace period: subscriptionEnd=${subscriber.subscription_end}, gracePeriodDays=${gracePeriodDays}, graceDaysRemaining=${graceDaysRemaining}, graceMsRemaining=${graceMsRemaining}`);
    }

    console.log("Returning subscriber:", subscriber?.id, subscriber?.status, { tenant_id_used: tenantId, tenant_slug_used: tenant_slug || null, function_version: FUNCTION_VERSION });

    return new Response(
      JSON.stringify({ 
        subscriber: subscriber ?? null,
        grace_period_days: gracePeriodDays,
        grace_days_remaining: graceDaysRemaining,
        grace_end_at: graceEndAt,
        // Extended debug info for diagnosing iPhone issues
        function_version: FUNCTION_VERSION,
        server_now: serverNow.toISOString(),
        expires_at_raw: expiresAtRaw,
        grace_ms_remaining: graceMsRemaining,
        _debug: {
          tenant_id_used: tenantId,
          tenant_slug_used: tenant_slug || null,
        }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store, max-age=0", "Pragma": "no-cache" } },
    );
  } catch (error) {
    console.error("get-subscriber-status error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
