-- Add payment_link column for manual payment URL
ALTER TABLE public.admin_settings 
ADD COLUMN IF NOT EXISTS payment_link TEXT;