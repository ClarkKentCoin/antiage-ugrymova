import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encode as hexEncode } from "https://deno.land/std@0.168.0/encoding/hex.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Default tenant ID for backward compatibility (production main tenant)
const DEFAULT_TENANT_ID = Deno.env.get("PUBLIC_TENANT_ID") ?? "6749bded-94d6-4793-9f46-09724da30ab6";

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

    const secret = await hmacSha256Raw(enc.encode("WebAppData"), botToken);
    const computedHex = await hmacSha256(secret, dataCheckString);

    if (computedHex !== receivedHash) {
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

// Resolve tenant ID from slug or use default
async function resolveTenantId(supabaseAdmin: any, tenantSlug: string | null): Promise<string> {
  if (!tenantSlug) {
    return DEFAULT_TENANT_ID;
  }

  const { data: tenant, error } = await supabaseAdmin
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .maybeSingle();

  if (error || !tenant) {
    console.log(`[get-payment-history] Tenant not found for slug: ${tenantSlug}, using default`);
    return DEFAULT_TENANT_ID;
  }

  return tenant.id;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { telegram_user_id, init_data, tenant_slug } = await req.json();

    console.log("get-payment-history request:", { telegram_user_id, hasInitData: !!init_data, tenant_slug });

    if (!telegram_user_id || !init_data) {
      return new Response(
        JSON.stringify({ error: "telegram_user_id and init_data are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve tenant ID from slug (or use default)
    const tenantId = await resolveTenantId(supabaseAdmin, tenant_slug);
    console.log(`[get-payment-history] Resolved tenant_id: ${tenantId} from slug: ${tenant_slug || 'null'}`);

    // Get settings for this specific tenant
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("admin_settings")
      .select("telegram_bot_token")
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

    // Find subscriber for this specific tenant
    const { data: subscriber, error: subError } = await supabaseAdmin
      .from("subscribers")
      .select("id")
      .eq("telegram_user_id", Number(telegram_user_id))
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (subError) {
      console.error("Subscriber lookup error:", subError);
      return new Response(
        JSON.stringify({ payments: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!subscriber) {
      return new Response(
        JSON.stringify({ payments: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch payment history - only completed payments for MiniApp users, filtered by tenant
    const { data: payments, error: payError } = await supabaseAdmin
      .from("payment_history")
      .select("id, created_at, payment_date, amount, status, payment_method, invoice_id, payment_note")
      .eq("subscriber_id", subscriber.id)
      .eq("tenant_id", tenantId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(50);

    if (payError) {
      console.error("Payment history error:", payError);
      return new Response(
        JSON.stringify({ payments: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("Returning", payments?.length ?? 0, "payments for subscriber", subscriber.id, { tenant_id_used: tenantId });

    return new Response(
      JSON.stringify({ 
        payments: payments ?? [],
        _debug: {
          tenant_id_used: tenantId,
          tenant_slug_used: tenant_slug || null,
        }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("get-payment-history error:", error);
    return new Response(
      JSON.stringify({ payments: [] }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
