import { useEffect, useRef, useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { MessageSquare, Check, Clock, AlertCircle, Reply } from 'lucide-react';
import type { ChatMessage } from '@/hooks/useChatMessages';

function formatMsgTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatDateSeparator(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function groupByDate(messages: ChatMessage[]): { date: string; messages: ChatMessage[] }[] {
  const groups: { date: string; messages: ChatMessage[] }[] = [];
  let currentDate = '';
  for (const msg of messages) {
    const d = new Date(msg.created_at).toDateString();
    if (d !== currentDate) {
      currentDate = d;
      groups.push({ date: msg.created_at, messages: [msg] });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  }
  return groups;
}

interface ChatMessageHistoryProps {
  messages: ChatMessage[];
  isLoading: boolean;
  threadSelected: boolean;
}

export function ChatMessageHistory({ messages, isLoading, threadSelected }: ChatMessageHistoryProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages]);

  // Pre-compute: which outgoing messages have a later incoming reply
  // Must be called before early returns (React hooks rule)
  const repliedOutgoingIds = useMemo(() => {
    const ids = new Set<string>();
    let lastOutgoingIdx = -1;
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].direction === 'outgoing') {
        lastOutgoingIdx = i;
      } else if (messages[i].direction === 'incoming' && lastOutgoingIdx >= 0) {
        for (let j = lastOutgoingIdx; j >= 0; j--) {
          if (messages[j].direction === 'outgoing') {
            ids.add(messages[j].id);
          } else {
            break;
          }
        }
      }
    }
    return ids;
  }, [messages]);

  if (!threadSelected) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <MessageSquare className="h-12 w-12 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">Выберите диалог для просмотра</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Нет сообщений</p>
      </div>
    );
  }

  const groups = groupByDate(messages);

  return (
    <ScrollArea className="h-full bg-background">
      <div className="p-4 space-y-4">
        {groups.map((group, gi) => (
          <div key={gi}>
            {/* Date separator */}
            <div className="flex justify-center my-3">
              <span className="bg-muted text-muted-foreground text-xs px-3 py-1 rounded-full">
                {formatDateSeparator(group.date)}
              </span>
            </div>
            {/* Messages */}
            <div className="space-y-2">
              {group.messages.map(msg => {
                const isIncoming = msg.direction === 'incoming';
                const hasUserReply = !isIncoming && repliedOutgoingIds.has(msg.id);
                return (
                  <div
                    key={msg.id}
                    className={cn('flex', isIncoming ? 'justify-start' : 'justify-end')}
                  >
                    <div
                      className={cn(
                        'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm',
                        isIncoming
                          ? 'bg-muted text-foreground rounded-bl-md'
                          : 'bg-primary text-primary-foreground rounded-br-md'
                      )}
                    >
                      {msg.direction === 'outgoing' ? (
                        <p
                          className="whitespace-pre-wrap break-words [&_a]:underline"
                          dangerouslySetInnerHTML={{ __html: msg.text_content ?? '' }}
                        />
                      ) : (
                        <p className="whitespace-pre-wrap break-words">{msg.text_content ?? ''}</p>
                      )}
                      <div className={cn(
                        'flex items-center gap-1 mt-1 justify-end',
                        isIncoming ? 'text-muted-foreground' : 'text-primary-foreground/70'
                      )}>
                        {!isIncoming && msg.telegram_status && (
                          <span className="flex items-center gap-0.5">
                            {msg.telegram_status === 'queued' && <Clock className="h-3 w-3" />}
                            {(msg.telegram_status === 'sent' || msg.telegram_status === 'accepted') && (
                              hasUserReply
                                ? <Reply className="h-3 w-3" />
                                : <Check className="h-3 w-3" />
                            )}
                            {msg.telegram_status === 'failed' && <AlertCircle className="h-3 w-3 text-destructive" />}
                          </span>
                        )}
                        <span className="text-[10px]">
                          {formatMsgTime(msg.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
