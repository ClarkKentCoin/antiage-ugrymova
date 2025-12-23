-- Add phone_number column to subscribers table
ALTER TABLE public.subscribers ADD COLUMN IF NOT EXISTS phone_number TEXT;