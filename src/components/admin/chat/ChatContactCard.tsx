import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { User, Mail, Phone, AtSign, Hash } from 'lucide-react';
import type { ChatThread } from '@/hooks/useChatThreads';

function getInitials(thread: ChatThread): string {
  const sub = thread.subscriber;
  if (sub?.first_name) {
    return (sub.first_name[0] + (sub.last_name?.[0] ?? '')).toUpperCase();
  }
  return 'T';
}

function getDisplayName(thread: ChatThread): string {
  const sub = thread.subscriber;
  if (sub) {
    const parts = [sub.first_name, sub.last_name].filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
  }
  return `Telegram #${thread.telegram_user_id}`;
}

interface ChatContactCardProps {
  thread: ChatThread | null;
}

export function ChatContactCard({ thread }: ChatContactCardProps) {
  if (!thread) {
    return (
      <div className="flex h-full items-center justify-center bg-card">
        <p className="text-sm text-muted-foreground">Контакт не выбран</p>
      </div>
    );
  }

  const sub = thread.subscriber;

  return (
    <div className="h-full bg-card border-l border-border overflow-y-auto">
      <div className="p-4 space-y-4">
        {/* Avatar and name */}
        <div className="flex flex-col items-center text-center space-y-2 pt-2">
          <Avatar className="h-16 w-16">
            <AvatarFallback className="text-lg font-semibold bg-primary/10 text-primary">
              {getInitials(thread)}
            </AvatarFallback>
          </Avatar>
          <div>
            <h3 className="font-semibold text-foreground">{getDisplayName(thread)}</h3>
            {sub?.telegram_username && (
              <p className="text-sm text-muted-foreground">@{sub.telegram_username}</p>
            )}
          </div>
        </div>

        <Separator />

        {/* Details */}
        <div className="space-y-3">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Контактная информация</h4>
          
          <InfoRow icon={Hash} label="Telegram ID" value={String(thread.telegram_user_id)} />
          
          {sub?.telegram_username && (
            <InfoRow icon={AtSign} label="Username" value={`@${sub.telegram_username}`} />
          )}
          
          {sub?.email && (
            <InfoRow icon={Mail} label="Email" value={sub.email} />
          )}
          
          {sub?.phone_number && (
            <InfoRow icon={Phone} label="Телефон" value={sub.phone_number} />
          )}
        </div>

        {sub && (
          <>
            <Separator />
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Подписка</h4>
              
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Статус:</span>
                <Badge variant={sub.status === 'active' ? 'default' : 'secondary'} className="text-xs">
                  {sub.status ?? 'неизвестно'}
                </Badge>
              </div>

              {sub.subscription_end && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Действует до: </span>
                  <span className="text-foreground">
                    {new Date(sub.subscription_end).toLocaleDateString('ru-RU')}
                  </span>
                </div>
              )}
            </div>
          </>
        )}

        {/* Placeholder for future tags */}
        <Separator />
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Теги</h4>
          <p className="text-xs text-muted-foreground italic">Скоро</p>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof User; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm text-foreground break-all">{value}</p>
      </div>
    </div>
  );
}
