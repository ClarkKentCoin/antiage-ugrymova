-- Fix: Remove public access to payment_history table
-- Only admins should be able to view payment history

DROP POLICY IF EXISTS "Public can view payment history" ON payment_history;

-- Create restrictive policy: only admins can view all payment history
CREATE POLICY "Only admins can view payment history" 
ON public.payment_history 
FOR SELECT 
USING (has_role(auth.uid(), 'admin'::app_role));