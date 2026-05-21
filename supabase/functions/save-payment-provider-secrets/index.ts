import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveTenantFromRequest } from "../_shared/tenant.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // 1) Authn
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
    const userId = userData.user.id;

    // 2) Admin role check
    const { data: roleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return json({ error: "forbidden" }, 403);

    // 3) Parse body
    const body = await req.json().catch(() => ({}));
    const {
      provider_code,
      mode,
      display_name,
      publishable_key,
      secret_key,
      webhook_secret,
      is_enabled,
    } = body ?? {};

    if (provider_code !== "stripe") {
      return json({ error: "unsupported_provider" }, 400);
    }
    if (mode !== "test" && mode !== "live") {
      return json({ error: "invalid_mode" }, 400);
    }

    // 4) Resolve tenant + verify ownership
    const tenant = await resolveTenantFromRequest({ req, supabaseAdmin, body });
    const { data: tenantRow } = await supabaseAdmin
      .from("tenants")
      .select("id, owner_id")
      .eq("id", tenant.tenantId)
      .maybeSingle();
    if (!tenantRow || tenantRow.owner_id !== userId) {
      return json({ error: "forbidden_tenant" }, 403);
    }

    // 5) Validate key prefixes when provided
    const pk = typeof publishable_key === "string" ? publishable_key.trim() : "";
    const sk = typeof secret_key === "string" ? secret_key.trim() : "";
    const ws = typeof webhook_secret === "string" ? webhook_secret.trim() : "";

    const expectedPkPrefix = mode === "test" ? "pk_test_" : "pk_live_";
    const expectedSkPrefix = mode === "test" ? "sk_test_" : "sk_live_";

    if (pk && !pk.startsWith(expectedPkPrefix)) {
      return json({ error: "invalid_publishable_key", message: `Expected ${expectedPkPrefix}…` }, 400);
    }
    if (sk && !sk.startsWith(expectedSkPrefix)) {
      return json({ error: "invalid_secret_key", message: `Expected ${expectedSkPrefix}…` }, 400);
    }
    if (ws && !ws.startsWith("whsec_")) {
      return json({ error: "invalid_webhook_secret", message: "Expected whsec_…" }, 400);
    }

    // 6) Load existing public_config so we can preserve publishable_key
    const { data: existingProvider } = await supabaseAdmin
      .from("tenant_payment_providers")
      .select("public_config")
      .eq("tenant_id", tenant.tenantId)
      .eq("provider_code", "stripe")
      .maybeSingle();

    const existingPublic = (existingProvider?.public_config ?? {}) as Record<string, unknown>;
    const effectivePk = pk || (existingPublic.publishable_key as string | undefined) || "";
    const hasExistingSecretKey = Boolean(existingPublic.has_secret_key);
    const hasExistingWebhookSecret = Boolean(existingPublic.has_webhook_secret);

    // 7) Pre-validate enable readiness
    const willHaveSecretKey = !!sk || hasExistingSecretKey;
    const willHaveWebhookSecret = !!ws || hasExistingWebhookSecret;
    const requestedEnabled = is_enabled === true;
    if (requestedEnabled && !(effectivePk && willHaveSecretKey && willHaveWebhookSecret)) {
      return json(
        { error: "insufficient_credentials", message: "Publishable key, secret key и webhook secret обязательны для включения." },
        400,
      );
    }

    // 8) Build RPC params
    const publicConfig: Record<string, unknown> = {
      payment_audience: "foreign_cards",
    };
    if (effectivePk) publicConfig.publishable_key = effectivePk;

    const secretPatch: Record<string, string> = {};
    if (sk) secretPatch.stripe_secret_key = sk;
    if (ws) secretPatch.stripe_webhook_secret = ws;

    // 9) Call RPC as service role
    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc(
      "save_tenant_payment_provider_secret",
      {
        p_tenant_id: tenant.tenantId,
        p_provider_code: "stripe",
        p_mode: mode,
        p_display_name: typeof display_name === "string" && display_name.trim() ? display_name.trim() : "Stripe",
        p_public_config: publicConfig,
        p_secret_patch: secretPatch,
        p_is_enabled: requestedEnabled,
      },
    );

    if (rpcErr) {
      console.error("[save-payment-provider-secrets] RPC error:", rpcErr.message);
      return json({ error: "rpc_failed", message: rpcErr.message }, 400);
    }

    const result = (rpcData ?? {}) as Record<string, unknown>;
    return json({
      success: true,
      provider_code: "stripe",
      mode,
      is_enabled: Boolean(result.is_enabled),
      configured: Boolean(result.configured),
      has_secret_key: Boolean(result.has_secret_key),
      has_webhook_secret: Boolean(result.has_webhook_secret),
    });
  } catch (err) {
    console.error("[save-payment-provider-secrets] Unhandled:", err);
    return json({ error: "internal_error" }, 500);
  }
});
