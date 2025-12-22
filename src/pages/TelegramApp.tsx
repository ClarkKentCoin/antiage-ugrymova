import { useState, useEffect } from 'react';
import { useTelegramWebApp } from '@/hooks/useTelegramWebApp';
import { useSubscriber } from '@/hooks/useSubscribers';
import { useActiveTiers } from '@/hooks/useSubscriptionTiers';
import { usePaymentHistory } from '@/hooks/usePaymentHistory';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format, differenceInDays, addDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Calendar, CreditCard, Crown, AlertCircle, Clock, ExternalLink, RefreshCw, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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
};

export default function TelegramApp() {
  const { isReady, isTelegramWebApp, user, showConfirm, hapticFeedback } = useTelegramWebApp();
  const { data: subscriber, isLoading: loadingSubscriber, refetch: refetchSubscriber } = useSubscriber(user?.id || null);
  const { data: tiers } = useActiveTiers();
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const { toast } = useToast();

  // Fetch payment link from admin settings
  useEffect(() => {
    async function fetchPaymentLink() {
      const { data } = await supabase
        .from('admin_settings')
        .select('payment_link')
        .limit(1)
        .single();
      if (data) {
        setPaymentLink((data as any).payment_link);
      }
    }
    fetchPaymentLink();
  }, []);

  // For testing outside Telegram (DEV or ?test=1)
  const [testUserId, setTestUserId] = useState<number | null>(null);
  const { data: testSubscriber, isLoading: loadingTestSubscriber, refetch: refetchTestSubscriber } = useSubscriber(testUserId);

  const activeSubscriber = user ? subscriber : testSubscriber;
  const isLoading = user ? loadingSubscriber : loadingTestSubscriber;
  const refetch = user ? refetchSubscriber : refetchTestSubscriber;

  // Prevent fetching *all* payments when we don't know the subscriber yet
  const paymentSubscriberId = activeSubscriber?.id ?? '00000000-0000-0000-0000-000000000000';
  const { data: payments } = usePaymentHistory(paymentSubscriberId);

  const daysRemaining = activeSubscriber?.subscription_end
    ? differenceInDays(new Date(activeSubscriber.subscription_end), new Date())
    : null;

  const allowTestMode =
    import.meta.env.DEV || new URLSearchParams(window.location.search).has('test');

  const handleUnsubscribe = async () => {
    const confirmed = isTelegramWebApp
      ? await showConfirm('Are you sure you want to cancel your subscription?')
      : window.confirm('Are you sure you want to cancel your subscription?');

    if (confirmed) {
      hapticFeedback('warning');
      // In a real app, this would call an API to cancel
      alert('Subscription cancellation request sent. An admin will process this shortly.');
    }
  };

  const handleExtendRequest = (tierId: string) => {
    hapticFeedback('success');
    const tier = tiers?.find((t) => t.id === tierId);
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

        {testUserId && (
          <SubscriptionContent
            subscriber={testSubscriber}
            isLoading={loadingTestSubscriber}
            daysRemaining={daysRemaining}
            tiers={tiers || []}
            payments={payments || []}
            paymentLink={paymentLink}
            onUnsubscribe={handleUnsubscribe}
            onExtend={handleExtendRequest}
            onRefetch={refetch}
          />
        )}
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

  return (
    <div className="min-h-screen bg-background">
      <SubscriptionContent
        subscriber={activeSubscriber}
        isLoading={isLoading}
        daysRemaining={daysRemaining}
        tiers={tiers || []}
        payments={payments || []}
        paymentLink={paymentLink}
        onUnsubscribe={handleUnsubscribe}
        onExtend={handleExtendRequest}
        userName={user?.first_name}
        onRefetch={refetch}
      />
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
  onUnsubscribe,
  onExtend,
  userName,
  onRefetch
}: { 
  subscriber: any; 
  isLoading: boolean;
  daysRemaining: number | null;
  tiers: any[];
  payments: any[];
  paymentLink: string | null;
  onUnsubscribe: () => void;
  onExtend: (tierId: string) => void;
  userName?: string;
  onRefetch?: () => void;
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
        },
      });

      if (error) throw error;
      
      if (data?.payment_url) {
        window.open(data.payment_url, '_blank');
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

  if (!subscriber) {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Нет активной подписки</h2>
            <p className="text-sm text-muted-foreground mb-6">
              У вас пока нет активной подписки на канал.
            </p>
            
            {paymentLink ? (
              <Button 
                className="w-full mb-4" 
                size="lg"
                onClick={() => window.open(paymentLink, '_blank')}
              >
                <ExternalLink className="mr-2 h-5 w-5" />
                Оформить подписку
              </Button>
            ) : null}

            <div className="space-y-2 mt-4">
              <p className="text-xs text-muted-foreground">Доступные тарифы:</p>
              {tiers.map(tier => (
                <div 
                  key={tier.id} 
                  className="flex justify-between items-center p-3 border rounded-lg"
                >
                  <span className="font-medium">{tier.name}</span>
                  <span className="font-semibold">{tier.price}₽</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const status = statusConfig[subscriber.status] || statusConfig.inactive;
  const hasAutoRenewal = subscriber.auto_renewal === true;
  const nextPaymentDate = subscriber.subscription_end ? new Date(subscriber.subscription_end) : null;
  const tierPrice = subscriber.subscription_tiers?.price;

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="text-center py-4">
        <Crown className="h-8 w-8 text-primary mx-auto mb-2" />
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
                  {daysRemaining !== null && daysRemaining > 0 
                    ? `Осталось ${daysRemaining} дней`
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
                  <p className="text-sm text-muted-foreground">{tier.duration_days} дней</p>
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
                  subscriber.subscriber_payment_method === 'robokassa_recurring' ? 'Robokassa (рекурр.)' :
                  subscriber.subscriber_payment_method === 'robokassa_single' ? 'Robokassa' :
                  'Вручную'
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
            <Button variant="destructive" className="w-full" onClick={onUnsubscribe}>
              Отменить подписку
            </Button>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
