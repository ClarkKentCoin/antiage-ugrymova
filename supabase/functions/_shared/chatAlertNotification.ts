/**
 * Chat alert notification — sends a Telegram message to a SEPARATE
 * admin chat destination when a new incoming user message arrives.
 *
 * Anti-spam: only sends when admin_unread_count transitions from 0 → 1
 * (i.e. first unread message in a thread).
 *
 * Safe, additive, never throws.
 */

interface ChatAlertOptions {
  supabaseAdmin: any;
  tenantId: string;
  botToken: string;
  chatAlertDestination: string;
  subscriberName: string;
  subscriberUsername: string | null;
  messagePreview: string;
  threadId: string;
}

/**
 * Normalize Telegram chat ID for channels.
 */
function normalizeChatId(channelId: string): string {
  if (channelId.startsWith("-") && !channelId.startsWith("-100")) {
    return "-100" + channelId.slice(1);
  }
  return channelId;
}

/**
 * Send a compact chat alert to the admin's configured Telegram destination.
 * Returns true if sent, false otherwise. Never throws.
 */
export async function sendChatAlertNotification(
  opts: ChatAlertOptions
): Promise<boolean> {
  const tag = "[chatAlert]";
  try {
    const destination = normalizeChatId(opts.chatAlertDestination.trim());

    // Build compact message
    const nameDisplay = opts.subscriberName || "Неизвестный";
    const usernameDisplay = opts.subscriberUsername
      ? ` (@${opts.subscriberUsername.replace(/^@/, "")})`
      : "";
    const preview =
      opts.messagePreview.length > 120
        ? opts.messagePreview.substring(0, 119) + "…"
        : opts.messagePreview;

    const text = `💬 Новое сообщение в чат\n\nОт: ${nameDisplay}${usernameDisplay}\n\n${preview}`;

    const telegramUrl = `https://api.telegram.org/bot${opts.botToken}/sendMessage`;
    const response = await fetch(telegramUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: destination,
        text,
        disable_web_page_preview: true,
      }),
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
      console.error(`${tag} Telegram API error:`, JSON.stringify(result));

      // Log failure
      await opts.supabaseAdmin.from("system_logs").insert({
        level: "error",
        event_type: "chat.alert_failed",
        source: "chat_alert",
        tenant_id: opts.tenantId,
        message: `Chat alert send failed: ${result.description || "unknown"}`,
        payload: {
          thread_id: opts.threadId,
          destination,
          telegram_error: result.description,
        },
      });
      return false;
    }

    console.log(`${tag} sent to ${destination} for thread=${opts.threadId}`);

    // Log success
    await opts.supabaseAdmin.from("system_logs").insert({
      level: "info",
      event_type: "chat.alert_sent",
      source: "chat_alert",
      tenant_id: opts.tenantId,
      message: `Chat alert sent for thread ${opts.threadId}`,
      payload: {
        thread_id: opts.threadId,
        destination,
        subscriber_name: opts.subscriberName,
      },
    });

    return true;
  } catch (err) {
    console.error(`${tag} unexpected error:`, err);
    return false;
  }
}
