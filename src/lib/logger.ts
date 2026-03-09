import { supabase } from '@/integrations/supabase/client';

export type LogLevel = 'info' | 'warn' | 'error';

export type EventSource = 
  | 'admin_ui' 
  | 'edge_fn' 
  | 'cron' 
  | 'robokassa' 
  | 'telegram_webhook';

export interface LogEventParams {
  level?: LogLevel;
  event_type: string;
  source: EventSource;
  subscriber_id?: string | null;
  telegram_user_id?: number | null;
  tier_id?: string | null;
  request_id?: string | null;
  tenant_id?: string | null;
  message?: string | null;
  payload?: Record<string, any>;
}

/**
 * Log an event to the system_logs table.
 * This is a best-effort logger - it will not throw errors or block the UI.
 */
export async function logEvent({
  level = 'info',
  event_type,
  source,
  subscriber_id = null,
  telegram_user_id = null,
  tier_id = null,
  request_id = null,
  tenant_id = null,
  message = null,
  payload = {},
}: LogEventParams): Promise<void> {
  try {
    // Check for duplicate (same request_id + event_type within short window)
    if (request_id) {
      const { data: existing } = await supabase
        .from('system_logs')
        .select('id')
        .eq('request_id', request_id)
        .eq('event_type', event_type)
        .limit(1)
        .maybeSingle();

      if (existing) {
        console.warn(`[logger] Duplicate log detected for request_id=${request_id}, event_type=${event_type}`);
        return;
      }
    }

    const { error } = await supabase
      .from('system_logs')
      .insert({
        level,
        event_type,
        source,
        subscriber_id,
        telegram_user_id,
        tier_id,
        request_id,
        message,
        payload,
        ...(tenant_id ? { tenant_id } : {}),
      });

    if (error) {
      console.warn('[logger] Failed to log event:', error.message);
    }
  } catch (err) {
    // Never let logging errors break the app
    console.warn('[logger] Exception while logging:', err);
  }
}

/**
 * Helper to create a request ID for deduplication
 */
export function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
