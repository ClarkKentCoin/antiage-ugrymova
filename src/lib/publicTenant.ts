/**
 * Shared public tenant context helper for Mini App / public flows.
 * Reads tenant slug from URL query parameter `t`.
 * Dependency-free, safe for use in any component.
 */
export function getPublicTenantSlug(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('t');
  } catch {
    return null;
  }
}
