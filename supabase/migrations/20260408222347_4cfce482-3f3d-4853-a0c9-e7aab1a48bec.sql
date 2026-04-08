
ALTER TABLE public.chat_threads 
  ADD COLUMN bot_contact_status text NOT NULL DEFAULT 'active';

UPDATE public.chat_threads 
  SET bot_contact_status = 'blocked' 
  WHERE bot_blocked = true;
