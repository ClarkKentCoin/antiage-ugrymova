-- Add calendar interval fields to subscription_tiers
ALTER TABLE public.subscription_tiers
ADD COLUMN interval_unit text NOT NULL DEFAULT 'day',
ADD COLUMN interval_count integer NOT NULL DEFAULT 1,
ADD COLUMN billing_timezone text NOT NULL DEFAULT 'Europe/Moscow';

-- Add CHECK constraint for interval_unit
ALTER TABLE public.subscription_tiers
ADD CONSTRAINT subscription_tiers_interval_unit_check 
CHECK (interval_unit IN ('day', 'week', 'month', 'year'));

-- Backfill existing tiers based on duration_days
UPDATE public.subscription_tiers
SET 
  interval_unit = CASE 
    WHEN duration_days = 30 THEN 'month'
    WHEN duration_days = 365 THEN 'year'
    ELSE 'day'
  END,
  interval_count = CASE 
    WHEN duration_days = 30 THEN 1
    WHEN duration_days = 365 THEN 1
    ELSE duration_days
  END;