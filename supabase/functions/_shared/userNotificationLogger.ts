/**
 * User Notification Logger
 * 
 * Logs all Telegram sendMessage events to system_logs for audit trail.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type NotificationKey =
  | "payment_success"
  | "payment_failed"
  | "auto_payment_reminder"
  | "single_expiry_reminder"
  | "grace_warning"
  | "subscription_expired"
  | "subscription_renewed"
  | "subscription_cancelled"
  | "invite_sent"
  | "new_subscriber";

export interface LogUserNotificationOptions {
  supabaseAdmin: SupabaseClient;
  source: string;
  notificationKey: NotificationKey;
  subscriberId?: string | null;
  telegramUserId?: number | string | null;
  tierId?: string | null;
  subscriptionEnd?: string | null;
  days?: number | null;
  telegramOk: boolean;
  telegramError?: string | null;
  textPreview?: string | null;
}

/**
 * Log a user notification event to system_logs
 * Never throws - all errors are silently logged to console
 */
export async function logUserNotification(opts: LogUserNotificationOptions): Promise<void> {
  try {
    const {
      supabaseAdmin,
      source,
      notificationKey,
      subscriberId,
      telegramUserId,
      tierId,
      subscriptionEnd,
      days,
      telegramOk,
      telegramError,
      textPreview,
    } = opts;

    const level = telegramOk ? "info" : "warn";
    const message = telegramOk
      ? `User notification sent: ${notificationKey}`
      : `User notification failed: ${notificationKey}`;

    await supabaseAdmin.from("system_logs").insert({
      level,
      event_type: "telegram.user_notification_sent",
      source,
      subscriber_id: subscriberId || null,
      telegram_user_id: telegramUserId ? Number(telegramUserId) : null,
      tier_id: tierId || null,
      message,
      payload: {
        notification_key: notificationKey,
        subscription_end: subscriptionEnd || null,
        days: days ?? null,
        telegram_ok: telegramOk,
        telegram_error: telegramError || null,
        text_preview: textPreview ? textPreview.substring(0, 120) : null,
      },
    });
  } catch (err) {
    console.warn("[logUserNotification] Failed to log:", err);
  }
}
