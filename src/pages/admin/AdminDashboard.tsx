import { useMemo } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { StatsCard } from '@/components/admin/StatsCard';
import { useSubscribers } from '@/hooks/useSubscribers';
import { usePaymentHistory } from '@/hooks/usePaymentHistory';
import { useSubscriptionTiers } from '@/hooks/useSubscriptionTiers';
import { Users, CreditCard, TrendingUp, AlertTriangle, Repeat, Banknote, Tag } from 'lucide-react';
import { format, isAfter, isBefore, addDays } from 'date-fns';

export default function AdminDashboard() {
  const { data: subscribers, isLoading: loadingSubscribers } = useSubscribers();
  const { data: payments, isLoading: loadingPayments } = usePaymentHistory({ status: 'completed' });
  const { data: tiers, isLoading: loadingTiers } = useSubscriptionTiers();

  const activeSubscribers = subscribers?.filter(s => s.status === 'active').length || 0;
  const expiringSoon = subscribers?.filter(s => {
    if (!s.subscription_end || s.status !== 'active') return false;
    const end = new Date(s.subscription_end);
    return isAfter(end, new Date()) && isBefore(end, addDays(new Date(), 7));
  }).length || 0;

  const singlePaymentUsers = subscribers?.filter(s =>
    s.subscriber_payment_method === 'manual' || s.subscriber_payment_method === 'robokassa_single'
  ).length || 0;

  const recurrentPaymentUsers = subscribers?.filter(s =>
    s.subscriber_payment_method === 'robokassa_recurring'
  ).length || 0;

  const tierCounts = useMemo(() => {
    if (!tiers || !subscribers) return [];
    return tiers
      .filter(tier => tier.show_in_dashboard)
      .map(tier => ({
        id: tier.id,
        name: tier.name,
        count: subscribers.filter(s => s.tier_id === tier.id).length,
      }));
  }, [tiers, subscribers]);

  const getPaymentCurrency = (payment: { currency?: string | null }) =>
    (payment.currency || 'RUB').toUpperCase();

  const formatMoney = (amount: number, currency: string) => {
    const cur = (currency || 'RUB').toUpperCase();
    const formatted = Number(amount).toLocaleString('ru-RU');
    if (cur === 'RUB') return `${formatted}₽`;
    return `${formatted} ${cur}`;
  };

  const now = new Date();
  const thisMonthPayments = payments?.filter(p => {
    const d = new Date(p.payment_date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }) || [];

  const sumByCurrency = (list: typeof payments extends (infer T)[] | undefined ? T[] : never[]) => {
    const acc: Record<string, number> = { RUB: 0, EUR: 0, USD: 0 };
    (list as any[]).forEach(p => {
      const cur = getPaymentCurrency(p);
      acc[cur] = (acc[cur] || 0) + Number(p.amount);
    });
    return acc;
  };

  const thisMonthRevenueByCurrency = sumByCurrency(thisMonthPayments as any);
  const totalRevenueByCurrency = sumByCurrency((payments || []) as any);

  const isRub = (p: any) => {
    const c = (p.currency || 'RUB').toUpperCase();
    return c === 'RUB';
  };
  const isEur = (p: any) => (p.currency || '').toUpperCase() === 'EUR';

  const paymentsList = payments || [];
  const rubOneTimeCount = paymentsList.filter(p => isRub(p) && (p.payment_method === 'manual' || p.payment_method === 'robokassa_single')).length;
  const rubRecurringCount = paymentsList.filter(p => isRub(p) && p.payment_method === 'robokassa_recurring').length;
  const eurOneTimeCount = paymentsList.filter(p => isEur(p) && p.payment_method === 'stripe_single').length;
  const eurRecurringCount = paymentsList.filter(p => isEur(p) && p.payment_method === 'stripe_recurring').length;
  const totalOneTimeCount = paymentsList.filter(p => ['manual', 'robokassa_single', 'stripe_single'].includes(p.payment_method)).length;
  const totalRecurringCount = paymentsList.filter(p => ['robokassa_recurring', 'stripe_recurring'].includes(p.payment_method)).length;

  if (loadingSubscribers || loadingPayments || loadingTiers) {
    return (
      <AdminLayout>
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-muted rounded" />
          <div className="grid gap-4 md:grid-cols-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-32 bg-muted rounded-lg" />
            ))}
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-muted-foreground">Overview of your subscription business</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="Active Subscribers"
            value={activeSubscribers}
            description={`${subscribers?.length || 0} total`}
            icon={Users}
          />
          <StatsCard
            title="Expiring Soon"
            value={expiringSoon}
            description="Within 7 days"
            icon={AlertTriangle}
            trend={expiringSoon > 0 ? 'down' : 'neutral'}
          />
          {(['RUB', 'EUR'] as const).map(cur => (
            <StatsCard
              key={`month-${cur}`}
              title={`This Month ${cur}`}
              value={formatMoney(thisMonthRevenueByCurrency[cur] || 0, cur)}
              description={format(new Date(), 'MMMM yyyy')}
              icon={cur === 'RUB' ? Banknote : CreditCard}
            />
          ))}
          {(['RUB', 'EUR'] as const).map(cur => (
            <StatsCard
              key={`total-${cur}`}
              title={`Total ${cur}`}
              value={formatMoney(totalRevenueByCurrency[cur] || 0, cur)}
              description="All time"
              icon={cur === 'RUB' ? CreditCard : TrendingUp}
            />
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="RUB One-time"
            value={rubOneTimeCount}
            description="Robokassa / manual"
            icon={Banknote}
          />
          <StatsCard
            title="RUB Recurring"
            value={rubRecurringCount}
            description="Robokassa auto-renewal"
            icon={Repeat}
          />
          <StatsCard
            title="EUR One-time"
            value={eurOneTimeCount}
            description="Stripe"
            icon={CreditCard}
          />
          <StatsCard
            title="EUR Recurring"
            value={eurRecurringCount}
            description="Stripe auto-renewal"
            icon={Repeat}
          />
          <StatsCard
            title="Total One-time"
            value={totalOneTimeCount}
            description="All one-time payments"
            icon={Banknote}
          />
          <StatsCard
            title="Total Recurring"
            value={totalRecurringCount}
            description="All recurring payments"
            icon={Repeat}
          />
        </div>

        {tierCounts.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Tiers</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {tierCounts.map(tc => (
                <StatsCard
                  key={tc.id}
                  title={tc.name}
                  value={tc.count}
                  description="subscribers"
                  icon={Tag}
                />
              ))}
            </div>
          </div>
        )}

        {/* Recent Activity */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Recent Payments</h2>
          <div className="rounded-lg border border-border bg-card">
            {payments?.slice(0, 5).map(payment => (
              <div key={payment.id} className="flex items-center justify-between border-b border-border p-4 last:border-0">
                <div>
                  <p className="font-medium">
                    {payment.subscribers?.telegram_username 
                      ? `@${payment.subscribers.telegram_username}`
                      : payment.subscribers?.first_name || 'Unknown'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {payment.subscription_tiers?.name || 'Manual payment'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium">{formatMoney(Number(payment.amount), getPaymentCurrency(payment))}</p>
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(payment.payment_date), 'MMM d, HH:mm')}
                  </p>
                </div>
              </div>
            ))}
            {!payments?.length && (
              <p className="p-4 text-center text-muted-foreground">No payments yet</p>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
