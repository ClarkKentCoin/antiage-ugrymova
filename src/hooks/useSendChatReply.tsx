import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { ChatMessage } from '@/hooks/useChatMessages';
import { toast } from 'sonner';

export function useSendChatReply() {
  const { tenantId } = useAuth();
  const queryClient = useQueryClient();
  const [isSending, setIsSending] = useState(false);

  const sendReply = async (threadId: string, text: string, parseMode?: string): Promise<boolean> => {
    if (!tenantId || !threadId || !text.trim()) return false;

    const trimmedText = text.trim();
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticMessage: ChatMessage = {
      id: optimisticId,
      thread_id: threadId,
      tenant_id: tenantId,
      direction: 'outgoing',
      sender_type: 'admin',
      message_type: 'text',
      text_content: trimmedText,
      telegram_message_id: null,
      is_read_by_admin: true,
      read_by_admin_at: new Date().toISOString(),
      telegram_status: 'queued',
      created_at: new Date().toISOString(),
    };

    const removeOptimisticMessage = () => {
      queryClient.setQueryData<ChatMessage[]>(['chat-messages', tenantId, threadId], current =>
        (current ?? []).filter(message => message.id !== optimisticId)
      );
    };

    queryClient.setQueryData<ChatMessage[]>(['chat-messages', tenantId, threadId], current => [
      ...(current ?? []),
      optimisticMessage,
    ]);

    setIsSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-chat-reply', {
        body: { thread_id: threadId, text: trimmedText, parse_mode: parseMode || undefined },
      });

      if (error) {
        removeOptimisticMessage();
        console.error('[useSendChatReply] invoke error:', error);
        toast.error('Не удалось отправить сообщение');
        return false;
      }

      if (data?.error === 'text_too_long') {
        removeOptimisticMessage();
        toast.error(data.message || 'Сообщение слишком длинное (макс. 1000 символов)');
        return false;
      }

      if (data?.error === 'telegram_send_failed') {
        queryClient.invalidateQueries({ queryKey: ['chat-messages', tenantId, threadId] });
        queryClient.invalidateQueries({ queryKey: ['chat-threads', tenantId] });
        toast.error(data.message || 'Telegram отклонил сообщение');
        return false;
      }

      queryClient.invalidateQueries({ queryKey: ['chat-messages', tenantId, threadId] });
      queryClient.invalidateQueries({ queryKey: ['chat-threads', tenantId] });
      return true;
    } catch (err) {
      removeOptimisticMessage();
      console.error('[useSendChatReply] exception:', err);
      toast.error('Ошибка отправки');
      return false;
    } finally {
      setIsSending(false);
    }
  };

  return { sendReply, isSending };
}
