/**
 * Chat ingestion helper — persists incoming Telegram text messages
 * into chat_threads + chat_messages tables.
 *
 * Safe, additive, does not modify any existing tables or logic.
 */

import { sendChatAlertNotification } from "./chatAlertNotification.ts";

interface IncomingChatMessage {
  tenantId: string;
  telegramUserId: number;
  telegramMessageId: number;
  text: string;
  messageDate: number; // Unix timestamp from Telegram
}

/**
 * Truncate text to a safe preview length for last_message_preview.
 */
function truncatePreview(text: string, maxLen = 100): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 1) + "…";
}

/**
 * Persist an incoming Telegram text message into chat tables.
 *
 * Steps:
 * 1. Optionally resolve subscriber_id from subscribers table
 * 2. Find or create chat_thread
 * 3. Insert chat_message
 *
 * Fails safely — errors are logged but do not throw.
 * Returns true if message was persisted, false otherwise.
 */
export async function persistIncomingChatMessage(
  supabaseAdmin: any,
  msg: IncomingChatMessage
): Promise<boolean> {
  const tag = "[chatIngestion]";

  try {
    const { tenantId, telegramUserId, telegramMessageId, text, messageDate } = msg;
    const messageTimestamp = new Date(messageDate * 1000).toISOString();
    const preview = truncatePreview(text);

    // 1. Resolve subscriber (optional — null if not found)
    let subscriberId: string | null = null;
    const { data: subscriber } = await supabaseAdmin
      .from("subscribers")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();

    if (subscriber) {
      subscriberId = subscriber.id;
    }

    console.log(`${tag} tenant=${tenantId} tgUser=${telegramUserId} subscriber=${subscriberId ?? "none"}`);

    // 2. Find existing thread
    const threadFilter = {
      tenant_id: tenantId,
      telegram_user_id: telegramUserId,
      source_type: "telegram_bot",
    };

    const { data: existingThread, error: threadFetchErr } = await supabaseAdmin
      .from("chat_threads")
      .select("id, subscriber_id, admin_unread_count")
      .eq("tenant_id", tenantId)
      .eq("telegram_user_id", telegramUserId)
      .eq("source_type", "telegram_bot")
      .is("bot_id", null)
      .is("channel_id", null)
      .is("group_id", null)
      .maybeSingle();

    if (threadFetchErr) {
      console.error(`${tag} thread lookup error:`, threadFetchErr.message);
      return false;
    }

    let threadId: string;

    if (existingThread) {
      // Update existing thread
      const updatePayload: Record<string, any> = {
        last_message_at: messageTimestamp,
        last_message_direction: "incoming",
        last_message_preview: preview,
        admin_unread_count: (existingThread.admin_unread_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      };

      // Link subscriber if thread didn't have one yet
      if (!existingThread.subscriber_id && subscriberId) {
        updatePayload.subscriber_id = subscriberId;
      }

      // Clear bot_blocked — user just sent a message, so bot is active
      updatePayload.bot_blocked = false;
      updatePayload.bot_contact_status = "active";

      const { error: updateErr } = await supabaseAdmin
        .from("chat_threads")
        .update(updatePayload)
        .eq("id", existingThread.id);

      if (updateErr) {
        console.error(`${tag} thread update error:`, updateErr.message);
        return false;
      }

      threadId = existingThread.id;
      console.log(`${tag} updated thread=${threadId} unread=${updatePayload.admin_unread_count}`);
    } else {
      // Create new thread
      const newThread = {
        tenant_id: tenantId,
        subscriber_id: subscriberId,
        telegram_user_id: telegramUserId,
        status: "open",
        source_type: "telegram_bot",
        bot_id: null,
        channel_id: null,
        group_id: null,
        last_message_at: messageTimestamp,
        last_message_direction: "incoming",
        last_message_preview: preview,
        admin_unread_count: 1,
        bot_blocked: false,
        bot_contact_status: "active",
      };

      const { data: createdThread, error: createErr } = await supabaseAdmin
        .from("chat_threads")
        .insert(newThread)
        .select("id")
        .single();

      if (createErr) {
        console.error(`${tag} thread create error:`, createErr.message);
        return false;
      }

      threadId = createdThread.id;
      console.log(`${tag} created thread=${threadId}`);
    }

    // 3. Insert chat message
    const chatMessage = {
      tenant_id: tenantId,
      thread_id: threadId,
      direction: "incoming",
      sender_type: "user",
      telegram_message_id: telegramMessageId,
      message_type: "text",
      text_content: text,
      is_read_by_admin: false,
    };

    const { error: msgErr } = await supabaseAdmin
      .from("chat_messages")
      .insert(chatMessage);

    if (msgErr) {
      console.error(`${tag} message insert error:`, msgErr.message);
      return false;
    }

    console.log(`${tag} persisted message tgMsgId=${telegramMessageId} thread=${threadId}`);

    // 4. Send Telegram chat alert if this is the first unread message (anti-spam)
    // Only trigger when unread count went from 0 → 1
    const previousUnread = existingThread ? (existingThread.admin_unread_count ?? 0) : 0;
    if (previousUnread === 0) {
      try {
        // Load chat notification settings for this tenant
        const { data: alertSettings } = await supabaseAdmin
          .from("admin_settings")
          .select("telegram_bot_token, chat_notifications_enabled, chat_notification_telegram_chat_id")
          .eq("tenant_id", tenantId)
          .maybeSingle();

        if (
          alertSettings?.chat_notifications_enabled &&
          alertSettings?.telegram_bot_token &&
          alertSettings?.chat_notification_telegram_chat_id
        ) {
          // Resolve subscriber name for the alert
          let alertName = `Telegram #${telegramUserId}`;
          let alertUsername: string | null = null;
          if (subscriberId) {
            const { data: subInfo } = await supabaseAdmin
              .from("subscribers")
              .select("first_name, last_name, telegram_username")
              .eq("id", subscriberId)
              .maybeSingle();
            if (subInfo) {
              const parts = [subInfo.first_name, subInfo.last_name].filter(Boolean);
              if (parts.length > 0) alertName = parts.join(" ");
              alertUsername = subInfo.telegram_username ?? null;
            }
          }

          // Fire and forget — do not block ingestion
          sendChatAlertNotification({
            supabaseAdmin,
            tenantId,
            botToken: alertSettings.telegram_bot_token,
            chatAlertDestination: alertSettings.chat_notification_telegram_chat_id,
            subscriberName: alertName,
            subscriberUsername: alertUsername,
            messagePreview: preview,
            threadId,
          }).catch((err) => {
            console.error(`${tag} chat alert fire-and-forget error:`, err);
          });
        }
      } catch (alertErr) {
        console.error(`${tag} chat alert setup error:`, alertErr);
        // Non-blocking — ingestion already succeeded
      }
    }

    return true;
  } catch (err) {
    console.error(`${tag} unexpected error:`, err);
    return false;
  }
}
