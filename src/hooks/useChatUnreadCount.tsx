import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Returns total admin unread count across all chat threads for the current tenant.
 * Used for sidebar badge. Lightweight query — only fetches admin_unread_count.
 */
export function useChatUnreadCount() {
  const { tenantId } = useAuth();

  return useQuery<number>({
    queryKey: ['chat-unread-count', tenantId],
    enabled: !!tenantId,
    refetchInterval: 30000, // fallback polling every 30s
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chat_threads')
        .select('admin_unread_count')
        .eq('tenant_id', tenantId!)
        .gt('admin_unread_count', 0);

      if (error) throw error;

      return (data ?? []).reduce(
        (sum: number, t: { admin_unread_count: number }) => sum + (t.admin_unread_count ?? 0),
        0
      );
    },
  });
}
