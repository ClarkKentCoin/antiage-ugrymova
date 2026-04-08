import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Subscribes to realtime changes on chat_messages and chat_threads
 * for the given tenant. Invalidates react-query caches so the UI
 * updates automatically.
 */
export function useChatRealtime(tenantId: string | null, selectedThreadId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!tenantId) return;

    const channel = supabase
      .channel(`chat-realtime-${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_threads',
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['chat-threads', tenantId] });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          const threadId = (payload.new as { thread_id?: string })?.thread_id;
          // Refresh messages for the currently selected thread
          if (threadId && threadId === selectedThreadId) {
            queryClient.invalidateQueries({ queryKey: ['chat-messages', tenantId, threadId] });
          }
          // Thread list is already handled by the chat_threads subscription above
          // but force refresh just in case the thread update hasn't propagated yet
          queryClient.invalidateQueries({ queryKey: ['chat-threads', tenantId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, selectedThreadId, queryClient]);
}
