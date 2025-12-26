-- Add database CHECK constraints for input validation

-- Subscription tiers: validate price and duration
ALTER TABLE public.subscription_tiers 
  ADD CONSTRAINT positive_price CHECK (price >= 0),
  ADD CONSTRAINT positive_duration CHECK (duration_days > 0),
  ADD CONSTRAINT reasonable_duration CHECK (duration_days <= 3650);

-- Admin settings: validate grace period and reminder days
ALTER TABLE public.admin_settings
  ADD CONSTRAINT valid_grace_period CHECK (grace_period_days IS NULL OR (grace_period_days >= 0 AND grace_period_days <= 365)),
  ADD CONSTRAINT valid_reminder CHECK (reminder_days_before IS NULL OR (reminder_days_before >= 0 AND reminder_days_before <= 90));

-- Subscribers: validate telegram_user_id range
ALTER TABLE public.subscribers
  ADD CONSTRAINT valid_telegram_id CHECK (telegram_user_id > 0 AND telegram_user_id < 9999999999999);

-- Add explicit write policies for user_roles table (defense in depth)
-- Only admins can insert new roles
CREATE POLICY "Only admins can insert roles" 
ON public.user_roles 
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Only admins can update roles
CREATE POLICY "Only admins can update roles" 
ON public.user_roles 
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Only admins can delete roles
CREATE POLICY "Only admins can delete roles" 
ON public.user_roles 
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));