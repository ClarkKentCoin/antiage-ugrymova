import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface ChatMessage {
  id: string;
  thread_id: string;
  tenant_id: string;
  direction: string;
  sender_type: string;
  message_type: string;
  text_content: string | null;
  telegram_message_id: number | null;
  is_read_by_admin: boolean;
  read_by_admin_at: string | null;
  telegram_status: string | null;
  created_at: string;
}

export function useChatMessages(threadId: string | null) {
  const { tenantId } = useAuth();

  return useQuery<ChatMessage[]>({
    queryKey: ['chat-messages', tenantId, threadId],
    enabled: !!tenantId && !!threadId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('tenant_id', tenantId!)
        .eq('thread_id', threadId!)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return (data ?? []) as ChatMessage[];
    },
  });
}
