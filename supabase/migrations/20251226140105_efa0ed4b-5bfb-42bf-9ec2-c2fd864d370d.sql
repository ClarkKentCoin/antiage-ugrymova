-- Drop the old constraint and add new one with grace_period
ALTER TABLE public.subscribers DROP CONSTRAINT subscribers_status_check;

ALTER TABLE public.subscribers ADD CONSTRAINT subscribers_status_check 
CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text, 'expired'::text, 'cancelled'::text, 'grace_period'::text]));