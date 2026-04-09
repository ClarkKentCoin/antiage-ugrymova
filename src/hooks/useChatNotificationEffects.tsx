import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Subscribes to realtime chat_threads changes for the sidebar unread badge.
 * Also triggers optional sound and browser notifications for new incoming messages.
 *
 * Should be mounted once in AdminLayout (or a top-level admin wrapper).
 */
export function useChatNotificationEffects(options?: {
  soundEnabled?: boolean;
  browserNotificationsEnabled?: boolean;
}) {
  const { tenantId } = useAuth();
  const queryClient = useQueryClient();
  const lastNotifiedRef = useRef<string | null>(null);

  const playSound = useCallback(() => {
    if (!options?.soundEnabled) return;
    try {
      // Use a simple system beep via AudioContext
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 800;
      gain.gain.value = 0.15;
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch {
      // Silently ignore audio errors
    }
  }, [options?.soundEnabled]);

  const showBrowserNotification = useCallback((preview: string) => {
    if (!options?.browserNotificationsEnabled) return;
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    try {
      new Notification('Новое сообщение в чат', {
        body: preview || 'Новое входящее сообщение',
        icon: '/favicon.ico',
        tag: 'chat-notification', // prevents stacking
      });
    } catch {
      // Silently ignore
    }
  }, [options?.browserNotificationsEnabled]);

  useEffect(() => {
    if (!tenantId) return;

    const channel = supabase
      .channel(`chat-sidebar-unread-${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_threads',
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          // Invalidate unread count for sidebar badge
          queryClient.invalidateQueries({ queryKey: ['chat-unread-count', tenantId] });

          const row = payload.new as {
            id?: string;
            admin_unread_count?: number;
            last_message_direction?: string;
            last_message_preview?: string;
          };

          // Fire notification only for incoming message that just made thread unread
          if (
            row.last_message_direction === 'incoming' &&
            row.admin_unread_count &&
            row.admin_unread_count > 0 &&
            row.id !== lastNotifiedRef.current
          ) {
            lastNotifiedRef.current = row.id ?? null;
            playSound();
            showBrowserNotification(row.last_message_preview || '');
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_threads',
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['chat-unread-count', tenantId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, queryClient, playSound, showBrowserNotification]);
}
