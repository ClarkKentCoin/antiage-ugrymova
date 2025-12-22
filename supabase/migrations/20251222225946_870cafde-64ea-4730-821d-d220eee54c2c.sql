-- Add welcome_message_button_url column to admin_settings
ALTER TABLE public.admin_settings 
ADD COLUMN welcome_message_button_url TEXT;