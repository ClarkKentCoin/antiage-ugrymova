import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Bold, Italic, Underline, Strikethrough, Link } from 'lucide-react';
import { cn } from '@/lib/utils';

const MAX_CHARS = 1000;

/** Strip HTML tags to get plain text length */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

/**
 * Convert raw composer text (with allowed HTML tags) into Telegram-safe HTML.
 * Escapes stray <, >, & while preserving allowed tags: b, i, u, s, a.
 */
export function toTelegramHtml(raw: string): string {
  const allowedTagPattern = /<(\/?)([bius]|a(?:\s+href="[^"]*")?)>/gi;
  const tags: { match: string; index: number; length: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = allowedTagPattern.exec(raw)) !== null) {
    tags.push({ match: m[0], index: m.index, length: m[0].length });
  }

  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let result = '';
  let lastIndex = 0;
  for (const tag of tags) {
    result += escapeHtml(raw.slice(lastIndex, tag.index));
    result += tag.match;
    lastIndex = tag.index + tag.length;
  }
  result += escapeHtml(raw.slice(lastIndex));
  return result;
}

interface ChatComposerProps {
  onSend: (text: string, parseMode?: string) => Promise<boolean>;
  disabled?: boolean;
  isSending?: boolean;
  disabledReason?: string;
}

export function ChatComposer({ onSend, disabled, isSending, disabledReason }: ChatComposerProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const plainLen = stripTags(text).length;
  const overLimit = plainLen > MAX_CHARS;
  const canSend = !disabled && !isSending && text.trim().length > 0 && !overLimit;

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 144) + 'px';
  }, [text]);

  const wrapSelection = useCallback((openTag: string, closeTag: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = text.slice(start, end);
    const newText = text.slice(0, start) + openTag + selected + closeTag + text.slice(end);
    setText(newText);
    setTimeout(() => {
      ta.focus();
      ta.selectionStart = start + openTag.length;
      ta.selectionEnd = end + openTag.length;
    }, 0);
  }, [text]);

  const handleFormat = useCallback((type: string) => {
    switch (type) {
      case 'bold': wrapSelection('<b>', '</b>'); break;
      case 'italic': wrapSelection('<i>', '</i>'); break;
      case 'underline': wrapSelection('<u>', '</u>'); break;
      case 'strikethrough': wrapSelection('<s>', '</s>'); break;
      case 'link': {
        const url = window.prompt('Введите URL:');
        if (url) {
          const ta = textareaRef.current;
          if (!ta) return;
          const start = ta.selectionStart;
          const end = ta.selectionEnd;
          const selected = text.slice(start, end) || url;
          const newText = text.slice(0, start) + `<a href="${url}">${selected}</a>` + text.slice(end);
          setText(newText);
        }
        break;
      }
    }
  }, [wrapSelection, text]);

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    const rawText = text;
    const htmlText = toTelegramHtml(rawText);
    setText('');
    const ok = await onSend(htmlText, 'HTML');
    if (!ok) {
      setText(rawText);
    }
    textareaRef.current?.focus();
  }, [canSend, text, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const formatButtons = [
    { type: 'bold', icon: Bold, label: 'Жирный' },
    { type: 'italic', icon: Italic, label: 'Курсив' },
    { type: 'underline', icon: Underline, label: 'Подчёркнутый' },
    { type: 'strikethrough', icon: Strikethrough, label: 'Зачёркнутый' },
    { type: 'link', icon: Link, label: 'Ссылка' },
  ];

  return (
    <div className="border-t border-border bg-card px-3 py-2">
      {disabledReason && (
        <p className="text-xs text-muted-foreground mb-1.5 px-1">{disabledReason}</p>
      )}
      {/* Formatting toolbar + counter */}
      <div className="flex items-center gap-0.5 mb-1">
        {formatButtons.map(({ type, icon: Icon, label }) => (
          <Button
            key={type}
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={label}
            disabled={disabled || isSending}
            onClick={() => handleFormat(type)}
          >
            <Icon className="h-3.5 w-3.5" />
          </Button>
        ))}
        <span className={cn(
          'ml-auto text-xs tabular-nums',
          overLimit ? 'text-destructive font-medium' : 'text-muted-foreground'
        )}>
          {plainLen}/{MAX_CHARS}
        </span>
      </div>
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Написать сообщение..."
          disabled={disabled || isSending}
          className="min-h-[40px] max-h-[144px] resize-none text-sm py-2 overflow-y-auto"
          rows={1}
        />
        <Button
          size="icon"
          onClick={handleSend}
          disabled={!canSend}
          className="shrink-0 h-10 w-10"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
