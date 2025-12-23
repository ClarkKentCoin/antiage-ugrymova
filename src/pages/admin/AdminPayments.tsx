import { useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePaymentHistory, PaymentStatus } from '@/hooks/usePaymentHistory';
import { format } from 'date-fns';

const paymentMethodLabels: Record<string, string> = {
  manual: 'Manual',
  robokassa: 'Robokassa',
  other: 'Other',
};

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  completed: { label: 'Оплачено', variant: 'default' },
  pending: { label: 'Ожидает оплаты', variant: 'secondary' },
  failed: { label: 'Неудачно', variant: 'destructive' },
};

type FilterStatus = PaymentStatus | 'all';

const filterTabs: { value: FilterStatus; label: string }[] = [
  { value: 'all', label: 'Все платежи' },
  { value: 'completed', label: 'Успешные' },
  { value: 'pending', label: 'В ожидании' },
  { value: 'failed', label: 'Неудачные' },
];

export default function AdminPayments() {
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  
  const { data: payments, isLoading } = usePaymentHistory({
    status: statusFilter === 'all' ? null : statusFilter,
  });

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-muted rounded" />
          <div className="h-64 bg-muted rounded-lg" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Payment History</h1>
          <p className="text-muted-foreground">Все попытки оплаты</p>
        </div>

        <div className="flex gap-2 flex-wrap">
          {filterTabs.map((tab) => (
            <Button
              key={tab.value}
              variant={statusFilter === tab.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(tab.value)}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Подписчик</TableHead>
                <TableHead>Тариф</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Метод</TableHead>
                <TableHead>Примечание</TableHead>
                <TableHead className="text-right">Сумма</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    Платежей не найдено
                  </TableCell>
                </TableRow>
              ) : (
                payments?.map(payment => {
                  const status = statusConfig[payment.status] || { label: payment.status, variant: 'outline' as const };
                  return (
                    <TableRow key={payment.id}>
                      <TableCell>
                        {format(new Date(payment.created_at), 'dd.MM.yyyy HH:mm')}
                      </TableCell>
                      <TableCell>
                        {payment.subscribers?.telegram_username 
                          ? `@${payment.subscribers.telegram_username}`
                          : payment.subscribers?.first_name || 'Неизвестно'}
                      </TableCell>
                      <TableCell>
                        {payment.subscription_tiers?.name || '-'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>
                          {status.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {paymentMethodLabels[payment.payment_method] || payment.payment_method}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-muted-foreground">
                        {payment.payment_note || '-'}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {Number(payment.amount).toLocaleString()}₽
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </AdminLayout>
  );
}
