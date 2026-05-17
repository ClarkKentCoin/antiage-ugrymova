import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Subscribes to realtime changes on chat_messages and chat_threads
 * for the given tenant. Invalidates react-query caches so the UI
 * updates automatically.
 *
 * When a new incoming message arrives on the currently selected thread,
 * calls onIncomingForSelected so the caller can auto-mark it read.
 */
export function useChatRealtime(
  tenantId: string | null,
  selectedThreadId: string | null,
  onIncomingForSelected?: () => void
) {
  const queryClient = useQueryClient();
  // Use ref so channel callback always sees latest callback without re-subscribing
  const callbackRef = useRef(onIncomingForSelected);
  callbackRef.current = onIncomingForSelected;

  useEffect(() => {
    if (!tenantId) return;

    let cancelled = false;
    let activeChannel: ReturnType<typeof supabase.channel> | null = null;

    const setup = async () => {
      try {
        const rt = (supabase as any).realtime;
        if (rt && typeof rt.setAuth === 'function') {
          await rt.setAuth();
        }
      } catch {
        console.warn('[chat realtime] setAuth failed', { hasTenant: !!tenantId });
      }

      if (cancelled) return;

      const channel = supabase
        .channel(`chat-realtime-${tenantId}`, { config: { private: true } })
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
            const row = payload.new as { thread_id?: string; direction?: string };
            const threadId = row?.thread_id;

            if (threadId && threadId === selectedThreadId) {
              queryClient.invalidateQueries({ queryKey: ['chat-messages', tenantId, threadId] });
              if (row.direction === 'incoming' && callbackRef.current) {
                callbackRef.current();
              }
            }
            queryClient.invalidateQueries({ queryKey: ['chat-threads', tenantId] });
          }
        )
        .subscribe((status) => {
          console.info('[chat realtime] subscription status', { channel: 'chat-realtime', status });
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[chat realtime] subscription problem', { status, hasTenant: !!tenantId });
          }
        });

      activeChannel = channel;
    };

    setup();

    return () => {
      cancelled = true;
      if (activeChannel) {
        supabase.removeChannel(activeChannel);
      }
    };
  }, [tenantId, selectedThreadId, queryClient]);
}
