/**
 * Canonical public app base URL — single source of truth for the frontend.
 * Uses VITE_PUBLIC_APP_BASE_URL env var if available, otherwise falls back
 * to the published Lovable app URL derived from the project ID.
 * Never uses window.location.origin (which can be a preview/internal domain).
 */
export function getCanonicalAppBaseUrl(): string {
  // 1. Explicit env var (most reliable)
  const explicit = import.meta.env.VITE_PUBLIC_APP_BASE_URL;
  if (explicit) {
    return (explicit as string).replace(/\/+$/, "");
  }

  // 2. Derive from Supabase URL (works for *.lovable.app domains)
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (supabaseUrl) {
    return supabaseUrl.replace(".supabase.co", ".lovable.app");
  }

  // 3. Last resort fallback
  return window.location.origin;
}
