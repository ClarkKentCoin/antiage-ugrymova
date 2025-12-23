-- Create invite_links table to track invite links
CREATE TABLE public.invite_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID REFERENCES public.subscribers(id) ON DELETE CASCADE NOT NULL,
  invite_link TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN DEFAULT FALSE NOT NULL,
  revoked_at TIMESTAMPTZ
);

-- Create indexes for efficient queries
CREATE INDEX idx_invite_links_subscriber ON public.invite_links(subscriber_id);
CREATE INDEX idx_invite_links_not_revoked ON public.invite_links(subscriber_id) WHERE revoked = false;

-- Enable RLS
ALTER TABLE public.invite_links ENABLE ROW LEVEL SECURITY;

-- RLS policy for admins
CREATE POLICY "Admins can manage invite_links"
ON public.invite_links
FOR ALL
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Service role policy for edge functions
CREATE POLICY "Service role can manage invite_links"
ON public.invite_links
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);