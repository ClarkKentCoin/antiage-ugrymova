import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatThread } from '@/hooks/useChatThreads';

type ThreadFilter = 'all' | 'unread' | 'open' | 'closed';

const FILTER_TABS: { value: ThreadFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'unread', label: 'Непрочитанные' },
  { value: 'open', label: 'Открытые' },
  { value: 'closed', label: 'Закрытые' },
];

function getThreadDisplayName(thread: ChatThread): string {
  const sub = thread.subscriber;
  if (sub) {
    const parts = [sub.first_name, sub.last_name].filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
    if (sub.telegram_username) return `@${sub.telegram_username}`;
    if (sub.email) return sub.email;
  }
  return `Telegram #${thread.telegram_user_id}`;
}

function getThreadUsername(thread: ChatThread): string | null {
  return thread.subscriber?.telegram_username
    ? `@${thread.subscriber.telegram_username}`
    : null;
}

function formatMessageTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

interface ChatThreadListProps {
  threads: ChatThread[];
  isLoading: boolean;
  selectedThreadId: string | null;
  onSelectThread: (thread: ChatThread) => void;
}

export function ChatThreadList({ threads, isLoading, selectedThreadId, onSelectThread }: ChatThreadListProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ThreadFilter>('all');

  const filtered = useMemo(() => {
    let list = threads;

    // filter by status
    if (filter === 'unread') list = list.filter(t => t.admin_unread_count > 0);
    else if (filter === 'open') list = list.filter(t => t.status === 'open');
    else if (filter === 'closed') list = list.filter(t => t.status === 'closed');

    // search
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(t => {
        const sub = t.subscriber;
        const haystack = [
          sub?.first_name,
          sub?.last_name,
          sub?.telegram_username,
          sub?.email,
          String(t.telegram_user_id),
          t.last_message_preview,
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(q);
      });
    }

    return list;
  }, [threads, filter, search]);

  return (
    <div className="flex h-full flex-col border-r border-border bg-card">
      {/* Search */}
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-1 border-b border-border px-3 py-2 flex-wrap">
        {FILTER_TABS.map(tab => (
          <Button
            key={tab.value}
            variant={filter === tab.value ? 'default' : 'ghost'}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setFilter(tab.value)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Thread list */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            Нет диалогов
          </div>
        ) : (
          filtered.map(thread => {
            const isSelected = thread.id === selectedThreadId;
            const hasUnread = thread.admin_unread_count > 0;
            return (
              <button
                key={thread.id}
                onClick={() => onSelectThread(thread)}
                className={cn(
                  'w-full text-left px-4 py-3 border-b border-border transition-colors hover:bg-accent/50',
                  isSelected && 'bg-accent',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn('text-sm truncate', hasUnread ? 'font-semibold text-foreground' : 'font-medium text-foreground')}>
                        {getThreadDisplayName(thread)}
                      </span>
                      {thread.status === 'closed' && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          Закрыт
                        </Badge>
                      )}
                    </div>
                    {getThreadUsername(thread) && (
                      <p className="text-xs text-muted-foreground truncate">{getThreadUsername(thread)}</p>
                    )}
                    {thread.last_message_preview && (
                      <p className={cn('text-xs mt-0.5 truncate', hasUnread ? 'text-foreground' : 'text-muted-foreground')}>
                        {thread.last_message_preview}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {formatMessageTime(thread.last_message_at)}
                    </span>
                    {hasUnread && (
                      <Badge className="h-5 min-w-5 flex items-center justify-center rounded-full text-[10px] px-1.5">
                        {thread.admin_unread_count}
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </ScrollArea>
    </div>
  );
}
