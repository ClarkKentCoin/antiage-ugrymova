/**
 * Admin Notifications Utility
 * 
 * Sends notifications to admin Telegram channel with deduplication.
 * Never throws exceptions - all errors are logged silently.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { formatDaysRu } from "./textFormatters.ts";

export type AdminNotificationEventType =
  | "PAYMENT_SUCCESS"
  | "PAYMENT_FAILED"
  | "EXPIRING_IN_3_DAYS"
  | "GRACE_STARTED"
  | "GRACE_ENDED"
  | "SUBSCRIPTION_ENDED"
  | "SUBSCRIPTION_CANCELLED"
  | "SUBSCRIPTION_RENEWED";

export type AdminNotificationSource =
  | "robokassa-webhook"
  | "notify-upcoming-payments"
  | "check-expired-subscriptions"
  | "process-recurring-payments"
  | "subscriber-status-change"
  | "cancel-subscription"
  | "notify-expiring-single-subscriptions";

export interface AdminNotificationSubscriber {
  id?: string | null;
  name?: string | null;
  username?: string | null;
  telegram_user_id?: string | number | null;
  email?: string | null;
}

export interface SendAdminNotificationOptions {
  supabaseAdmin: SupabaseClient;
  eventType: AdminNotificationEventType;
  subscriber: AdminNotificationSubscriber;
  plan?: string | null;
  status?: string | null;
  method?: string | null;
  amount?: string | number | null;
  subscriptionEndISO?: string | null;
  graceEndISO?: string | null;
  note?: string | null;
  paymentId?: string | null;
  relatedAtISO?: string | null;
  days?: number | null;
  source: AdminNotificationSource;
}

/**
 * Normalize Telegram channel ID
 * If starts with "-" but not "-100", convert to "-100" + rest
 */
function normalizeChatId(channelId: string): string {
  if (channelId.startsWith("-") && !channelId.startsWith("-100")) {
    return "-100" + channelId.slice(1);
  }
  return channelId;
}
const TIMEZONE = "Europe/Moscow";

/**
 * Format date from ISO string to readable format: DD.MM.YYYY HH:mm
 */
function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  try {
    const date = new Date(isoDate);
    return date.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: TIMEZONE,
    });
  } catch {
    return isoDate;
  }
}

/**
 * Format amount to 2 decimal places
 */
function formatAmount(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (isNaN(num)) return String(value);
  return num.toFixed(2);
}

/**
 * Safe string getter - returns "—" if null/undefined/empty
 */
function safe(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

/**
 * Build subscriber info block (always included in every message)
 */
function buildSubscriberBlock(subscriber: AdminNotificationSubscriber): string {
  const name = safe(subscriber.name);
  const username = subscriber.username ? `@${subscriber.username.replace(/^@/, "")}` : "—";
  const tgId = safe(subscriber.telegram_user_id);
  const email = safe(subscriber.email);

  return `---\nПодписчик:\nИмя: ${name}\nUsername: ${username}\nTG ID: ${tgId}\nEmail: ${email}`;
}

/**
 * Build message text based on event type
 */
function buildMessageText(opts: SendAdminNotificationOptions): string {
  const subscriberBlock = buildSubscriberBlock(opts.subscriber);
  const plan = safe(opts.plan);
  const status = safe(opts.status);
  const method = safe(opts.method);
  const amount = formatAmount(opts.amount);
  const subscriptionEnd = formatDate(opts.subscriptionEndISO);
  const graceEnd = formatDate(opts.graceEndISO);
  const note = safe(opts.note);

  switch (opts.eventType) {
    case "PAYMENT_SUCCESS":
      return `✅ Успешная покупка\nПлан: ${plan}\nСтатус: ${status}\nМетод: ${method}\nСумма: ${amount}\nПодписка до: ${subscriptionEnd}\nПримечание: ${note}\n${subscriberBlock}`;

    case "PAYMENT_FAILED":
      return `❌ Ошибка оплаты\nПлан: ${plan}\nМетод: ${method}\nСумма: ${amount}\nПримечание: ${note}\n${subscriberBlock}`;

    case "EXPIRING_IN_3_DAYS": {
      const daysLabel = opts.days != null ? ` (${formatDaysRu(opts.days)})` : "";
      return `⏳ Заканчивается подписка${daysLabel}\nПлан: ${plan}\nМетод: ${method}\nПодписка до: ${subscriptionEnd}\nСтатус: ${status}\n${subscriberBlock}`;
    }

    case "GRACE_STARTED":
      return `🟠 Начался grace-период\nПлан: ${plan}\nПодписка закончилась: ${subscriptionEnd}\nGrace до: ${graceEnd}\nСтатус: ${status}\n${subscriberBlock}`;

    case "GRACE_ENDED":
      return `🔴 Grace-период закончился\nПлан: ${plan}\nGrace до: ${graceEnd}\nСтатус: ${status}\n${subscriberBlock}`;

    case "SUBSCRIPTION_ENDED":
      return `⛔ Подписка завершена\nПлан: ${plan}\nСтатус: ${status}\n${subscriberBlock}`;

    case "SUBSCRIPTION_CANCELLED":
      return `🚫 Подписка отменена пользователем\nПлан: ${plan}\nСтатус: ${status}\n${subscriberBlock}`;

    case "SUBSCRIPTION_RENEWED":
      return `🔄 Подписка продлена\nПлан: ${plan}\nПодписка до: ${subscriptionEnd}\nСтатус: ${status}\n${subscriberBlock}`;

    default:
      return `📢 Уведомление: ${opts.eventType}\n${subscriberBlock}`;
  }
}

/**
 * Log to system_logs table
 */
async function logToSystem(
  supabaseAdmin: SupabaseClient,
  level: "info" | "warn" | "error",
  eventType: string,
  message: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await supabaseAdmin.from("system_logs").insert({
      level,
      event_type: eventType,
      source: "admin_notifications",
      message,
      payload,
    });
  } catch {
    // Silently ignore logging errors
  }
}

/**
 * Send notification to admin Telegram channel
 * 
 * IMPORTANT: This function NEVER throws exceptions.
 * All errors are logged silently and the function returns.
 */
export async function sendAdminNotification(
  opts: SendAdminNotificationOptions
): Promise<void> {
  const { supabaseAdmin, eventType, subscriber, source } = opts;

  try {
    // 1. Fetch admin settings
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("admin_settings")
      .select(
        "telegram_bot_token, telegram_admin_notifications_enabled, telegram_admin_notifications_channel_id"
      )
      .limit(1)
      .single();

    if (settingsError || !settings) {
      await logToSystem(supabaseAdmin, "warn", "telegram.admin_notification_failed", 
        "Failed to fetch admin settings", { error: settingsError?.message, source });
      return;
    }

    // 2. Check if notifications are enabled
    if (!settings.telegram_admin_notifications_enabled) {
      return; // Silently skip - notifications disabled
    }

    if (!settings.telegram_bot_token || !settings.telegram_admin_notifications_channel_id) {
      await logToSystem(supabaseAdmin, "warn", "telegram.admin_notification_failed",
        "Missing bot token or channel ID", { source });
      return;
    }

    const botToken = settings.telegram_bot_token;
    const channelId = normalizeChatId(settings.telegram_admin_notifications_channel_id);

    // 3. Deduplication - try to insert into admin_notification_log
    const payload = {
      source,
      plan: opts.plan ?? null,
      status: opts.status ?? null,
      method: opts.method ?? null,
      amount: opts.amount ?? null,
      subscriptionEndISO: opts.subscriptionEndISO ?? null,
      graceEndISO: opts.graceEndISO ?? null,
    };

    const { error: dedupeError } = await supabaseAdmin
      .from("admin_notification_log")
      .insert({
        event_type: eventType,
        subscriber_id: subscriber.id ?? null,
        payment_id: opts.paymentId ?? null,
        related_at: opts.relatedAtISO ?? null,
        payload,
      });

    // If unique constraint violation - already sent, skip silently
    if (dedupeError) {
      if (dedupeError.code === "23505") {
        // Unique violation - already processed
        return;
      }
      // Other error - log but continue (non-critical)
      await logToSystem(supabaseAdmin, "warn", "telegram.admin_notification_dedupe_error",
        "Deduplication insert failed", { error: dedupeError.message, eventType, source });
      // Continue anyway - better to send duplicate than miss notification
    }

    // 4. Build message text
    const messageText = buildMessageText(opts);

    // 5. Send to Telegram (plain text, no parse_mode)
    const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const telegramResponse = await fetch(telegramUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: channelId,
        text: messageText,
        disable_web_page_preview: true,
      }),
    });

    const telegramResult = await telegramResponse.json();

    if (!telegramResponse.ok || !telegramResult.ok) {
      await logToSystem(supabaseAdmin, "error", "telegram.admin_notification_failed",
        "Telegram API error", {
          eventType,
          source,
          subscriberId: subscriber.id,
          telegramError: telegramResult,
        });
      return;
    }

    // 6. Log success
    await logToSystem(supabaseAdmin, "info", "telegram.admin_notification_sent",
      `Admin notification sent: ${eventType}`, {
        eventType,
        source,
        subscriberId: subscriber.id,
        channelId,
      });

  } catch (error) {
    // Catch-all: never throw, just log
    try {
      await logToSystem(supabaseAdmin, "error", "telegram.admin_notification_failed",
        "Unexpected error in sendAdminNotification", {
          eventType,
          source,
          subscriberId: subscriber?.id,
          error: error instanceof Error ? error.message : String(error),
        });
    } catch {
      // Even logging failed - silently ignore
    }
  }
}
