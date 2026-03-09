
-- Create subscriber_messages table for custom admin messages
CREATE TABLE public.subscriber_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  subscriber_id uuid REFERENCES public.subscribers(id) ON DELETE CASCADE NOT NULL,
  telegram_user_id bigint NOT NULL,
  direction text NOT NULL DEFAULT 'outbound',
  message_text text NOT NULL,
  parse_mode text DEFAULT 'HTML',
  telegram_message_id bigint,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  sent_by_user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.subscriber_messages ENABLE ROW LEVEL SECURITY;

-- Admin-only access scoped by tenant
CREATE POLICY "Admins manage own tenant messages"
ON public.subscriber_messages
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) AND tenant_id = current_tenant_id())
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND tenant_id = current_tenant_id());

-- Service role full access
CREATE POLICY "Service role full access subscriber_messages"
ON public.subscriber_messages
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
