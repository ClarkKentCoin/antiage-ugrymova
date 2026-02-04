/**
 * Always-visible build badge for MiniApp diagnostics.
 * Shows build hash (from Vite script URL), mode, tenant slug, and server debug info.
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

export interface ServerDebugInfo {
  function_version?: string;
  server_now?: string;
  expires_at_raw?: string | null;
  grace_end_at?: string | null;
  grace_days_remaining?: number | null;
  grace_ms_remaining?: number | null;
}

interface MiniAppBuildBadgeProps {
  serverDebug?: ServerDebugInfo | null;
}

export function MiniAppBuildBadge({ serverDebug }: MiniAppBuildBadgeProps) {
  const assetHash = useMemo(() => getAssetHash(), []);
  const tenantSlug = useMemo(() => getTenantSlug(), []);
  const mode = import.meta.env.MODE;

  return (
    <div 
      className="fixed bottom-2 right-2 z-50 px-2 py-1.5 rounded-md bg-black/60 backdrop-blur-sm text-[9px] font-mono leading-tight text-white/80 pointer-events-none select-none max-w-[200px]"
    >
      <div>Build: {assetHash}</div>
      <div>Mode: {mode}</div>
      {tenantSlug && <div>t: {tenantSlug}</div>}
      {serverDebug && (
        <>
          <div className="border-t border-white/20 my-1 pt-1">
            <div>fn: {serverDebug.function_version || '?'}</div>
            {serverDebug.server_now && <div>srv: {serverDebug.server_now.slice(11, 19)}</div>}
            {serverDebug.expires_at_raw && <div>exp: {serverDebug.expires_at_raw.slice(0, 10)}</div>}
            {serverDebug.grace_end_at && <div>grEnd: {serverDebug.grace_end_at.slice(0, 10)}</div>}
            <div>grDays: {serverDebug.grace_days_remaining ?? 'null'}</div>
          </div>
        </>
      )}
    </div>
  );
}
