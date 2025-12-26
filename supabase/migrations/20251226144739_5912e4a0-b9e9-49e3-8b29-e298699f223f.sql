-- Remove the overly permissive policy that allows public read access to all subscriber data
DROP POLICY IF EXISTS "Users can view own subscription by telegram_user_id" ON public.subscribers;