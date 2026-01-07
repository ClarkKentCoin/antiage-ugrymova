-- Fix system_logs security: Remove overly permissive policy and restrict to service_role

-- Drop the overly permissive policy that allows public access
DROP POLICY IF EXISTS "Service role can manage logs" ON public.system_logs;

-- Recreate the policy correctly - targeted ONLY at service_role
-- This allows Edge Functions and DB triggers (running as service_role) to INSERT logs
CREATE POLICY "Service role can manage logs"
ON public.system_logs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- The existing policies are correct:
-- - "Admins can read logs" (SELECT for admins via has_role check)
-- - "Admins can insert logs" (INSERT for admins via has_role check)
-- 
-- After this fix:
-- - Anonymous users: NO access
-- - Authenticated non-admin users: NO access  
-- - Authenticated admin users: SELECT + INSERT only
-- - Service role (Edge Functions, triggers): ALL operations