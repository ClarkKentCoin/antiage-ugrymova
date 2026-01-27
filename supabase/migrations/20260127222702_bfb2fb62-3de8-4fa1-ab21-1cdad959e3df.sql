-- Enable RLS on subscribers table (idempotent)
ALTER TABLE public.subscribers ENABLE ROW LEVEL SECURITY;

-- Drop dangerous policy if exists
DROP POLICY IF EXISTS "Users can view own subscription by telegram_user_id" ON public.subscribers;

-- Drop existing ALL policy to replace with granular ones
DROP POLICY IF EXISTS "Admins can manage subscribers" ON public.subscribers;

-- Create explicit admin-only policies for each operation
CREATE POLICY "Admins can select subscribers"
ON public.subscribers
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can insert subscribers"
ON public.subscribers
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update subscribers"
ON public.subscribers
FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete subscribers"
ON public.subscribers
FOR DELETE
USING (public.has_role(auth.uid(), 'admin'::public.app_role));