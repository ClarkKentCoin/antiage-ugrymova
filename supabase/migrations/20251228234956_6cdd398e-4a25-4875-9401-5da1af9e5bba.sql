-- Create table for system audit logs
CREATE TABLE public.system_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  level text NOT NULL DEFAULT 'info',
  event_type text NOT NULL,
  source text NOT NULL,
  subscriber_id uuid NULL REFERENCES public.subscribers(id) ON DELETE SET NULL,
  telegram_user_id bigint NULL,
  tier_id uuid NULL REFERENCES public.subscription_tiers(id) ON DELETE SET NULL,
  request_id text NULL,
  message text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Create indexes for common queries
CREATE INDEX idx_system_logs_created_at ON public.system_logs(created_at DESC);
CREATE INDEX idx_system_logs_event_type ON public.system_logs(event_type);
CREATE INDEX idx_system_logs_subscriber_id ON public.system_logs(subscriber_id);
CREATE INDEX idx_system_logs_telegram_user_id ON public.system_logs(telegram_user_id);
CREATE INDEX idx_system_logs_source ON public.system_logs(source);
CREATE INDEX idx_system_logs_level ON public.system_logs(level);
CREATE INDEX idx_system_logs_request_id ON public.system_logs(request_id);

-- Enable Row Level Security
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Only admins can read logs
CREATE POLICY "Admins can read logs"
ON public.system_logs
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- RLS Policy: Only admins can insert logs (from frontend)
CREATE POLICY "Admins can insert logs"
ON public.system_logs
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- RLS Policy: Service role can manage logs (for edge functions)
CREATE POLICY "Service role can manage logs"
ON public.system_logs
FOR ALL
USING (true)
WITH CHECK (true);