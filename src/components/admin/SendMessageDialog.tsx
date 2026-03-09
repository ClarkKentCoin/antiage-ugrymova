import { useState, useCallback } from 'react';
import { format } from 'date-fns';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Subscriber } from '@/hooks/useSubscribers';
import {
  Bold, Italic, Underline, Strikethrough, Code, Quote, Link, Eye,
  Send, Loader2, CheckCircle, XCircle,
} from 'lucide-react';

interface SendMessageDialogProps {
  subscriber: Subscriber | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const formatButtons = [
  { icon: Bold, label: 'Жирный', before: '<b>', after: '</b>' },
  { icon: Italic, label: 'Курсив', before: '<i>', after: '</i>' },
  { icon: Underline, label: 'Подчёркнутый', before: '<u>', after: '</u>' },
  { icon: Strikethrough, label: 'Зачёркнутый', before: '<s>', after: '</s>' },
  { icon: Eye, label: 'Спойлер', before: '<tg-spoiler>', after: '</tg-spoiler>' },
  { icon: Code, label: 'Код', before: '<code>', after: '</code>' },
  { icon: Quote, label: 'Цитата', before: '<blockquote>', after: '</blockquote>' },
];

export function SendMessageDialog({ subscriber, open, onOpenChange }: SendMessageDialogProps) {
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const { toast } = useToast();
  const { session } = useAuth();
  const queryClient = useQueryClient();

  const subscriberId = subscriber?.id;

  const { data: messageHistory = [], isLoading: historyLoading } = useQuery({
    queryKey: ['subscriber-messages', subscriberId],
    queryFn: async () => {
      if (!subscriberId) return [];
      const { data, error } = await supabase
        .from('subscriber_messages' as any)
        .select('*')
        .eq('subscriber_id', subscriberId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: open && !!subscriberId,
  });

  const insertFormat = useCallback((before: string, after: string) => {
    const textarea = document.getElementById('msg-editor') as HTMLTextAreaElement | null;
    if (!textarea) {
      setMessage(prev => prev + before + after);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = message.substring(start, end);
    const newText = message.substring(0, start) + before + selected + after + message.substring(end);
    setMessage(newText);
    setTimeout(() => {
      textarea.focus();
      const cursorPos = start + before.length + selected.length;
      textarea.setSelectionRange(cursorPos, cursorPos);
    }, 0);
  }, [message]);

  const insertLink = useCallback(() => {
    if (!linkUrl.trim()) return;
    const text = linkText.trim() || linkUrl.trim();
    const tag = `<a href="${linkUrl.trim()}">${text}</a>`;
    setMessage(prev => prev + tag);
    setLinkUrl('');
    setLinkText('');
    setShowLinkInput(false);
  }, [linkUrl, linkText]);

  const handleSend = async () => {
    if (!message.trim() || !subscriber) return;
    setIsSending(true);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/send-custom-telegram-message`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            subscriber_id: subscriber.id,
            message: message.trim(),
            parse_mode: 'HTML',
          }),
        }
      );

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.message || result.error || 'Ошибка отправки');
      }

      toast({ title: 'Сообщение отправлено' });
      setMessage('');
      queryClient.invalidateQueries({ queryKey: ['subscriber-messages', subscriberId] });
    } catch (err: any) {
      toast({
        title: 'Ошибка отправки',
        description: err.message || 'Не удалось отправить сообщение',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  const getDisplayName = (sub: Subscriber) => {
    if (sub.telegram_username) return `@${sub.telegram_username}`;
    if (sub.first_name) return sub.first_name;
    return `ID: ${sub.telegram_user_id}`;
  };

  const canSend = !!subscriber?.telegram_user_id && message.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setMessage(''); setShowLinkInput(false); } onOpenChange(o); }}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Отправить сообщение</DialogTitle>
          <DialogDescription>
            {subscriber && (
              <span className="flex items-center gap-2 mt-1">
                <span className="font-medium text-foreground">{getDisplayName(subscriber)}</span>
                <span className="text-xs text-muted-foreground">
                  (ID: {subscriber.telegram_user_id})
                </span>
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="compose" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="w-full">
            <TabsTrigger value="compose" className="flex-1">Написать</TabsTrigger>
            <TabsTrigger value="history" className="flex-1">
              История
              {messageHistory.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">
                  {messageHistory.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="compose" className="flex-1 flex flex-col gap-3 mt-3">
            {/* Formatting toolbar */}
            <div className="flex flex-wrap gap-1">
              {formatButtons.map((btn) => (
                <Button
                  key={btn.label}
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  title={btn.label}
                  onClick={() => insertFormat(btn.before, btn.after)}
                >
                  <btn.icon className="h-3.5 w-3.5" />
                </Button>
              ))}
              <Button
                type="button"
                variant={showLinkInput ? 'default' : 'outline'}
                size="icon"
                className="h-8 w-8"
                title="Ссылка"
                onClick={() => setShowLinkInput(!showLinkInput)}
              >
                <Link className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Link insertion */}
            {showLinkInput && (
              <div className="flex gap-2 items-end">
                <div className="flex-1 space-y-1">
                  <label className="text-xs text-muted-foreground">URL</label>
                  <input
                    className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                    placeholder="https://..."
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-xs text-muted-foreground">Текст</label>
                  <input
                    className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                    placeholder="Текст ссылки"
                    value={linkText}
                    onChange={(e) => setLinkText(e.target.value)}
                  />
                </div>
                <Button size="sm" className="h-8" onClick={insertLink} disabled={!linkUrl.trim()}>
                  Вставить
                </Button>
              </div>
            )}

            <Textarea
              id="msg-editor"
              placeholder="Введите сообщение..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="min-h-[120px] flex-1 font-mono text-sm"
            />

            {!subscriber?.telegram_user_id && (
              <p className="text-sm text-destructive">
                У подписчика нет Telegram ID — отправка невозможна.
              </p>
            )}

            <Button
              onClick={handleSend}
              disabled={!canSend || isSending}
              className="w-full"
            >
              {isSending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Отправить сообщение
            </Button>
          </TabsContent>

          <TabsContent value="history" className="flex-1 min-h-0 mt-3">
            <ScrollArea className="h-[350px]">
              {historyLoading ? (
                <div className="flex items-center justify-center h-24">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : messageHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Сообщения ещё не отправлялись
                </p>
              ) : (
                <div className="space-y-3 pr-3">
                  {messageHistory.map((msg: any) => (
                    <div key={msg.id} className="rounded-lg border bg-card p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(msg.created_at), 'dd.MM.yyyy HH:mm')}
                        </span>
                        {msg.status === 'sent' ? (
                          <Badge variant="outline" className="text-xs gap-1 bg-emerald-50 text-emerald-700 border-emerald-200">
                            <CheckCircle className="h-3 w-3" />
                            Отправлено
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs gap-1">
                            <XCircle className="h-3 w-3" />
                            Ошибка
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm whitespace-pre-wrap line-clamp-4">
                        {msg.message_text}
                      </p>
                      {msg.error_message && (
                        <p className="text-xs text-destructive">{msg.error_message}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
