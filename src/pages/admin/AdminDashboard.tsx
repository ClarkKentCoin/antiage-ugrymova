import { AdminLayout } from '@/components/admin/AdminLayout';
import { StatsCard } from '@/components/admin/StatsCard';
import { useSubscribers } from '@/hooks/useSubscribers';
import { usePaymentHistory } from '@/hooks/usePaymentHistory';
import { Users, CreditCard, TrendingUp, AlertTriangle } from 'lucide-react';
import { format, isAfter, isBefore, addDays } from 'date-fns';

export default function AdminDashboard() {
  const { data: subscribers, isLoading: loadingSubscribers } = useSubscribers();
  const { data: payments, isLoading: loadingPayments } = usePaymentHistory({ status: 'completed' });

  const activeSubscribers = subscribers?.filter(s => s.status === 'active').length || 0;
  const expiringSoon = subscribers?.filter(s => {
    if (!s.subscription_end || s.status !== 'active') return false;
    const end = new Date(s.subscription_end);
    return isAfter(end, new Date()) && isBefore(end, addDays(new Date(), 7));
  }).length || 0;

  const thisMonthRevenue = payments?.filter(p => {
    const paymentDate = new Date(p.payment_date);
    const now = new Date();
    return paymentDate.getMonth() === now.getMonth() && 
           paymentDate.getFullYear() === now.getFullYear();
  }).reduce((sum, p) => sum + Number(p.amount), 0) || 0;

  const totalRevenue = payments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;

  if (loadingSubscribers || loadingPayments) {
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
          <StatsCard
            title="This Month"
            value={`${thisMonthRevenue.toLocaleString()}₽`}
            description={format(new Date(), 'MMMM yyyy')}
            icon={TrendingUp}
          />
          <StatsCard
            title="Total Revenue"
            value={`${totalRevenue.toLocaleString()}₽`}
            description="All time"
            icon={CreditCard}
          />
        </div>

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
                  <p className="font-medium">{Number(payment.amount).toLocaleString()}₽</p>
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
