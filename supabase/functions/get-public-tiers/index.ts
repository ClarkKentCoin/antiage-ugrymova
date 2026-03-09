import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveTenantIdFromSlug, DEFAULT_TENANT_ID } from "../_shared/tenant.ts";

/**
 * Public tiers endpoint — returns only active subscription tiers for the resolved tenant.
 * Never exposes inactive tiers, admin settings, or sensitive data.
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

    let tenantSlug: string | null = null;

    // Accept tenant_slug from body (POST) or query param ?t= (GET)
    if (req.method === "POST") {
      try {
        const body = await req.json();
        tenantSlug = body?.tenant_slug ?? null;
      } catch {
        // empty body is OK
      }
    } else {
      const url = new URL(req.url);
      tenantSlug = url.searchParams.get("t");
    }

    let tenantId: string;

    if (tenantSlug) {
      const resolved = await resolveTenantIdFromSlug(supabaseAdmin, tenantSlug);
      if (resolved.source === "default") {
        // Explicit slug was provided but not found — do NOT silently fall back
        return new Response(
          JSON.stringify({ error: "invalid_tenant" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      tenantId = resolved.tenantId;
    } else {
      // No slug — backward-compatible default to main production tenant
      tenantId = DEFAULT_TENANT_ID;
    }

    const { data: tiers, error } = await supabaseAdmin
      .from("subscription_tiers")
      .select("id, name, description, duration_days, price, is_active, interval_unit, interval_count, billing_timezone, grace_period_enabled, show_in_dashboard, purchase_once_only, created_at, updated_at")
      .eq("is_active", true)
      .eq("tenant_id", tenantId)
      .order("price", { ascending: true });

    if (error) {
      console.error("[get-public-tiers] Query error:", error);
      return new Response(
        JSON.stringify({ error: "query_failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ tenant_id: tenantId, tiers: tiers ?? [] }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[get-public-tiers] Error:", error);
    return new Response(
      JSON.stringify({ error: "internal_error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
