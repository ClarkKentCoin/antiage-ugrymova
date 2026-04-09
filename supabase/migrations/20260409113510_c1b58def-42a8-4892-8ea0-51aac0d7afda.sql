ALTER TABLE public.admin_settings
  ADD COLUMN IF NOT EXISTS chat_notifications_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS chat_notification_telegram_chat_id text,
  ADD COLUMN IF NOT EXISTS chat_sound_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS chat_browser_notifications_enabled boolean NOT NULL DEFAULT false;