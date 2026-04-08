import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface ChatThread {
  id: string;
  tenant_id: string;
  subscriber_id: string | null;
  telegram_user_id: number;
  status: string;
  source_type: string;
  last_message_at: string | null;
  last_message_direction: string | null;
  last_message_preview: string | null;
  admin_unread_count: number;
  bot_blocked: boolean;
  created_at: string;
  updated_at: string;
  // joined subscriber data
  subscriber?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    telegram_username: string | null;
    email: string | null;
    phone_number: string | null;
    status: string | null;
    tier_id: string | null;
    subscription_start: string | null;
    subscription_end: string | null;
  } | null;
}

export function useChatThreads() {
  const { tenantId } = useAuth();

  return useQuery<ChatThread[]>({
    queryKey: ['chat-threads', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chat_threads')
        .select(`
          *,
          subscriber:subscribers (
            id,
            first_name,
            last_name,
            telegram_username,
            email,
            phone_number,
            status,
            tier_id,
            subscription_start,
            subscription_end
          )
        `)
        .eq('tenant_id', tenantId!)
        .order('last_message_at', { ascending: false, nullsFirst: false });

      if (error) throw error;
      return (data ?? []) as unknown as ChatThread[];
    },
  });
}
