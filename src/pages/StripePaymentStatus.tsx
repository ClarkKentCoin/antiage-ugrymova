import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle } from 'lucide-react';

/**
 * Safe UI-only Stripe status pages.
 * - Do NOT read Stripe sessions.
 * - Do NOT activate subscriptions or grant access.
 * - Do NOT create invite links or send Telegram messages.
 * Subscription activation happens server-side via stripe-webhook only.
 */
function useTelegramBotUrl(): string | null {
  return useMemo(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const bot = params.get('bot');
      if (bot && /^[A-Za-z0-9_]{3,}$/.test(bot)) {
        return `https://t.me/${bot}`;
      }
      return null;
    } catch {
      return null;
    }
  }, []);
}

function useIsDevFallback(): boolean {
  return useMemo(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('test') === '1';
    } catch {
      return false;
    }
  }, []);
}

function useTenantSlug(): string | null {
  return useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('t');
    } catch {
      return null;
    }
  }, []);
}

export function StripePaymentSuccessPage() {
  const botUrl = useTelegramBotUrl();
  const isDev = useIsDevFallback();
  const tenantSlug = useTenantSlug();
  const devHref = tenantSlug ? `/telegram-app?t=${encodeURIComponent(tenantSlug)}` : '/telegram-app';

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CheckCircle2 className="h-5 w-5 text-success" />
            Оплата успешна
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Оплата успешна. Если доступ уже подтвержден, ссылка для входа в канал отправлена вам в Telegram-бот.
          </p>
          <p className="text-sm text-muted-foreground">
            Вернитесь в Telegram-бот: доступ и ссылка-приглашение выдаются только после серверного подтверждения платежа.
          </p>
          {botUrl ? (
            <Button asChild className="w-full">
              <a href={botUrl}>Вернуться в Telegram-бот</a>
            </Button>
          ) : (
            <div className="rounded-md border bg-muted/40 p-3 text-sm text-center">
              Вернитесь в Telegram-бот
            </div>
          )}
          {isDev && (
            <Button asChild variant="outline" className="w-full">
              <a href={devHref}>Dev: вернуться в Mini App</a>
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

export function StripePaymentCancelPage() {
  const botUrl = useTelegramBotUrl();
  const isDev = useIsDevFallback();
  const tenantSlug = useTenantSlug();
  const devHref = tenantSlug ? `/telegram-app?t=${encodeURIComponent(tenantSlug)}` : '/telegram-app';

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <XCircle className="h-5 w-5 text-destructive" />
            Оплата отменена
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Платёж не был завершён. Вы можете вернуться в Telegram-бот и снова выбрать
            способ оплаты (российская или зарубежная карта).
          </p>
          {botUrl ? (
            <Button asChild className="w-full">
              <a href={botUrl}>Открыть Telegram-бот</a>
            </Button>
          ) : (
            <div className="rounded-md border bg-muted/40 p-3 text-sm text-center">
              Вернитесь в Telegram-бот и выберите способ оплаты заново
            </div>
          )}
          {isDev && (
            <Button asChild variant="outline" className="w-full">
              <a href={devHref}>Dev: вернуться в Mini App</a>
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
