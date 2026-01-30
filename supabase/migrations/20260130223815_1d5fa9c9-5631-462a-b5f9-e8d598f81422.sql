-- Add single_reminder_days_before column to admin_settings
ALTER TABLE public.admin_settings 
ADD COLUMN IF NOT EXISTS single_reminder_days_before integer NULL;

-- Add CHECK constraint for valid range 0-90
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'valid_single_reminder_days'
  ) THEN
    ALTER TABLE public.admin_settings 
    ADD CONSTRAINT valid_single_reminder_days 
    CHECK (single_reminder_days_before IS NULL OR (single_reminder_days_before >= 0 AND single_reminder_days_before <= 90));
  END IF;
END $$;