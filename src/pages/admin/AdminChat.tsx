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
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ArrowLeft, Info } from 'lucide-react';

export default function AdminChat() {
  const { tenantId } = useAuth();
  const isMobile = useIsMobile();
  const { data: threads = [], isLoading: threadsLoading } = useChatThreads();
  const [selectedThread, setSelectedThread] = useState<ChatThread | null>(null);
  const [mobileInfoOpen, setMobileInfoOpen] = useState(false);
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

  const handleBack = useCallback(() => {
    setSelectedThread(null);
    setMobileInfoOpen(false);
  }, []);

  // Helper to get display name for mobile header
  const getThreadName = (thread: ChatThread): string => {
    const sub = thread.subscriber;
    if (sub) {
      const parts = [sub.first_name, sub.last_name].filter(Boolean);
      if (parts.length > 0) return parts.join(' ');
      if (sub.telegram_username) return `@${sub.telegram_username}`;
      if (sub.email) return sub.email;
    }
    return `Telegram #${thread.telegram_user_id}`;
  };

  // Mobile: show either list or thread detail
  if (isMobile) {
    // Thread detail view
    if (selectedThread) {
      return (
        <AdminLayout>
          <div className="flex flex-col h-[calc(100dvh-6.5rem)] min-h-0 overflow-hidden">
            {/* Mobile thread header - sticky */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0">
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handleBack}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{getThreadName(selectedThread)}</p>
                {selectedThread.subscriber?.telegram_username && (
                  <p className="text-xs text-muted-foreground truncate">@{selectedThread.subscriber.telegram_username}</p>
                )}
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setMobileInfoOpen(true)}>
                <Info className="h-4 w-4" />
              </Button>
            </div>

            {/* Messages */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <ChatMessageHistory
                messages={messages}
                isLoading={messagesLoading}
                threadSelected={true}
              />
            </div>

            {/* Composer */}
            <ChatComposer
              onSend={handleSendReply}
              isSending={isSending}
              disabled={!selectedThread.telegram_user_id || selectedThread.bot_contact_status !== 'active'}
              disabledReason={
                selectedThread.bot_contact_status === 'blocked'
                  ? 'Пользователь удалил или заблокировал бота. Отправка сообщений недоступна.'
                  : selectedThread.bot_contact_status === 'start_required'
                  ? 'Пользователь ещё не запустил бота. Отправка сообщений недоступна.'
                  : undefined
              }
            />

            {/* Mobile user details sheet */}
            <Sheet open={mobileInfoOpen} onOpenChange={setMobileInfoOpen}>
              <SheetContent side="right" className="w-[300px] p-0">
                <SheetHeader className="sr-only">
                  <SheetTitle>Информация о контакте</SheetTitle>
                </SheetHeader>
                <ChatContactCard thread={selectedThread} />
              </SheetContent>
            </Sheet>
          </div>
        </AdminLayout>
      );
    }

    // List view
    return (
      <AdminLayout>
        <div className="flex flex-col h-[calc(100dvh-6.5rem)] min-h-0 overflow-hidden">
          <div className="mb-2 px-1 shrink-0">
            <h1 className="text-xl font-bold text-foreground">Чат</h1>
          </div>
          <div className="flex-1 min-h-0 border border-border rounded-lg overflow-hidden">
            <ChatThreadList
              threads={threads}
              isLoading={threadsLoading}
              selectedThreadId={null}
              onSelectThread={handleSelectThread}
            />
          </div>
        </div>
      </AdminLayout>
    );
  }

  // Desktop: existing 3-column layout
  return (
    <AdminLayout>
      <div className="flex flex-col h-[calc(100vh-2rem)] md:h-[calc(100vh-4rem)] min-h-0">
        <div className="mb-4 shrink-0">
          <h1 className="text-2xl font-bold text-foreground">Чат</h1>
          <p className="text-sm text-muted-foreground">Входящие сообщения от пользователей</p>
        </div>
        
        <div className="flex-1 min-h-0 grid grid-cols-[320px_1fr_280px] border border-border rounded-lg overflow-hidden">
          {/* Left: Thread list */}
          <ChatThreadList
            threads={threads}
            isLoading={threadsLoading}
            selectedThreadId={selectedThread?.id ?? null}
            onSelectThread={handleSelectThread}
          />

          {/* Center: Messages + Composer */}
          <div className="flex flex-col min-h-0">
            <div className="flex-1 min-h-0 overflow-hidden">
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
                disabled={!selectedThread.telegram_user_id || selectedThread.bot_contact_status !== 'active'}
                disabledReason={
                  selectedThread.bot_contact_status === 'blocked'
                    ? 'Пользователь удалил или заблокировал бота. Отправка сообщений недоступна.'
                    : selectedThread.bot_contact_status === 'start_required'
                    ? 'Пользователь ещё не запустил бота. Отправка сообщений недоступна.'
                    : undefined
                }
              />
            )}
          </div>

          {/* Right: Contact card */}
          <div className="min-h-0 overflow-hidden">
            <ChatContactCard thread={selectedThread} />
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
