/**
 * Always-visible build badge for MiniApp diagnostics.
 * Shows build hash (from Vite script URL), mode, and tenant slug.
 * No sensitive data (no user_id, tokens, etc.)
 */

import { useMemo } from 'react';

// Extract asset hash from the main Vite script URL
function getAssetHash(): string {
  try {
    const scripts = document.querySelectorAll('script[type="module"][src]');
    for (const script of scripts) {
      const src = script.getAttribute('src');
      if (src && src.includes('/assets/')) {
        // Match pattern like /assets/index-abc123.js or /assets/main-def456.js
        const match = src.match(/\/assets\/[^-]+-([a-zA-Z0-9]+)\.js/);
        if (match && match[1]) {
          return match[1].slice(0, 8); // First 8 chars of hash
        }
      }
    }
  } catch (e) {
    console.warn('[MiniAppBuildBadge] Failed to extract asset hash:', e);
  }
  return 'dev';
}

// Get tenant slug from URL param 't'
function getTenantSlug(): string | null {
  return new URLSearchParams(window.location.search).get('t');
}

export function MiniAppBuildBadge() {
  const assetHash = useMemo(() => getAssetHash(), []);
  const tenantSlug = useMemo(() => getTenantSlug(), []);
  const mode = import.meta.env.MODE;

  return (
    <div 
      className="fixed bottom-2 right-2 z-50 px-2 py-1.5 rounded-md bg-black/40 backdrop-blur-sm text-[10px] font-mono leading-tight text-white/60 pointer-events-none select-none"
      style={{ opacity: 0.6 }}
    >
      <div>Build: {assetHash}</div>
      <div>Mode: {mode}</div>
      {tenantSlug && <div>t: {tenantSlug}</div>}
    </div>
  );
}
