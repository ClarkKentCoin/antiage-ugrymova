-- Drop the restrictive check constraint on payment_method
ALTER TABLE public.payment_history DROP CONSTRAINT IF EXISTS payment_history_payment_method_check;

-- Add a more permissive check constraint that includes robokassa methods
ALTER TABLE public.payment_history ADD CONSTRAINT payment_history_payment_method_check 
CHECK (payment_method IN ('manual', 'robokassa', 'robokassa_single', 'robokassa_recurring'));