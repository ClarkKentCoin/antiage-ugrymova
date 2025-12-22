-- Add consent fields to subscribers
ALTER TABLE public.subscribers
ADD COLUMN IF NOT EXISTS auto_renewal_consent_date timestamp with time zone,
ADD COLUMN IF NOT EXISTS next_payment_notification_sent boolean DEFAULT false;

-- Create consent log table
CREATE TABLE IF NOT EXISTS public.subscription_consent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id uuid NOT NULL REFERENCES public.subscribers(id) ON DELETE CASCADE,
  consent_type text NOT NULL CHECK (consent_type IN ('auto_renewal_enabled', 'auto_renewal_disabled')),
  consent_date timestamp with time zone NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on consent log
ALTER TABLE public.subscription_consent_log ENABLE ROW LEVEL SECURITY;

-- Admin can view all consent logs
CREATE POLICY "Admins can view consent logs"
ON public.subscription_consent_log
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Admin can insert consent logs
CREATE POLICY "Admins can insert consent logs"
ON public.subscription_consent_log
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Service role can manage consent logs (for edge functions)
CREATE POLICY "Service role can manage consent logs"
ON public.subscription_consent_log
FOR ALL
USING (true)
WITH CHECK (true);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_consent_log_subscriber ON public.subscription_consent_log(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_consent_log_date ON public.subscription_consent_log(consent_date DESC);