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
import { usePaymentHistory } from '@/hooks/usePaymentHistory';
import { format } from 'date-fns';

const paymentMethodLabels: Record<string, string> = {
  manual: 'Manual',
  robokassa: 'Robokassa',
  other: 'Other',
};

export default function AdminPayments() {
  const { data: payments, isLoading } = usePaymentHistory();

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
          <p className="text-muted-foreground">All recorded payments</p>
        </div>

        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Subscriber</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No payments recorded yet
                  </TableCell>
                </TableRow>
              ) : (
                payments?.map(payment => (
                  <TableRow key={payment.id}>
                    <TableCell>
                      {format(new Date(payment.payment_date), 'MMM d, yyyy HH:mm')}
                    </TableCell>
                    <TableCell>
                      {payment.subscribers?.telegram_username 
                        ? `@${payment.subscribers.telegram_username}`
                        : payment.subscribers?.first_name || 'Unknown'}
                    </TableCell>
                    <TableCell>
                      {payment.subscription_tiers?.name || '-'}
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
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </AdminLayout>
  );
}
