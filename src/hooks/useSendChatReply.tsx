import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export function useSendChatReply() {
  const { tenantId } = useAuth();
  const queryClient = useQueryClient();
  const [isSending, setIsSending] = useState(false);

  const sendReply = async (threadId: string, text: string): Promise<boolean> => {
    if (!tenantId || !threadId || !text.trim()) return false;

    setIsSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-chat-reply', {
        body: { thread_id: threadId, text: text.trim() },
      });

      if (error) {
        console.error('[useSendChatReply] invoke error:', error);
        toast.error('Не удалось отправить сообщение');
        return false;
      }

      if (data?.error === 'telegram_send_failed') {
        toast.error(data.message || 'Telegram отклонил сообщение');
        // Still invalidate — failed message is persisted and should show in UI
        queryClient.invalidateQueries({ queryKey: ['chat-messages', tenantId, threadId] });
        queryClient.invalidateQueries({ queryKey: ['chat-threads', tenantId] });
        return false;
      }

      // Success — invalidate to show outgoing message
      queryClient.invalidateQueries({ queryKey: ['chat-messages', tenantId, threadId] });
      queryClient.invalidateQueries({ queryKey: ['chat-threads', tenantId] });
      return true;
    } catch (err) {
      console.error('[useSendChatReply] exception:', err);
      toast.error('Ошибка отправки');
      return false;
    } finally {
      setIsSending(false);
    }
  };

  return { sendReply, isSending };
}
