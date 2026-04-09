import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export function useMarkThreadRead() {
  const { tenantId } = useAuth();
  const queryClient = useQueryClient();

  const markRead = useCallback(async (threadId: string) => {
    if (!tenantId || !threadId) return;

    // Mark all unread incoming messages in this thread as read
    const { error: msgError } = await supabase
      .from('chat_messages')
      .update({
        is_read_by_admin: true,
        read_by_admin_at: new Date().toISOString(),
      })
      .eq('thread_id', threadId)
      .eq('tenant_id', tenantId)
      .eq('is_read_by_admin', false)
      .eq('direction', 'incoming');

    if (msgError) {
      console.error('[useMarkThreadRead] Failed to mark messages read:', msgError);
      return;
    }

    // Reset thread unread count
    const { error: threadError } = await supabase
      .from('chat_threads')
      .update({ admin_unread_count: 0 })
      .eq('id', threadId)
      .eq('tenant_id', tenantId);

    if (threadError) {
      console.error('[useMarkThreadRead] Failed to reset thread unread count:', threadError);
      return;
    }

    // Invalidate queries to refresh UI
    queryClient.invalidateQueries({ queryKey: ['chat-threads', tenantId] });
    queryClient.invalidateQueries({ queryKey: ['chat-messages', tenantId, threadId] });
    queryClient.invalidateQueries({ queryKey: ['chat-unread-count', tenantId] });
  }, [tenantId, queryClient]);

  return { markRead };
}
