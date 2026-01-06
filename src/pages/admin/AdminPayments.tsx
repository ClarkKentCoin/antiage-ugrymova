import { useState, useMemo } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { usePaymentHistory, usePaymentCounts, PaymentStatus } from '@/hooks/usePaymentHistory';
import { format } from 'date-fns';
import { Download } from 'lucide-react';

const paymentMethodLabels: Record<string, string> = {
  manual: 'Manual',
  robokassa: 'Robokassa',
  robokassa_single: 'Robokassa',
  robokassa_recurring: 'Robokassa (рек.)',
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

const PAGE_SIZE_OPTIONS = [25, 50, 100];

export default function AdminPayments() {
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  
  const { data: payments, isLoading } = usePaymentHistory({
    status: statusFilter === 'all' ? null : statusFilter,
  });
  
  const { data: counts } = usePaymentCounts();

  const paginatedPayments = useMemo(() => {
    if (!payments) return [];
    const startIndex = (currentPage - 1) * pageSize;
    return payments.slice(startIndex, startIndex + pageSize);
  }, [payments, currentPage, pageSize]);

  const totalPages = useMemo(() => {
    if (!payments) return 1;
    return Math.ceil(payments.length / pageSize);
  }, [payments, pageSize]);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const handlePageSizeChange = (value: string) => {
    setPageSize(Number(value));
    setCurrentPage(1);
  };

  const handleStatusFilterChange = (status: FilterStatus) => {
    setStatusFilter(status);
    setCurrentPage(1);
  };

  const exportToCSV = () => {
    if (!payments || payments.length === 0) return;

    const headers = ['Дата', 'Подписчик', 'Тариф', 'Статус', 'Метод', 'Примечание', 'Сумма'];
    const rows = payments.map(payment => [
      format(new Date(payment.created_at), 'dd.MM.yyyy HH:mm'),
      payment.subscribers?.telegram_username 
        ? `@${payment.subscribers.telegram_username}`
        : payment.subscribers?.first_name || 'Неизвестно',
      payment.subscription_tiers?.name || '-',
      statusConfig[payment.status]?.label || payment.status,
      paymentMethodLabels[payment.payment_method] || payment.payment_method,
      payment.payment_note || '-',
      Number(payment.amount).toString(),
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `payments_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const getCountForStatus = (status: FilterStatus): number => {
    if (!counts) return 0;
    return status === 'all' ? counts.all : counts[status];
  };

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
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Payment History</h1>
            <p className="text-muted-foreground">Все попытки оплаты</p>
          </div>
          <Button onClick={exportToCSV} variant="outline" disabled={!payments?.length} className="w-full sm:w-auto">
            <Download className="h-4 w-4 mr-2" />
            Экспорт CSV
          </Button>
        </div>

        <div className="flex gap-2 flex-wrap">
          {filterTabs.map((tab) => (
            <Button
              key={tab.value}
              variant={statusFilter === tab.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleStatusFilterChange(tab.value)}
              className="flex-1 sm:flex-none"
            >
              <span className="truncate">{tab.label}</span>
              <Badge variant="secondary" className="ml-2 bg-background/20">
                {getCountForStatus(tab.value)}
              </Badge>
            </Button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table className="min-w-[700px]">
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
              {paginatedPayments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    Платежей не найдено
                  </TableCell>
                </TableRow>
              ) : (
                paginatedPayments.map(payment => {
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
                      <TableCell className="text-right font-medium whitespace-nowrap">
                        {Number(payment.amount).toLocaleString()}₽
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {payments && payments.length > 0 && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Показывать по:</span>
              <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map(size => (
                    <SelectItem key={size} value={size.toString()}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span>
                Показано {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, payments.length)} из {payments.length}
              </span>
            </div>

            {totalPages > 1 && (
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious 
                      onClick={() => handlePageChange(currentPage - 1)}
                      className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum: number;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    return (
                      <PaginationItem key={pageNum}>
                        <PaginationLink
                          onClick={() => handlePageChange(pageNum)}
                          isActive={currentPage === pageNum}
                          className="cursor-pointer"
                        >
                          {pageNum}
                        </PaginationLink>
                      </PaginationItem>
                    );
                  })}
                  <PaginationItem>
                    <PaginationNext 
                      onClick={() => handlePageChange(currentPage + 1)}
                      className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
