import { useState, useEffect, useMemo } from 'react';
import { useTelegramWebApp } from '@/hooks/useTelegramWebApp';
import { useSubscriber } from '@/hooks/useSubscribers';
import { useActiveTiers } from '@/hooks/useSubscriptionTiers';
import { usePaymentHistoryForUser } from '@/hooks/usePaymentHistory';
import { useDebugBadgeToggle } from '@/hooks/useDebugBadgeToggle';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format, differenceInDays, addDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Calendar, CreditCard, AlertCircle, Clock, ExternalLink, RefreshCw, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import logoUgrymova from '@/assets/logo-ugrymova.png';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { formatDaysRu } from '@/lib/textFormatters';
import { MiniAppBuildBadge } from '@/components/telegram/MiniAppBuildBadge';

// Extract tenant slug from URL for multi-tenant MiniApp support
const getTenantSlug = (): string | null => {
  return new URLSearchParams(window.location.search).get('t');
};
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

const statusConfig: Record<string, { label: string; className: string }> = {
  active: { label: 'Активна', className: 'bg-success/10 text-success border-success/20' },
  expired: { label: 'Истекла', className: 'bg-destructive/10 text-destructive border-destructive/20' },
  inactive: { label: 'Неактивна', className: 'bg-muted text-muted-foreground border-border' },
  cancelled: { label: 'Отменена', className: 'bg-warning/10 text-warning border-warning/20' },
  grace_period: { label: 'Льготный период', className: 'bg-warning/10 text-warning border-warning/20' },
};

// Прямой переход на оплату без диалогов Telegram
// Robokassa не поддерживает Telegram Payment API, поэтому используем window.location.href
const openPaymentUrl = (url: string) => {
  window.location.href = url;
};

export default function TelegramApp() {
  const { isReady, isTelegramWebApp, user, showConfirm, hapticFeedback, webApp } = useTelegramWebApp();
  const initData = webApp?.initData ?? null;
  
  // Get tenant slug from URL (for multi-tenant support)
  const tenantSlug = useMemo(() => getTenantSlug(), []);

  // Debug badge toggle (7 taps on logo to enable/disable)
  const { isEnabled: debugBadgeEnabled, handleTap: handleDebugTap } = useDebugBadgeToggle();

  const { data: subscriberResponse, isLoading: loadingSubscriber, refetch: refetchSubscriber, error: subscriberError } = useSubscriber(
    user?.id ?? null,
    initData,
    tenantSlug,
  );
  
  // Extract subscriber and debug info from response
  const subscriber = subscriberResponse?.subscriber ?? null;
  const serverDebugInfo = subscriberResponse ? {
    function_version: subscriberResponse.function_version,
    server_now: subscriberResponse.server_now,
    expires_at_raw: subscriberResponse.expires_at_raw,
    grace_end_at: subscriberResponse.grace_end_at,
    grace_days_remaining: subscriberResponse.grace_days_remaining,
    grace_ms_remaining: subscriberResponse.grace_ms_remaining,
  } : null;
  
  const { data: tiers } = useActiveTiers();
  const publicTiers = (tiers ?? []).filter((t) => {
    const name = (t?.name ?? '').trim().toLowerCase();
    const isAdminByName = name === 'добавлен админом';
    const isAdminByShape = t?.price === 0 && (t?.duration_days ?? 0) >= 3650;
    return !(isAdminByName || isAdminByShape);
  });

  // Compute set of tier IDs already purchased (for purchase_once_only enforcement)
  const purchasedOnceOnlyTierIds = useMemo(() => {
    const completedPayments = payments || [];
    const ids = new Set<string>();
    for (const p of completedPayments) {
      if (p.tier_id) ids.add(p.tier_id);
    }
    // Only keep IDs for tiers that have purchase_once_only = true
    const onceOnlyIds = new Set<string>();
    for (const t of publicTiers) {
      if (t.purchase_once_only && ids.has(t.id)) {
        onceOnlyIds.add(t.id);
      }
    }
    return onceOnlyIds;
  }, [payments, publicTiers]);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const { toast } = useToast();

  // Handle debug badge tap with toast feedback
  const onDebugTap = () => {
    const toggled = handleDebugTap();
    if (toggled) {
      // After toggle, check the new state from localStorage
      const newState = localStorage.getItem('miniapp_debug_badge') === '1';
      toast({
        title: newState ? 'Debug badge: ON' : 'Debug badge: OFF',
        description: newState ? 'Диагностика включена' : 'Диагностика отключена',
      });
    }
  };

  const [channelInfo, setChannelInfo] = useState<{ name: string; description: string } | null>(null);
  const [gracePeriodDays, setGracePeriodDays] = useState<number | null>(null);

  // Fetch settings from admin_settings
  useEffect(() => {
    async function fetchSettings() {
      const { data } = await supabase
        .from('admin_settings')
        .select('payment_link, channel_name, channel_description, grace_period_days')
        .limit(1)
        .maybeSingle();
      if (data) {
        setPaymentLink((data as any).payment_link);
        setChannelInfo({
          name: (data as any).channel_name || 'АНТИЭЙДЖ ЛАБ',
          description:
            (data as any).channel_description ||
            'Закрытый Telegram-канал для женщин: мотивация, рецепты, научные подходы к антиэйджу. Всё для энергии и молодости в одном месте.',
        });
        setGracePeriodDays((data as any).grace_period_days ?? 0);
        console.log('[TelegramApp] Loaded grace_period_days:', (data as any).grace_period_days);
      } else {
        setGracePeriodDays(0);
      }
    }
    fetchSettings();
  }, []);

  // For testing outside Telegram (DEV or ?test=1)
  const [testUserId, setTestUserId] = useState<number | null>(null);
  const { data: testSubscriberResponse, isLoading: loadingTestSubscriber, refetch: refetchTestSubscriber } = useSubscriber(testUserId);
  const testSubscriber = testSubscriberResponse?.subscriber ?? null;

  const activeSubscriber = user ? subscriber : testSubscriber;
  const activeDebugInfo = user ? serverDebugInfo : null;
  const isLoading = user ? loadingSubscriber : loadingTestSubscriber;
  const refetch = user ? refetchSubscriber : refetchTestSubscriber;

  // Fetch payments via edge function with init_data validation
  const telegramUserIdForPayments = user?.id ?? testUserId;
  const { data: payments } = usePaymentHistoryForUser(telegramUserIdForPayments, initData, tenantSlug);

  const daysRemaining = activeSubscriber?.subscription_end
    ? differenceInDays(new Date(activeSubscriber.subscription_end), new Date())
    : null;

  const allowTestMode =
    import.meta.env.DEV || new URLSearchParams(window.location.search).has('test');

  const [isCancelling, setIsCancelling] = useState(false);

  const handleUnsubscribe = async () => {
    const confirmed = isTelegramWebApp
      ? await showConfirm('Вы уверены, что хотите отменить подписку? Вы будете удалены из канала.')
      : window.confirm('Вы уверены, что хотите отменить подписку? Вы будете удалены из канала.');

    if (!confirmed) return;

    hapticFeedback('warning');
    setIsCancelling(true);

    try {
      const telegramUserId = user?.id ?? testUserId;
      if (!telegramUserId) {
        toast({
          title: 'Ошибка',
          description: 'Не удалось определить пользователя',
          variant: 'destructive',
        });
        return;
      }

      const { data, error } = await supabase.functions.invoke('cancel-subscription', {
        body: {
          telegram_user_id: telegramUserId,
          init_data: initData ?? '',
          tenant_slug: tenantSlug,
        },
      });

      if (error) {
        console.error('Cancel subscription error:', error);
        toast({
          title: 'Ошибка',
          description: error.message || 'Не удалось отменить подписку',
          variant: 'destructive',
        });
        return;
      }

      if (data?.error) {
        console.error('Cancel subscription API error:', data.error);
        toast({
          title: 'Ошибка',
          description: data.error === 'subscriber_not_found' 
            ? 'Подписчик не найден' 
            : data.error === 'already_cancelled'
            ? 'Подписка уже отменена'
            : data.error,
          variant: 'destructive',
        });
        return;
      }

      hapticFeedback('success');
      toast({
        title: 'Подписка отменена',
        description: 'Вы были удалены из канала',
      });

      // Refresh subscriber data
      await refetch();
    } catch (err) {
      console.error('Cancel subscription exception:', err);
      toast({
        title: 'Ошибка',
        description: 'Произошла ошибка при отмене подписки',
        variant: 'destructive',
      });
    } finally {
      setIsCancelling(false);
    }
  };

  const handleExtendRequest = (tierId: string) => {
    hapticFeedback('success');
    const tier = publicTiers.find((t) => t.id === tierId);
    alert(`Request to extend with ${tier?.name} plan sent! Contact admin to complete payment.`);
  };

  // If opened outside Telegram, show instructions in production; keep Test Mode for dev / ?test=1
  if (!isTelegramWebApp) {
    if (!allowTestMode) {
      return (
        <main className="min-h-screen bg-background p-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Откройте в Telegram</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                Эта страница должна быть открыта из Telegram бота как Mini App (кнопка Web App), а не как обычная ссылка.
              </p>
              <p>
                Если вы тестируете в браузере, добавьте <span className="font-mono">?test=1</span> к URL.
              </p>
            </CardContent>
          </Card>
        </main>
      );
    }

    return (
      <main className="min-h-screen bg-background p-4">
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-lg">Тестовый режим</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Не запущено в Telegram. Введите Telegram User ID для тестирования:
            </p>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="Telegram User ID"
                className="flex-1 px-3 py-2 border border-border rounded-md"
                onChange={(e) => setTestUserId(e.target.value ? parseInt(e.target.value) : null)}
              />
            </div>
          </CardContent>
        </Card>

        <SubscriptionContent
          subscriber={testUserId ? testSubscriber : null}
          isLoading={testUserId ? loadingTestSubscriber : false}
          daysRemaining={daysRemaining}
          tiers={publicTiers}
          payments={payments || []}
          paymentLink={paymentLink}
          channelInfo={channelInfo}
          telegramUserId={testUserId}
          onUnsubscribe={handleUnsubscribe}
          onExtend={handleExtendRequest}
          onRefetch={refetch}
          gracePeriodDays={gracePeriodDays}
          isCancelling={isCancelling}
          serverGraceDaysRemaining={null}
          onDebugTap={onDebugTap}
        />
        {debugBadgeEnabled && <MiniAppBuildBadge serverDebug={null} />}
      </main>
    );
  }

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Загрузка...</div>
      </div>
    );
  }

  // Show error state if subscriber query failed
  if (subscriberError) {
    return (
      <main className="min-h-screen bg-background p-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Ошибка загрузки
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Не удалось загрузить данные подписки. Попробуйте перезапустить Mini App.
            </p>
            <Button onClick={() => refetch()} variant="outline" className="w-full">
              <RefreshCw className="mr-2 h-4 w-4" />
              Повторить
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      <SubscriptionContent
        subscriber={activeSubscriber}
        isLoading={isLoading}
        daysRemaining={daysRemaining}
        tiers={publicTiers}
        payments={payments || []}
        paymentLink={paymentLink}
        channelInfo={channelInfo}
        telegramUserId={user?.id}
        onUnsubscribe={handleUnsubscribe}
        onExtend={handleExtendRequest}
        userName={user?.first_name}
        onRefetch={refetch}
        gracePeriodDays={gracePeriodDays}
        isCancelling={isCancelling}
        serverGraceDaysRemaining={activeDebugInfo?.grace_days_remaining ?? null}
        onDebugTap={onDebugTap}
      />
      {debugBadgeEnabled && <MiniAppBuildBadge serverDebug={activeDebugInfo} />}
    </div>
  );
}

// Component for new users / users without active subscription
function NewUserView({
  channelInfo,
  tiers,
  telegramUserId,
  subscriber,
  onRefetch,
  onDebugTap,
}: {
  channelInfo: { name: string; description: string } | null;
  tiers: any[];
  telegramUserId?: number | null;
  subscriber: any;
  onRefetch?: () => void;
  onDebugTap?: () => void;
}) {
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [autoRenewal, setAutoRenewal] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);
  const { toast } = useToast();

  const handleSelectTier = (tierId: string) => {
    setSelectedTier(tierId);
    setAutoRenewal(false);
    setConsentGiven(false);
  };

  const handlePayment = async () => {
    if (!selectedTier) return;

    if (autoRenewal && !consentGiven) {
      toast({
        title: 'Необходимо согласие',
        description: 'Пожалуйста, подтвердите согласие на автосписания',
        variant: 'destructive',
      });
      return;
    }

    if (!telegramUserId) {
      toast({ title: 'Ошибка', description: 'Не удалось определить Telegram пользователя', variant: 'destructive' });
      return;
    }

    setGeneratingLink(true);
    try {
      const body: Record<string, unknown> = {
        tier_id: selectedTier,
        is_recurring: autoRenewal,
        ip_address: null,
        user_agent: navigator.userAgent,
        telegram_user_id: telegramUserId,
        tenant_slug: getTenantSlug(),
      };

      // Optional: if subscriber exists (например, в тестовом режиме), передадим его
      if (subscriber?.id) body.subscriber_id = subscriber.id;

      const { data, error } = await supabase.functions.invoke('create-robokassa-payment', {
        body,
      });

      if (error) throw error;

      if (data?.payment_url) {
        toast({ title: 'Переход к оплате...', description: 'Сейчас откроется страница оплаты' });
        openPaymentUrl(data.payment_url);
        onRefetch?.();
      } else {
        toast({ title: 'Ошибка', description: 'Платёжная ссылка не вернулась от сервера', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Error generating payment link:', error);

      const err = error as any;
      const detailsFromContext = typeof err?.context?.body === 'string'
        ? (() => {
            try {
              const parsed = JSON.parse(err.context.body);
              return parsed?.error || parsed?.details;
            } catch {
              return err.context.body;
            }
          })()
        : null;

      toast({
        title: 'Ошибка',
        description: detailsFromContext || err?.message || 'Не удалось создать ссылку для оплаты',
        variant: 'destructive',
      });
    } finally {
      setGeneratingLink(false);
    }
  };

  const selectedTierData = tiers.find(t => t.id === selectedTier);

  return (
    <div className="p-4 space-y-6">
      {/* Channel Header */}
      <div className="text-center py-6">
        <div 
          className="flex items-center justify-center mx-auto mb-4 cursor-pointer select-none"
          onClick={onDebugTap}
        >
          <img src={logoUgrymova} alt="Ugrymova" className="max-w-[200px] h-auto" />
        </div>
        <h1 className="text-2xl font-bold mb-3">
          🌟 {channelInfo?.name || 'АНТИЭЙДЖ ЛАБ'}
        </h1>
        <p className="text-muted-foreground leading-relaxed max-w-sm mx-auto">
          {channelInfo?.description || 'Закрытый Telegram-канал для женщин: мотивация, рецепты, научные подходы к антиэйджу. Всё для энергии и молодости в одном месте.'}
        </p>
      </div>

      {/* Tier Selection */}
      <div className="space-y-4">
        <h2 className="text-center text-lg font-semibold flex items-center justify-center gap-2">
          <span>💎</span> Выберите тариф и получите мгновенный доступ:
        </h2>

        <div className="grid gap-3">
          {tiers.map(tier => (
            <Card 
              key={tier.id} 
              className={`cursor-pointer transition-all ${
                selectedTier === tier.id 
                  ? 'border-primary ring-2 ring-primary/30 bg-primary/5' 
                  : 'hover:border-primary/50 hover:shadow-md'
              }`}
              onClick={() => handleSelectTier(tier.id)}
            >
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    selectedTier === tier.id ? 'border-primary bg-primary' : 'border-muted-foreground'
                  }`}>
                    {selectedTier === tier.id && (
                      <CheckCircle className="h-4 w-4 text-primary-foreground" />
                    )}
                  </div>
                  <div>
                    <p className="font-semibold text-lg">{tier.name}</p>
                    <p className="text-sm text-muted-foreground">{formatDaysRu(tier.duration_days)}</p>
                  </div>
                </div>
                <p className="text-xl font-bold">{Number(tier.price).toLocaleString('ru-RU')}₽</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Payment options - shown when tier is selected */}
      {selectedTier && (
        <Card className="border-primary/30 bg-gradient-to-b from-primary/5 to-background">
          <CardContent className="pt-5 space-y-4">
            <div className="text-center pb-2">
              <p className="text-sm text-muted-foreground">Вы выбрали:</p>
              <p className="font-semibold text-lg">{selectedTierData?.name} — {Number(selectedTierData?.price).toLocaleString('ru-RU')}₽</p>
            </div>

            {/* Auto-renewal checkbox */}
            <div className="flex items-start space-x-3 p-3 rounded-lg bg-muted/50">
              <Checkbox 
                id="auto-renewal-new" 
                checked={autoRenewal}
                onCheckedChange={(checked) => {
                  setAutoRenewal(checked === true);
                  if (!checked) setConsentGiven(false);
                }}
              />
              <div className="grid gap-1 leading-none">
                <Label htmlFor="auto-renewal-new" className="font-medium cursor-pointer">
                  Автоматическое продление
                </Label>
              </div>
            </div>

            {/* Info and consent required if auto-renewal is enabled */}
            {autoRenewal && (
              <>
                {/* Info bubble about Russian cards only */}
                <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                  <p className="text-sm text-foreground">
                    <span className="font-medium">Важно!</span> Режим Автоматическое продление пока доступен только для оплат с карт РФ. Если вы оплачиваете зарубежными картами и картами стран СНГ — пожалуйста снимите галочку Автоматическое продление. Полные правила оплаты вы можете ознакомиться по{' '}
                    <a 
                      href="https://antiage.ugrymova.ru/#faq" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-primary underline font-medium"
                      onClick={(e) => e.stopPropagation()}
                    >
                      этой ссылке
                    </a>.
                  </p>
                </div>

                {/* Consent block */}
                <div className="space-y-3 p-4 rounded-lg bg-warning/10 border border-warning/20">
                  <div className="flex items-center gap-2 text-warning">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-medium">Требуется ваше согласие</span>
                  </div>
                  
                  <div className="flex items-start space-x-3">
                    <Checkbox 
                      id="consent-new" 
                      checked={consentGiven}
                      onCheckedChange={(checked) => setConsentGiven(checked === true)}
                    />
                    <div className="grid gap-1.5 leading-none">
                      <Label htmlFor="consent-new" className="text-sm cursor-pointer">
                        Я согласен на автоматические списания средств согласно условиям{' '}
                        <a 
                          href="https://antiage.ugrymova.ru/oferta" 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-primary underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          публичной оферты
                        </a>
                      </Label>
                    </div>
                  </div>
                  
                  <p className="text-xs text-muted-foreground">
                    При автопродлении оплата будет списываться за 1 день до окончания подписки. Вы получите уведомление за 3 дня.
                  </p>
                </div>
              </>
            )}

            <Button 
              className="w-full" 
              size="lg"
              disabled={generatingLink || (autoRenewal && !consentGiven)}
              onClick={handlePayment}
            >
              {generatingLink ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Создание ссылки...
                </>
              ) : (
                <>
                  <CreditCard className="mr-2 h-4 w-4" />
                  Оплатить через Robokassa
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Component for grace period users
function GracePeriodView({
  channelInfo,
  tiers,
  telegramUserId,
  subscriber,
  onRefetch,
  graceDaysRemaining,
  onDebugTap,
}: {
  channelInfo: { name: string; description: string } | null;
  tiers: any[];
  telegramUserId?: number | null;
  subscriber: any;
  onRefetch?: () => void;
  graceDaysRemaining: number;
  onDebugTap?: () => void;
}) {
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [autoRenewal, setAutoRenewal] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);
  const { toast } = useToast();

  const handleSelectTier = (tierId: string) => {
    setSelectedTier(tierId);
    setAutoRenewal(false);
    setConsentGiven(false);
  };

  const handlePayment = async () => {
    if (!selectedTier || !subscriber?.id) return;
    
    if (autoRenewal && !consentGiven) {
      toast({ title: 'Необходимо согласие', description: 'Пожалуйста, подтвердите согласие на автосписания', variant: 'destructive' });
      return;
    }

    setGeneratingLink(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-robokassa-payment', {
        body: {
          subscriber_id: subscriber.id,
          tier_id: selectedTier,
          is_recurring: autoRenewal,
          ip_address: null,
          user_agent: navigator.userAgent,
          telegram_user_id: telegramUserId,
          tenant_slug: getTenantSlug(),
        },
      });

      if (error) throw error;
      
      if (data?.payment_url) {
        toast({ title: 'Переход к оплате...', description: 'Сейчас откроется страница оплаты' });
        openPaymentUrl(data.payment_url);
        onRefetch?.();
      }
    } catch (error) {
      console.error('Error generating payment link:', error);
      toast({ title: 'Ошибка', description: 'Не удалось создать ссылку для оплаты', variant: 'destructive' });
    } finally {
      setGeneratingLink(false);
    }
  };

  const selectedTierData = tiers.find(t => t.id === selectedTier);

  return (
    <div className="p-4 space-y-6">
      {/* Tappable logo for debug toggle */}
      <div className="text-center pt-4">
        <div 
          className="flex items-center justify-center mx-auto mb-2 cursor-pointer select-none"
          onClick={onDebugTap}
        >
          <img src={logoUgrymova} alt="Ugrymova" className="max-w-[160px] h-auto" />
        </div>
      </div>

      {/* Grace Period Warning */}
      <Card className="border-warning bg-warning/10">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 text-warning flex-shrink-0 mt-0.5" />
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">⚠️ Ваша подписка истекла</h2>
              <p className="text-muted-foreground">
                У вас есть <span className="font-bold text-warning">{formatDaysRu(graceDaysRemaining)}</span> для продления без потери доступа к архиву канала.
              </p>
              <p className="text-sm text-muted-foreground">
                Продлите сейчас, чтобы не потерять историю сообщений.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tier Selection */}
      <div className="space-y-4">
        <h2 className="text-center text-lg font-semibold flex items-center justify-center gap-2">
          <span>💎</span> Выберите тариф для продления:
        </h2>

        <div className="grid gap-3">
          {tiers.map(tier => (
            <Card 
              key={tier.id} 
              className={`cursor-pointer transition-all ${
                selectedTier === tier.id 
                  ? 'border-primary ring-2 ring-primary/30 bg-primary/5' 
                  : 'hover:border-primary/50 hover:shadow-md'
              }`}
              onClick={() => handleSelectTier(tier.id)}
            >
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    selectedTier === tier.id ? 'border-primary bg-primary' : 'border-muted-foreground'
                  }`}>
                    {selectedTier === tier.id && (
                      <CheckCircle className="h-4 w-4 text-primary-foreground" />
                    )}
                  </div>
                  <div>
                    <p className="font-semibold text-lg">{tier.name}</p>
                    <p className="text-sm text-muted-foreground">{formatDaysRu(tier.duration_days)}</p>
                  </div>
                </div>
                <p className="text-xl font-bold">{Number(tier.price).toLocaleString('ru-RU')}₽</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Payment options - shown when tier is selected */}
      {selectedTier && (
        <Card className="border-primary/30 bg-gradient-to-b from-primary/5 to-background">
          <CardContent className="pt-5 space-y-4">
            <div className="text-center pb-2">
              <p className="text-sm text-muted-foreground">Вы выбрали:</p>
              <p className="font-semibold text-lg">{selectedTierData?.name} — {Number(selectedTierData?.price).toLocaleString('ru-RU')}₽</p>
            </div>

            {/* Auto-renewal checkbox */}
            <div className="flex items-start space-x-3 p-3 rounded-lg bg-muted/50">
              <Checkbox 
                id="auto-renewal-grace" 
                checked={autoRenewal}
                onCheckedChange={(checked) => {
                  setAutoRenewal(checked === true);
                  if (!checked) setConsentGiven(false);
                }}
              />
              <div className="grid gap-1 leading-none">
                <Label htmlFor="auto-renewal-grace" className="font-medium cursor-pointer">
                  Автоматическое продление
                </Label>
              </div>
            </div>

            {/* Info and consent required if auto-renewal is enabled */}
            {autoRenewal && (
              <>
                {/* Info bubble about Russian cards only */}
                <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                  <p className="text-sm text-foreground">
                    <span className="font-medium">Важно!</span> Режим Автоматическое продление пока доступен только для оплат с карт РФ. Если вы оплачиваете зарубежными картами и картами стран СНГ — пожалуйста снимите галочку Автоматическое продление. Полные правила оплаты вы можете ознакомиться по{' '}
                    <a 
                      href="https://antiage.ugrymova.ru/#faq" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-primary underline font-medium"
                      onClick={(e) => e.stopPropagation()}
                    >
                      этой ссылке
                    </a>.
                  </p>
                </div>

                {/* Consent block */}
                <div className="space-y-3 p-4 rounded-lg bg-warning/10 border border-warning/20">
                  <div className="flex items-center gap-2 text-warning">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-medium">Требуется ваше согласие</span>
                  </div>
                  
                  <div className="flex items-start space-x-3">
                    <Checkbox 
                      id="consent-grace" 
                      checked={consentGiven}
                      onCheckedChange={(checked) => setConsentGiven(checked === true)}
                    />
                    <div className="grid gap-1.5 leading-none">
                      <Label htmlFor="consent-grace" className="text-sm cursor-pointer">
                        Я согласен на автоматические списания средств согласно условиям{' '}
                        <a 
                          href="https://antiage.ugrymova.ru/oferta" 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-primary underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          публичной оферты
                        </a>
                      </Label>
                    </div>
                  </div>
                  
                  <p className="text-xs text-muted-foreground">
                    При автопродлении оплата будет списываться за 1 день до окончания подписки. Вы получите уведомление за 3 дня.
                  </p>
                </div>
              </>
            )}

            <Button 
              className="w-full" 
              size="lg"
              disabled={generatingLink || (autoRenewal && !consentGiven)}
              onClick={handlePayment}
            >
              {generatingLink ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Создание ссылки...
                </>
              ) : (
                <>
                  <CreditCard className="mr-2 h-4 w-4" />
                  Продлить подписку
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SubscriptionContent({
  subscriber, 
  isLoading, 
  daysRemaining, 
  tiers, 
  payments,
  paymentLink,
  channelInfo,
  telegramUserId,
  onUnsubscribe,
  onExtend,
  userName,
  onRefetch,
  gracePeriodDays = 0,
  isCancelling = false,
  serverGraceDaysRemaining = null,
  onDebugTap,
}: {
  subscriber: any; 
  isLoading: boolean;
  daysRemaining: number | null;
  tiers: any[];
  payments: any[];
  paymentLink: string | null;
  channelInfo: { name: string; description: string } | null;
  telegramUserId?: number | null;
  onUnsubscribe: () => void;
  onExtend: (tierId: string) => void;
  userName?: string;
  onRefetch?: () => void;
  gracePeriodDays?: number | null;
  isCancelling?: boolean;
  serverGraceDaysRemaining?: number | null;
  onDebugTap?: () => void;
}) {
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [autoRenewal, setAutoRenewal] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [disableAutoRenewalOpen, setDisableAutoRenewalOpen] = useState(false);
  const [disablingAutoRenewal, setDisablingAutoRenewal] = useState(false);
  const { toast } = useToast();

  const handleGeneratePaymentLink = async () => {
    if (!selectedTier || !subscriber?.id) return;
    
    if (autoRenewal && !consentGiven) {
      toast({ title: 'Необходимо согласие', description: 'Пожалуйста, подтвердите согласие на автосписания', variant: 'destructive' });
      return;
    }

    setGeneratingLink(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-robokassa-payment', {
        body: {
          subscriber_id: subscriber.id,
          tier_id: selectedTier,
          is_recurring: autoRenewal,
          ip_address: null,
          user_agent: navigator.userAgent,
          telegram_user_id: telegramUserId,
          tenant_slug: getTenantSlug(),
        },
      });

      if (error) throw error;
      
      if (data?.payment_url) {
        toast({ title: 'Переход к оплате...', description: 'Сейчас откроется страница оплаты' });
        openPaymentUrl(data.payment_url);
      }
    } catch (error) {
      console.error('Error generating payment link:', error);
      toast({ title: 'Ошибка', description: 'Не удалось создать ссылку для оплаты', variant: 'destructive' });
    } finally {
      setGeneratingLink(false);
    }
  };

  const handleDisableAutoRenewal = async () => {
    if (!subscriber?.id) return;
    
    setDisablingAutoRenewal(true);
    try {
      // Update subscriber
      const { error: updateError } = await supabase
        .from('subscribers')
        .update({ auto_renewal: false })
        .eq('id', subscriber.id);

      if (updateError) throw updateError;

      // Log consent change
      await supabase
        .from('subscription_consent_log')
        .insert({
          subscriber_id: subscriber.id,
          consent_type: 'auto_renewal_disabled',
          user_agent: navigator.userAgent,
        });

      toast({ 
        title: '✅ Автопродление отключено', 
        description: `Доступ сохранится до ${subscriber.subscription_end ? format(new Date(subscriber.subscription_end), 'd MMMM yyyy', { locale: ru }) : 'окончания подписки'}` 
      });
      
      setDisableAutoRenewalOpen(false);
      onRefetch?.();
    } catch (error) {
      console.error('Error disabling auto renewal:', error);
      toast({ title: 'Ошибка', description: 'Не удалось отключить автопродление', variant: 'destructive' });
    } finally {
      setDisablingAutoRenewal(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <div className="h-32 bg-muted rounded-lg animate-pulse" />
        <div className="h-24 bg-muted rounded-lg animate-pulse" />
      </div>
    );
  }

  const isActiveSubscriber = subscriber && subscriber.status === 'active';
  const isGracePeriod = subscriber && subscriber.status === 'grace_period';

  // Calculate grace period days remaining - prefer server value if available
  let graceDaysRemaining = 0;
  const effectiveGracePeriodDays = gracePeriodDays ?? 0;
  
  // Use server-calculated value if available (more accurate, no timezone issues)
  if (serverGraceDaysRemaining !== null && serverGraceDaysRemaining !== undefined) {
    graceDaysRemaining = serverGraceDaysRemaining;
    console.log('[GracePeriod] Using server value:', graceDaysRemaining);
  } else if (isGracePeriod && subscriber.subscription_end && effectiveGracePeriodDays > 0) {
    // Fallback to local calculation (for test mode without initData)
    const subscriptionEnd = new Date(subscriber.subscription_end);
    const graceEndDate = addDays(subscriptionEnd, effectiveGracePeriodDays);
    graceDaysRemaining = Math.max(0, differenceInDays(graceEndDate, new Date()));
    console.log('[GracePeriod] Local calc: subscriptionEnd:', subscriptionEnd, 'graceEndDate:', graceEndDate, 'gracePeriodDays:', effectiveGracePeriodDays, 'graceDaysRemaining:', graceDaysRemaining);
  } else if (isGracePeriod && subscriber.subscription_end && gracePeriodDays === null) {
    // Grace period days not loaded yet - wait for it
    console.log('[GracePeriod] Waiting for gracePeriodDays to load...');
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Загрузка...</div>
      </div>
    );
  }

  // Show grace period warning
  if (isGracePeriod) {
    return (
      <GracePeriodView
        channelInfo={channelInfo}
        tiers={tiers}
        telegramUserId={telegramUserId}
        subscriber={subscriber}
        onRefetch={onRefetch}
        graceDaysRemaining={graceDaysRemaining}
        onDebugTap={onDebugTap}
      />
    );
  }

  // Show channel info and tier selection for new users or users without active subscription
  if (!isActiveSubscriber) {
    return (
      <NewUserView
        channelInfo={channelInfo}
        tiers={tiers}
        telegramUserId={telegramUserId}
        subscriber={subscriber}
        onRefetch={onRefetch}
        onDebugTap={onDebugTap}
      />
    );
  }

  const status = statusConfig[subscriber.status] || statusConfig.inactive;
  const hasAutoRenewal = subscriber.auto_renewal === true;
  const nextPaymentDate = subscriber.subscription_end ? new Date(subscriber.subscription_end) : null;
  const tierPrice = subscriber.subscription_tiers?.price;

  return (
    <div className="p-4 space-y-4">
      {/* Channel Header */}
      <div className="text-center py-4">
        <div 
          className="flex items-center justify-center mx-auto mb-4 cursor-pointer select-none"
          onClick={onDebugTap}
        >
          <img src={logoUgrymova} alt="Ugrymova" className="max-w-[200px] h-auto" />
        </div>
        <h2 className="text-2xl font-bold mb-2">
          🌟 {channelInfo?.name || 'АНТИЭЙДЖ ЛАБ'}
        </h2>
        <p className="text-muted-foreground text-sm mb-4 max-w-sm mx-auto">
          {channelInfo?.description || 'Закрытый Telegram-канал для женщин: мотивация, рецепты, научные подходы к антиэйджу. Всё для энергии и молодости в одном месте.'}
        </p>
        <h1 className="text-xl font-semibold">
          {userName ? `Привет, ${userName}!` : 'Моя подписка'}
        </h1>
      </div>

      {/* Status Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-muted-foreground">Статус</p>
              <Badge variant="outline" className={status.className}>
                {status.label}
              </Badge>
            </div>
            {subscriber.subscription_tiers?.name && (
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Тариф</p>
                <p className="font-semibold">{subscriber.subscription_tiers.name}</p>
              </div>
            )}
          </div>

          {subscriber.subscription_end && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">
                  {new Date(subscriber.subscription_end).getTime() > Date.now()
                    ? (daysRemaining !== null && daysRemaining > 0 
                        ? `Осталось ${formatDaysRu(daysRemaining)}`
                        : 'Осталось меньше дня')
                    : 'Подписка истекла'
                  }
                </p>
                <p className="text-xs text-muted-foreground">
                  До: {format(new Date(subscriber.subscription_end), 'd MMMM yyyy', { locale: ru })}
                </p>
              </div>
            </div>
          )}

          {/* Auto-renewal status */}
          <div className="mt-4 p-3 rounded-lg border">
            {hasAutoRenewal ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-success">
                  <CheckCircle className="h-5 w-5" />
                  <span className="font-medium">Автопродление включено</span>
                </div>
                {nextPaymentDate && tierPrice && (
                  <p className="text-sm text-muted-foreground">
                    Следующее списание: {format(nextPaymentDate, 'd MMMM yyyy', { locale: ru })} на сумму {Number(tierPrice).toLocaleString('ru-RU')}₽
                  </p>
                )}
                <Button 
                  variant="destructive" 
                  size="sm" 
                  className="w-full mt-2"
                  onClick={() => setDisableAutoRenewalOpen(true)}
                >
                  Отключить автопродление
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <XCircle className="h-5 w-5" />
                  <span className="font-medium">Автопродление отключено</span>
                </div>
                {subscriber.subscription_end && (
                  <p className="text-sm text-muted-foreground">
                    Доступ действует до: {format(new Date(subscriber.subscription_end), 'd MMMM yyyy', { locale: ru })}
                  </p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Disable auto-renewal dialog */}
      <AlertDialog open={disableAutoRenewalOpen} onOpenChange={setDisableAutoRenewalOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отключить автопродление?</AlertDialogTitle>
            <AlertDialogDescription>
              Вы уверены? Доступ сохранится до {subscriber.subscription_end ? format(new Date(subscriber.subscription_end), 'd MMMM yyyy', { locale: ru }) : 'окончания подписки'}, но автоматического продления не будет.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDisableAutoRenewal}
              disabled={disablingAutoRenewal}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {disablingAutoRenewal ? 'Отключение...' : 'Отключить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Actions */}
      <Tabs defaultValue="extend" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="extend">Продлить</TabsTrigger>
          <TabsTrigger value="history">История</TabsTrigger>
          <TabsTrigger value="manage">Управление</TabsTrigger>
        </TabsList>

        <TabsContent value="extend" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Выберите тариф для продления подписки:
          </p>
          
          {tiers.map(tier => (
            <Card 
              key={tier.id} 
              className={`cursor-pointer transition-colors ${selectedTier === tier.id ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary/50'}`}
              onClick={() => setSelectedTier(tier.id)}
            >
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">{tier.name}</p>
                  <p className="text-sm text-muted-foreground">{formatDaysRu(tier.duration_days)}</p>
                </div>
                <p className="text-lg font-bold">{tier.price}₽</p>
              </CardContent>
            </Card>
          ))}

          {selectedTier && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="pt-4 space-y-4">
                {/* Auto-renewal checkbox */}
                <div className="flex items-start space-x-3">
                  <Checkbox 
                    id="auto-renewal" 
                    checked={autoRenewal}
                    onCheckedChange={(checked) => {
                      setAutoRenewal(checked === true);
                      if (!checked) setConsentGiven(false);
                    }}
                  />
                  <div className="grid gap-1.5 leading-none">
                    <Label htmlFor="auto-renewal" className="font-medium cursor-pointer">
                      Автоматическое продление
                    </Label>
                  </div>
                </div>

                {/* Consent required if auto-renewal is enabled */}
                {autoRenewal && (
                  <div className="space-y-3 p-3 rounded-lg bg-warning/10 border border-warning/20">
                    <div className="flex items-center gap-2 text-warning">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="text-sm font-medium">Требуется ваше согласие</span>
                    </div>
                    
                    <div className="flex items-start space-x-3">
                      <Checkbox 
                        id="consent" 
                        checked={consentGiven}
                        onCheckedChange={(checked) => setConsentGiven(checked === true)}
                      />
                      <div className="grid gap-1.5 leading-none">
                        <Label htmlFor="consent" className="text-sm cursor-pointer">
                          Я согласен на автоматические списания средств согласно условиям{' '}
                          <a 
                            href="https://antiage.ugrymova.ru/oferta" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-primary underline"
                          >
                            публичной оферты
                          </a>
                        </Label>
                      </div>
                    </div>
                    
                    <p className="text-xs text-muted-foreground">
                      При автопродлении оплата будет списываться за 1 день до окончания подписки. Вы получите уведомление за 3 дня.
                    </p>
                  </div>
                )}

                <Button 
                  className="w-full" 
                  size="lg"
                  disabled={generatingLink || (autoRenewal && !consentGiven)}
                  onClick={handleGeneratePaymentLink}
                >
                  {generatingLink ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Создание ссылки...
                    </>
                  ) : (
                    <>
                      <CreditCard className="mr-2 h-4 w-4" />
                      Оплатить через Robokassa
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          {payments.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground">
                Нет истории платежей
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {payments.map(payment => (
                <Card key={payment.id}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <CreditCard className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">
                          {payment.subscription_tiers?.name || 'Оплата'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(payment.payment_date), 'd MMM yyyy', { locale: ru })}
                        </p>
                      </div>
                    </div>
                    <p className="font-semibold">{Number(payment.amount).toLocaleString('ru-RU')}₽</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="manage" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Детали подписки</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Telegram ID</span>
                <span className="font-mono">{subscriber.telegram_user_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Способ оплаты</span>
                <span>{
                  subscriber.subscriber_payment_method === 'robokassa_recurring' ? 'Robokassa (авто)' :
                  subscriber.subscriber_payment_method === 'robokassa_single' ? 'Robokassa' :
                  subscriber.subscriber_payment_method === 'manual' ? 'Вручную' :
                  '—'
                }</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Подписчик с</span>
                <span>{format(new Date(subscriber.created_at), 'd MMM yyyy', { locale: ru })}</span>
              </div>
              {subscriber.subscription_start && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Начало периода</span>
                  <span>{format(new Date(subscriber.subscription_start), 'd MMM yyyy', { locale: ru })}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {subscriber.status === 'active' && (
            <Button 
              variant="destructive" 
              className="w-full" 
              onClick={onUnsubscribe}
              disabled={isCancelling}
            >
              {isCancelling ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Отмена подписки...
                </>
              ) : (
                'Отменить подписку'
              )}
            </Button>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
