/**
 * Shared Tenant Resolver Helper
 * Step 3.1 — Multi-tenant resolution utilities for Supabase Edge Functions
 * 
 * This module provides consistent tenant resolution across all edge functions:
 * - From URL query param (?t=slug)
 * - From request body (tenant_slug)
 * - From header (x-tenant-slug)
 * - From authenticated user (owner_id lookup)
 * - Fallback to default tenant
 */

import { SupabaseClient, createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Default tenant ID - used when no tenant context can be determined
export const DEFAULT_TENANT_ID = Deno.env.get("PUBLIC_TENANT_ID") ?? "6749bded-94d6-4793-9f46-09724da30ab6";

export type TenantResolveSource = "slug" | "auth" | "default";

export interface ResolvedTenant {
  tenantId: string;
  tenantSlug: string | null;
  source: TenantResolveSource;
  ownerUserId?: string | null;
}

export interface ResolveTenantOptions {
  req: Request;
  supabaseAdmin: SupabaseClient;
  body?: Record<string, unknown>;
}

/**
 * Resolve tenant ID from a known slug.
 * If slug is empty or not found, returns default tenant.
 */
export async function resolveTenantIdFromSlug(
  supabaseAdmin: SupabaseClient,
  tenantSlug: string | null | undefined
): Promise<ResolvedTenant> {
  // If no slug provided, return default
  if (!tenantSlug || tenantSlug.trim() === "") {
    return {
      tenantId: DEFAULT_TENANT_ID,
      tenantSlug: null,
      source: "default",
    };
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("tenants")
      .select("id, slug, owner_id")
      .eq("slug", tenantSlug.trim())
      .maybeSingle();

    if (error) {
      console.warn(`[tenant.ts] Error looking up tenant by slug "${tenantSlug}":`, error.message);
      return {
        tenantId: DEFAULT_TENANT_ID,
        tenantSlug: null,
        source: "default",
      };
    }

    if (!data) {
      console.warn(`[tenant.ts] Tenant not found for slug "${tenantSlug}", using default`);
      return {
        tenantId: DEFAULT_TENANT_ID,
        tenantSlug: null,
        source: "default",
      };
    }

    return {
      tenantId: data.id,
      tenantSlug: data.slug,
      source: "slug",
      ownerUserId: data.owner_id,
    };
  } catch (err) {
    console.error(`[tenant.ts] Exception resolving tenant from slug "${tenantSlug}":`, err);
    return {
      tenantId: DEFAULT_TENANT_ID,
      tenantSlug: null,
      source: "default",
    };
  }
}

/**
 * Resolve tenant from request context.
 * Priority:
 * 1. Query param ?t=<slug>
 * 2. Body field tenant_slug
 * 3. Header x-tenant-slug
 * 4. Authenticated user's tenant (via Authorization header)
 * 5. Default tenant
 */
export async function resolveTenantFromRequest(
  opts: ResolveTenantOptions
): Promise<ResolvedTenant> {
  const { req, supabaseAdmin, body } = opts;

  // 1. Try query param ?t=<slug>
  const url = new URL(req.url);
  const querySlug = url.searchParams.get("t");
  if (querySlug) {
    const result = await resolveTenantIdFromSlug(supabaseAdmin, querySlug);
    if (result.source === "slug") {
      return result;
    }
  }

  // 2. Try body.tenant_slug
  const bodySlug = body?.tenant_slug as string | undefined;
  if (bodySlug) {
    const result = await resolveTenantIdFromSlug(supabaseAdmin, bodySlug);
    if (result.source === "slug") {
      return result;
    }
  }

  // 3. Try header x-tenant-slug
  const headerSlug = req.headers.get("x-tenant-slug");
  if (headerSlug) {
    const result = await resolveTenantIdFromSlug(supabaseAdmin, headerSlug);
    if (result.source === "slug") {
      return result;
    }
  }

  // 4. Try to resolve from authenticated user
  const authHeader = req.headers.get("Authorization");
  if (authHeader) {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

      if (supabaseUrl && supabaseAnonKey) {
        const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
          global: {
            headers: { Authorization: authHeader },
          },
        });

        const { data: userData, error: userError } = await supabaseUser.auth.getUser();

        if (!userError && userData?.user) {
          const userId = userData.user.id;

          // Look up tenant by owner_id
          const { data: tenantData, error: tenantError } = await supabaseAdmin
            .from("tenants")
            .select("id, slug, owner_id")
            .eq("owner_id", userId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!tenantError && tenantData) {
            return {
              tenantId: tenantData.id,
              tenantSlug: tenantData.slug,
              source: "auth",
              ownerUserId: tenantData.owner_id,
            };
          }
        }
      }
    } catch (err) {
      console.warn("[tenant.ts] Error resolving tenant from auth:", err);
    }
  }

  // 5. Fallback to default
  return {
    tenantId: DEFAULT_TENANT_ID,
    tenantSlug: null,
    source: "default",
  };
}

/**
 * Get admin_settings for a specific tenant.
 * Returns { data, error } similar to Supabase query result.
 */
export async function getAdminSettingsForTenant(
  supabaseAdmin: SupabaseClient,
  tenantId: string,
  select = "*"
): Promise<{ data: Record<string, unknown> | null; error: Error | null }> {
  try {
    const { data, error } = await supabaseAdmin
      .from("admin_settings")
      .select(select)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Get admin_settings for a tenant, throwing an error if not found.
 * Use this when settings are required for the function to proceed.
 */
export async function requireAdminSettingsForTenant(
  supabaseAdmin: SupabaseClient,
  tenantId: string,
  select = "*"
): Promise<Record<string, unknown>> {
  const { data, error } = await getAdminSettingsForTenant(supabaseAdmin, tenantId, select);

  if (error) {
    throw new Error(`Failed to load admin settings for tenant ${tenantId}: ${error.message}`);
  }

  if (!data) {
    throw new Error(`Admin settings not found for tenant ${tenantId}. Please configure settings first.`);
  }

  return data;
}
