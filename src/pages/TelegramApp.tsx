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
import { format, differenceInDays } from 'date-fns';
import { Calendar, CreditCard, Crown, AlertCircle, Clock, ExternalLink, RefreshCw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

const statusConfig: Record<string, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-success/10 text-success border-success/20' },
  expired: { label: 'Expired', className: 'bg-destructive/10 text-destructive border-destructive/20' },
  inactive: { label: 'Inactive', className: 'bg-muted text-muted-foreground border-border' },
  cancelled: { label: 'Cancelled', className: 'bg-warning/10 text-warning border-warning/20' },
};

export default function TelegramApp() {
  const { isReady, isTelegramWebApp, user, showConfirm, hapticFeedback } = useTelegramWebApp();
  const { data: subscriber, isLoading: loadingSubscriber } = useSubscriber(user?.id || null);
  const { data: tiers } = useActiveTiers();
  const [paymentLink, setPaymentLink] = useState<string | null>(null);

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
  const { data: testSubscriber, isLoading: loadingTestSubscriber } = useSubscriber(testUserId);

  const activeSubscriber = user ? subscriber : testSubscriber;
  const isLoading = user ? loadingSubscriber : loadingTestSubscriber;

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
              <CardTitle className="text-lg">Open in Telegram</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                This page must be opened from your Telegram bot as a Mini App (a Web App button), not as a regular link.
              </p>
              <p>
                If you are testing in a browser, add <span className="font-mono">?test=1</span> to the URL.
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
            <CardTitle className="text-lg">Test Mode</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Not running in Telegram. Enter a Telegram User ID to test:
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
          />
        )}
      </main>
    );
  }

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
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
  userName
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
}) {
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

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="text-center py-4">
        <Crown className="h-8 w-8 text-primary mx-auto mb-2" />
        <h1 className="text-xl font-semibold">
          {userName ? `Hi, ${userName}!` : 'My Subscription'}
        </h1>
      </div>

      {/* Status Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <Badge variant="outline" className={status.className}>
                {status.label}
              </Badge>
            </div>
            {subscriber.subscription_tiers?.name && (
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Plan</p>
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
                    ? `${daysRemaining} days remaining`
                    : 'Subscription expired'
                  }
                </p>
                <p className="text-xs text-muted-foreground">
                  Expires: {format(new Date(subscriber.subscription_end), 'MMMM d, yyyy')}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <Tabs defaultValue="extend" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="extend">Extend</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="manage">Manage</TabsTrigger>
        </TabsList>

        <TabsContent value="extend" className="mt-4 space-y-2">
          <p className="text-sm text-muted-foreground mb-4">
            Choose a plan to extend your subscription:
          </p>
          {tiers.map(tier => (
            <Card key={tier.id} className="cursor-pointer hover:border-primary transition-colors" onClick={() => onExtend(tier.id)}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">{tier.name}</p>
                  <p className="text-sm text-muted-foreground">{tier.duration_days} days</p>
                </div>
                <p className="text-lg font-bold">{tier.price}₽</p>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          {payments.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground">
                No payment history
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
                          {payment.subscription_tiers?.name || 'Payment'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(payment.payment_date), 'MMM d, yyyy')}
                        </p>
                      </div>
                    </div>
                    <p className="font-semibold">{Number(payment.amount).toLocaleString()}₽</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="manage" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Subscription Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Telegram ID</span>
                <span className="font-mono">{subscriber.telegram_user_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Member since</span>
                <span>{format(new Date(subscriber.created_at), 'MMM d, yyyy')}</span>
              </div>
              {subscriber.subscription_start && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current period start</span>
                  <span>{format(new Date(subscriber.subscription_start), 'MMM d, yyyy')}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {subscriber.status === 'active' && (
            <Button variant="destructive" className="w-full" onClick={onUnsubscribe}>
              Cancel Subscription
            </Button>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
