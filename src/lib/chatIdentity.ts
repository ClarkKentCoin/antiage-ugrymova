import type { ChatThread } from '@/hooks/useChatThreads';

/**
 * Preferred display name for a chat thread.
 * Priority:
 *  1. subscriber.first_name + last_name
 *  2. subscriber.telegram_username
 *  3. subscriber.email
 *  4. chat_threads.telegram_first_name + telegram_last_name
 *  5. chat_threads.telegram_username
 *  6. Telegram #telegram_user_id
 */
export function getThreadDisplayName(thread: ChatThread): string {
  const sub = thread.subscriber;
  if (sub) {
    const parts = [sub.first_name, sub.last_name].filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
    if (sub.telegram_username) return `@${sub.telegram_username}`;
    if (sub.email) return sub.email;
  }
  const tgParts = [thread.telegram_first_name, thread.telegram_last_name].filter(Boolean);
  if (tgParts.length > 0) return tgParts.join(' ');
  if (thread.telegram_username) return `@${thread.telegram_username}`;
  return `Telegram #${thread.telegram_user_id}`;
}

/**
 * Username (without leading @) if available, else null.
 * Prefer subscriber, fall back to thread Telegram identity.
 */
export function getThreadUsername(thread: ChatThread): string | null {
  const u = thread.subscriber?.telegram_username ?? thread.telegram_username ?? null;
  if (!u) return null;
  return u.replace(/^@+/, '');
}

/**
 * Two-letter initials for avatar fallback.
 */
export function getThreadInitials(thread: ChatThread): string {
  const sub = thread.subscriber;
  if (sub?.first_name) {
    return (sub.first_name[0] + (sub.last_name?.[0] ?? '')).toUpperCase();
  }
  if (thread.telegram_first_name) {
    return (thread.telegram_first_name[0] + (thread.telegram_last_name?.[0] ?? '')).toUpperCase();
  }
  const uname = getThreadUsername(thread);
  if (uname) return uname.slice(0, 2).toUpperCase();
  return 'T';
}
