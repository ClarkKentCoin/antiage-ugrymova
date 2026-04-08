import { useState, useCallback, useEffect } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { ChatThreadList } from '@/components/admin/chat/ChatThreadList';
import { ChatMessageHistory } from '@/components/admin/chat/ChatMessageHistory';
import { ChatContactCard } from '@/components/admin/chat/ChatContactCard';
import { ChatComposer } from '@/components/admin/chat/ChatComposer';
import { useChatThreads, type ChatThread } from '@/hooks/useChatThreads';
import { useChatMessages } from '@/hooks/useChatMessages';
import { useMarkThreadRead } from '@/hooks/useMarkThreadRead';
import { useChatRealtime } from '@/hooks/useChatRealtime';
import { useSendChatReply } from '@/hooks/useSendChatReply';
import { useAuth } from '@/hooks/useAuth';

export default function AdminChat() {
  const { tenantId } = useAuth();
  const { data: threads = [], isLoading: threadsLoading } = useChatThreads();
  const [selectedThread, setSelectedThread] = useState<ChatThread | null>(null);
  const { data: messages = [], isLoading: messagesLoading } = useChatMessages(selectedThread?.id ?? null);
  const { markRead } = useMarkThreadRead();
  const { sendReply, isSending } = useSendChatReply();

  // Auto-mark read when new incoming message arrives on the open thread
  const handleIncomingForSelected = useCallback(() => {
    if (selectedThread) {
      markRead(selectedThread.id);
    }
  }, [selectedThread, markRead]);

  // Realtime subscriptions for live updates
  useChatRealtime(tenantId, selectedThread?.id ?? null, handleIncomingForSelected);

  const handleSendReply = useCallback(async (text: string): Promise<boolean> => {
    if (!selectedThread) return false;
    return sendReply(selectedThread.id, text);
  }, [selectedThread, sendReply]);

  // Keep selectedThread in sync with refreshed threads data
  useEffect(() => {
    if (selectedThread) {
      const updated = threads.find(t => t.id === selectedThread.id);
      if (updated) setSelectedThread(updated);
    }
  }, [threads]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectThread = useCallback((thread: ChatThread) => {
    setSelectedThread(thread);
    if (thread.admin_unread_count > 0) {
      markRead(thread.id);
    }
  }, [markRead]);

  return (
    <AdminLayout>
      <div className="flex flex-col h-[calc(100vh-2rem)] md:h-[calc(100vh-4rem)]">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-foreground">Чат</h1>
          <p className="text-sm text-muted-foreground">Входящие сообщения от пользователей</p>
        </div>
        
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[320px_1fr_280px] border border-border rounded-lg overflow-hidden">
          {/* Left: Thread list */}
          <ChatThreadList
            threads={threads}
            isLoading={threadsLoading}
            selectedThreadId={selectedThread?.id ?? null}
            onSelectThread={handleSelectThread}
          />

          {/* Center: Messages + Composer */}
          <div className="flex flex-col min-h-0">
            <div className="flex-1 min-h-0">
              <ChatMessageHistory
                messages={messages}
                isLoading={messagesLoading}
                threadSelected={!!selectedThread}
              />
            </div>
            {selectedThread && (
              <ChatComposer
                onSend={handleSendReply}
                isSending={isSending}
                disabled={!selectedThread.telegram_user_id || selectedThread.bot_blocked}
                disabledReason={selectedThread.bot_blocked ? 'Пользователь заблокировал бота' : undefined}
              />
            )}
          </div>

          {/* Right: Contact card */}
          <div className="hidden md:block">
            <ChatContactCard thread={selectedThread} />
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
