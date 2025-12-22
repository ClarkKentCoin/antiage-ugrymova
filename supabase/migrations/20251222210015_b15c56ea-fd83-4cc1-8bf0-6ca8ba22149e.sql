-- Add Robokassa fields to admin_settings
ALTER TABLE public.admin_settings 
ADD COLUMN IF NOT EXISTS robokassa_test_mode boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS robokassa_result_url text;

-- Create payment_method enum for subscribers
DO $$ BEGIN
  CREATE TYPE public.subscriber_payment_method AS ENUM ('manual', 'robokassa_single', 'robokassa_recurring');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create transaction_type enum for payments
DO $$ BEGIN
  CREATE TYPE public.payment_transaction_type AS ENUM ('initial', 'recurring');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create payment_status enum
DO $$ BEGIN
  CREATE TYPE public.payment_status AS ENUM ('pending', 'processing', 'completed', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add Robokassa fields to subscribers
ALTER TABLE public.subscribers 
ADD COLUMN IF NOT EXISTS robokassa_invoice_id text,
ADD COLUMN IF NOT EXISTS subscriber_payment_method text DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS auto_renewal boolean DEFAULT false;

-- Add Robokassa fields to payment_history
ALTER TABLE public.payment_history 
ADD COLUMN IF NOT EXISTS invoice_id text UNIQUE,
ADD COLUMN IF NOT EXISTS transaction_type text DEFAULT 'initial',
ADD COLUMN IF NOT EXISTS robokassa_data jsonb,
ADD COLUMN IF NOT EXISTS status text DEFAULT 'completed';

-- Create index on invoice_id for fast lookup
CREATE INDEX IF NOT EXISTS idx_payment_history_invoice_id ON public.payment_history(invoice_id);

-- Create index for recurring payment processing
CREATE INDEX IF NOT EXISTS idx_subscribers_auto_renewal ON public.subscribers(auto_renewal, status, subscription_end) 
WHERE auto_renewal = true AND status = 'active';