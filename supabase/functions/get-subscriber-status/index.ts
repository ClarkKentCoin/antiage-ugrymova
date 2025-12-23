import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as hexEncode } from "https://deno.land/std@0.168.0/encoding/hex.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { telegram_user_id, init_data } = await req.json();

    console.log("get-subscriber-status request:", { telegram_user_id, hasInitData: !!init_data });

    if (!telegram_user_id || !init_data) {
      return new Response(
        JSON.stringify({ error: "telegram_user_id and init_data are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("admin_settings")
      .select("telegram_bot_token")
      .limit(1)
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

    const { data: subscriber, error } = await supabaseAdmin
      .from("subscribers")
      .select(
        `id, telegram_user_id, telegram_username, first_name, last_name, phone_number,
         status, subscription_start, subscription_end, auto_renewal, tier_id, is_in_channel,
         created_at, updated_at,
         subscription_tiers ( id, name, price, duration_days )`,
      )
      .eq("telegram_user_id", Number(telegram_user_id))
      .maybeSingle();

    if (error) {
      console.error("DB error:", error);
      return new Response(
        JSON.stringify({ error: "db_error", details: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("Returning subscriber:", subscriber?.id, subscriber?.status);

    return new Response(
      JSON.stringify({ subscriber: subscriber ?? null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
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
