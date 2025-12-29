-- ============================================
-- TRIGGER FUNCTION for logging subscriber changes
-- ============================================

CREATE OR REPLACE FUNCTION public.log_subscriber_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Log status changes
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.system_logs (
      level,
      event_type,
      source,
      subscriber_id,
      telegram_user_id,
      tier_id,
      message,
      payload
    ) VALUES (
      'info',
      'subscriber.status_changed',
      'db_trigger',
      NEW.id,
      NEW.telegram_user_id,
      NEW.tier_id,
      'Status changed from ' || COALESCE(OLD.status, 'null') || ' to ' || COALESCE(NEW.status, 'null'),
      jsonb_build_object(
        'old_status', OLD.status,
        'new_status', NEW.status,
        'old_is_in_channel', OLD.is_in_channel,
        'new_is_in_channel', NEW.is_in_channel,
        'telegram_username', NEW.telegram_username,
        'email', NEW.email
      )
    );
  END IF;

  -- Log auto_renewal changes
  IF OLD.auto_renewal IS DISTINCT FROM NEW.auto_renewal THEN
    INSERT INTO public.system_logs (
      level,
      event_type,
      source,
      subscriber_id,
      telegram_user_id,
      tier_id,
      message,
      payload
    ) VALUES (
      'info',
      'subscriber.auto_renewal_changed',
      'db_trigger',
      NEW.id,
      NEW.telegram_user_id,
      NEW.tier_id,
      'Auto renewal changed from ' || COALESCE(OLD.auto_renewal::text, 'null') || ' to ' || COALESCE(NEW.auto_renewal::text, 'null'),
      jsonb_build_object(
        'old_auto_renewal', OLD.auto_renewal,
        'new_auto_renewal', NEW.auto_renewal,
        'telegram_username', NEW.telegram_username,
        'email', NEW.email
      )
    );
  END IF;

  -- Log is_in_channel changes
  IF OLD.is_in_channel IS DISTINCT FROM NEW.is_in_channel THEN
    INSERT INTO public.system_logs (
      level,
      event_type,
      source,
      subscriber_id,
      telegram_user_id,
      tier_id,
      message,
      payload
    ) VALUES (
      'info',
      'subscriber.is_in_channel_changed',
      'db_trigger',
      NEW.id,
      NEW.telegram_user_id,
      NEW.tier_id,
      'is_in_channel changed from ' || COALESCE(OLD.is_in_channel::text, 'null') || ' to ' || COALESCE(NEW.is_in_channel::text, 'null'),
      jsonb_build_object(
        'old_is_in_channel', OLD.is_in_channel,
        'new_is_in_channel', NEW.is_in_channel,
        'telegram_username', NEW.telegram_username,
        'email', NEW.email
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================
-- CREATE TRIGGER on subscribers table
-- ============================================

DROP TRIGGER IF EXISTS tr_log_subscriber_changes ON public.subscribers;

CREATE TRIGGER tr_log_subscriber_changes
  AFTER UPDATE ON public.subscribers
  FOR EACH ROW
  EXECUTE FUNCTION public.log_subscriber_changes();

-- ============================================
-- ADD INDEXES to system_logs for performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_system_logs_created_at_desc ON public.system_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_event_type ON public.system_logs (event_type);
CREATE INDEX IF NOT EXISTS idx_system_logs_source ON public.system_logs (source);
CREATE INDEX IF NOT EXISTS idx_system_logs_subscriber_id ON public.system_logs (subscriber_id);