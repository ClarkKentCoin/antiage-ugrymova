import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send } from 'lucide-react';

interface ChatComposerProps {
  onSend: (text: string) => Promise<boolean>;
  disabled?: boolean;
  isSending?: boolean;
}

export function ChatComposer({ onSend, disabled, isSending }: ChatComposerProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = !disabled && !isSending && text.trim().length > 0;

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    const msg = text;
    setText('');
    const ok = await onSend(msg);
    if (!ok) {
      // Restore text on failure so admin can retry
      setText(msg);
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

  return (
    <div className="border-t border-border bg-card px-3 py-2">
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Написать сообщение..."
          disabled={disabled || isSending}
          className="min-h-[40px] max-h-[120px] resize-none text-sm py-2"
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
