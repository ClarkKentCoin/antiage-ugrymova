import { useState, useCallback, useEffect } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import LinkExtension from '@tiptap/extension-link';
import { Button } from '@/components/ui/button';
import { Send, Bold, Italic, Underline, Strikethrough, Link } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const MAX_CHARS = 1000;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

function normalizeLinkHref(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^(https?:|mailto:|tg:)/i.test(trimmed)) {
    return trimmed;
  }

  if (/^[\w.-]+\.[A-Za-z]{2,}(?:[/?#].*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return null;
}

function getPlainText(editor: Editor | null): string {
  return editor?.getText({ blockSeparator: '\n' }) ?? '';
}

function serializeTelegramNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeHtml(node.textContent ?? '');
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();
  const content = Array.from(element.childNodes).map(serializeTelegramNode).join('');

  switch (tag) {
    case 'strong':
    case 'b':
      return content ? `<b>${content}</b>` : content;
    case 'em':
    case 'i':
      return content ? `<i>${content}</i>` : content;
    case 'u':
      return content ? `<u>${content}</u>` : content;
    case 's':
    case 'strike':
    case 'del':
      return content ? `<s>${content}</s>` : content;
    case 'a': {
      const href = normalizeLinkHref(element.getAttribute('href') ?? '');
      if (!href) return content;
      return content ? `<a href="${escapeAttribute(href)}">${content}</a>` : escapeHtml(href);
    }
    case 'br':
      return '\n';
    case 'p':
    case 'div':
      return `${content}\n`;
    default:
      return content;
  }
}

export function toTelegramHtml(editorHtml: string): string {
  const doc = new DOMParser().parseFromString(editorHtml, 'text/html');
  return Array.from(doc.body.childNodes)
    .map(serializeTelegramNode)
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface ChatComposerProps {
  onSend: (text: string, parseMode?: string) => Promise<boolean>;
  disabled?: boolean;
  isSending?: boolean;
  disabledReason?: string;
}

export function ChatComposer({ onSend, disabled, isSending, disabledReason }: ChatComposerProps) {
  const [plainLen, setPlainLen] = useState(0);
  const [hasContent, setHasContent] = useState(false);

  const syncEditorState = useCallback((instance: Editor) => {
    const plainText = getPlainText(instance);
    setPlainLen(plainText.length);
    setHasContent(plainText.trim().length > 0);
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        dropcursor: false,
        gapcursor: false,
        heading: false,
        horizontalRule: false,
        orderedList: false,
      }),
      Underline,
      LinkExtension.configure({
        autolink: false,
        linkOnPaste: false,
        openOnClick: false,
      }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class:
          'min-h-[40px] max-h-[144px] overflow-y-auto px-3 py-2 text-sm text-foreground focus:outline-none whitespace-pre-wrap break-words',
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          void handleSend();
          return true;
        }

        return false;
      },
    },
    onCreate: ({ editor: instance }) => {
      syncEditorState(instance);
    },
    onUpdate: ({ editor: instance }) => {
      syncEditorState(instance);
    },
  });

  const overLimit = plainLen > MAX_CHARS;
  const canSend = !disabled && !isSending && hasContent && !overLimit;

  useEffect(() => {
    editor?.setEditable(!disabled && !isSending);
  }, [editor, disabled, isSending]);

  const handleFormat = useCallback((type: string) => {
    if (!editor) return;

    switch (type) {
      case 'bold':
        editor.chain().focus().toggleBold().run();
        break;
      case 'italic':
        editor.chain().focus().toggleItalic().run();
        break;
      case 'underline':
        editor.chain().focus().toggleUnderline().run();
        break;
      case 'strikethrough':
        editor.chain().focus().toggleStrike().run();
        break;
      case 'link': {
        const currentHref = editor.getAttributes('link').href as string | undefined;
        const input = window.prompt('Введите URL:', currentHref ?? 'https://');
        if (input === null) break;

        const normalizedHref = normalizeLinkHref(input);

        if (!input.trim()) {
          editor.chain().focus().extendMarkRange('link').unsetLink().run();
          break;
        }

        if (!normalizedHref) {
          toast.error('Введите корректную ссылку');
          break;
        }

        const { from, to } = editor.state.selection;
        if (from === to) {
          editor
            .chain()
            .focus()
            .insertContent(normalizedHref)
            .setTextSelection({ from, to: from + normalizedHref.length })
            .setLink({ href: normalizedHref })
            .run();
        } else {
          editor.chain().focus().extendMarkRange('link').setLink({ href: normalizedHref }).run();
        }

        break;
      }
    }
  }, [editor]);

  const handleSend = useCallback(async () => {
    if (!editor) return;
    if (!canSend) return;

    const plainText = getPlainText(editor);
    if (plainText.length > MAX_CHARS) {
      toast.error('Сообщение слишком длинное (макс. 1000 символов)');
      return;
    }

    const rawEditorHtml = editor.getHTML();
    let telegramHtml = '';

    try {
      telegramHtml = toTelegramHtml(rawEditorHtml);
    } catch (error) {
      console.error('[ChatComposer] HTML conversion failed:', error);
      toast.error('Не удалось подготовить форматирование сообщения');
      return;
    }

    if (!telegramHtml.trim()) return;

    editor.commands.clearContent(true);
    editor.commands.focus();

    const ok = await onSend(telegramHtml, 'HTML');
    if (!ok) {
      editor.commands.setContent(rawEditorHtml, false);
      editor.commands.focus('end');
    }
  }, [canSend, editor, onSend]);

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
      <div className="flex items-center gap-0.5 mb-1">
        {formatButtons.map(({ type, icon: Icon, label }) => (
          <Button
            key={type}
            type="button"
            variant={editor?.isActive(type === 'strikethrough' ? 'strike' : type) ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            title={label}
            disabled={disabled || isSending || !editor}
            onMouseDown={e => e.preventDefault()}
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
        <div
          className={cn(
            'relative flex-1 rounded-md border border-input bg-background text-sm ring-offset-background transition-shadow',
            editor?.isFocused && 'ring-2 ring-ring ring-offset-2',
            disabled || isSending ? 'cursor-not-allowed opacity-50' : 'cursor-text'
          )}
          onClick={() => editor?.commands.focus()}
        >
          {!hasContent && (
            <div className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">
              Написать сообщение...
            </div>
          )}
          <EditorContent editor={editor} />
        </div>
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
