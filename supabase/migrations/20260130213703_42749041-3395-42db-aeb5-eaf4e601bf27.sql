-- Step 1.1: Add notification template for single expiry
ALTER TABLE public.admin_settings 
ADD COLUMN IF NOT EXISTS notification_subscription_expiring_single text NULL;

-- Step 1.2: Add flag for single expiry notification sent
ALTER TABLE public.subscribers 
ADD COLUMN IF NOT EXISTS single_expiry_notification_sent boolean NOT NULL DEFAULT false;