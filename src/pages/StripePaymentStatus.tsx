import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle } from 'lucide-react';

/**
 * Safe UI-only Stripe status pages.
 * - Do NOT read Stripe sessions.
 * - Do NOT activate subscriptions or grant access.
 * - Do NOT create invite links or send Telegram messages.
 * Subscription activation happens server-side via stripe-webhook (not implemented yet).
 */
function useReturnHref(): string {
  return useMemo(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const t = params.get('t');
      return t ? `/telegram-app?t=${encodeURIComponent(t)}` : '/telegram-app';
    } catch {
      return '/telegram-app';
    }
  }, []);
}

export function StripePaymentSuccessPage() {
  const href = useReturnHref();
  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CheckCircle2 className="h-5 w-5 text-success" />
            Платеж обрабатывается
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Спасибо! Платеж отправлен на проверку. Доступ будет выдан после подтверждения оплаты.
          </p>
          <Button asChild className="w-full">
            <a href={href}>Вернуться в Mini App</a>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

export function StripePaymentCancelPage() {
  const href = useReturnHref();
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
            Вы можете вернуться и выбрать способ оплаты снова.
          </p>
          <Button asChild className="w-full">
            <a href={href}>Вернуться к оплате</a>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
