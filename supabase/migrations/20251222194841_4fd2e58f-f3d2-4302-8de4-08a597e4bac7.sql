-- Fix: Remove public access to subscribers table
-- The policy "Users can view own subscription by telegram_user_id" with USING(true) exposes all subscriber data
-- Only admins should be able to view subscriber information

DROP POLICY IF EXISTS "Users can view own subscription by telegram_user_id" ON public.subscribers;

-- Note: The existing "Admins can manage subscribers" policy already handles admin access for ALL operations
-- No additional policy needed as admins already have full access