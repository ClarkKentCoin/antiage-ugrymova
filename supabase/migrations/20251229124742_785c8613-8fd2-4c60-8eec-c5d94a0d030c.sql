-- Remove overly permissive RLS policies that expose sensitive data publicly
-- Edge functions use service role key which bypasses RLS, so this won't break functionality

-- Drop the overly permissive subscribers policy
DROP POLICY IF EXISTS "Users can view own subscription by telegram_user_id" ON public.subscribers;

-- Drop the overly permissive payment_history policy  
DROP POLICY IF EXISTS "Public can view payment history" ON public.payment_history;