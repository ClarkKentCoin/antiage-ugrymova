/**
 * Canonical public app base URL — single source of truth for all edge functions.
 * Falls back to deriving from SUPABASE_URL if PUBLIC_APP_BASE_URL secret is not set.
 */
export function getCanonicalAppBaseUrl(): string {
  const explicit = Deno.env.get("PUBLIC_APP_BASE_URL");
  if (explicit) {
    // Strip trailing slash for consistency
    return explicit.replace(/\/+$/, "");
  }
  // Fallback: derive from Supabase URL (legacy behavior, less reliable for custom domains)
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  return supabaseUrl.replace(".supabase.co", ".lovable.app");
}
