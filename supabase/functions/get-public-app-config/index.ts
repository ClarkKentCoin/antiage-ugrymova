import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveTenantIdFromSlug, DEFAULT_TENANT_ID } from "../_shared/tenant.ts";
import { getCanonicalAppBaseUrl } from "../_shared/appConfig.ts";

/**
 * Public config endpoint — returns ONLY safe non-sensitive tenant settings
 * needed by Mini App: channel name, description, grace period days.
 * Never exposes bot tokens, payment secrets, or admin settings.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { tenant_slug } = await req.json();

    let tenantId: string;
    let resolvedSlug: string | null = null;

    if (tenant_slug) {
      const resolved = await resolveTenantIdFromSlug(supabaseAdmin, tenant_slug);
      if (resolved.source === "default") {
        // Explicit slug was provided but not found — do NOT silently fall back
        return new Response(
          JSON.stringify({ error: "invalid_tenant" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      tenantId = resolved.tenantId;
      resolvedSlug = resolved.tenantSlug;
    } else {
      // No slug — backward-compatible default to main production tenant
      tenantId = DEFAULT_TENANT_ID;
    }

    const { data: settings, error } = await supabaseAdmin
      .from("admin_settings")
      .select("channel_name, channel_description, grace_period_days, payment_link, logo_url")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) {
      console.error("[get-public-app-config] Settings error:", error);
      return new Response(
        JSON.stringify({ error: "settings_not_found" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Safe public payment method availability. Never expose secrets/Vault.
    let stripeEnabled = false;
    let stripeMode: "test" | "live" | null = null;
    try {
      const { data: stripeProvider } = await supabaseAdmin
        .from("tenant_payment_providers")
        .select("is_enabled, mode, public_config")
        .eq("tenant_id", tenantId)
        .eq("provider_code", "stripe")
        .maybeSingle();
      if (stripeProvider) {
        const pub = (stripeProvider.public_config ?? {}) as Record<string, unknown>;
        const hasPk = typeof pub.publishable_key === "string" && (pub.publishable_key as string).length > 0;
        const hasSk = pub.has_secret_key === true;
        const hasWs = pub.has_webhook_secret === true;
        stripeEnabled = !!stripeProvider.is_enabled && hasPk && hasSk && hasWs;
        stripeMode = (stripeProvider.mode as "test" | "live") ?? null;
      }
    } catch (e) {
      console.error("[get-public-app-config] stripe provider lookup failed:", e);
    }

    return new Response(
      JSON.stringify({
        tenant_id: tenantId,
        tenant_slug: resolvedSlug,
        channel_name: settings?.channel_name ?? null,
        channel_description: settings?.channel_description ?? null,
        grace_period_days: settings?.grace_period_days ?? 0,
        payment_link: settings?.payment_link ?? null,
        logo_url: settings?.logo_url ?? null,
        canonical_base_url: getCanonicalAppBaseUrl(),
        payment_methods: {
          robokassa: {
            enabled: true,
            label: "Российская карта",
            provider: "robokassa",
          },
          stripe: {
            enabled: stripeEnabled,
            label: "Зарубежная карта",
            provider: "stripe",
            mode: stripeMode,
          },
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[get-public-app-config] Error:", error);
    return new Response(
      JSON.stringify({ error: "internal_error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
