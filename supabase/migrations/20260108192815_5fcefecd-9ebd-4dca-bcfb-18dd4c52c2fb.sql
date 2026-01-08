-- 1) Add Telegram admin notification settings to admin_settings
ALTER TABLE public.admin_settings
  ADD COLUMN IF NOT EXISTS telegram_admin_notifications_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.admin_settings
  ADD COLUMN IF NOT EXISTS telegram_admin_notifications_channel_id text;

-- 2) Create admin notification log table for deduplication
CREATE TABLE IF NOT EXISTS public.admin_notification_log (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,
  subscriber_id uuid NULL,
  payment_id uuid NULL,
  related_at timestamptz NULL,
  payload jsonb NULL
);

-- 3) Unique index to prevent duplicate notifications
CREATE UNIQUE INDEX IF NOT EXISTS admin_notification_log_dedupe
ON public.admin_notification_log (event_type, subscriber_id, payment_id, related_at);

-- 4) Enable RLS
ALTER TABLE public.admin_notification_log ENABLE ROW LEVEL SECURITY;

-- 5) Drop any existing policies to avoid accidental wide access
DROP POLICY IF EXISTS "Admins can manage admin_notification_log" ON public.admin_notification_log;
DROP POLICY IF EXISTS "Service role can manage admin_notification_log" ON public.admin_notification_log;

-- 6) Admin-only access policy (uses existing has_role helper)
CREATE POLICY "Admins can manage admin_notification_log"
ON public.admin_notification_log
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 7) Service role access for Edge Functions ONLY (SAFE)
CREATE POLICY "Service role can manage admin_notification_log"
ON public.admin_notification_log
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);