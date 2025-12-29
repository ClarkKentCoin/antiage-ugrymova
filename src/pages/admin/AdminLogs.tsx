import { useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { useSystemLogs, useLogEventTypes, LogFilters, SystemLog } from '@/hooks/useSystemLogs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronLeft, ChevronRight, Search, ExternalLink, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';

const SOURCES = ['admin_ui', 'edge_fn', 'cron', 'robokassa', 'telegram_webhook', 'db_trigger'];
const LEVELS = ['info', 'warn', 'error'];
const DATE_RANGES = [
  { value: '24h', label: 'Последние 24ч' },
  { value: '7d', label: 'Последние 7 дней' },
  { value: '30d', label: 'Последние 30 дней' },
  { value: 'all', label: 'Все время' },
];

export default function AdminLogs() {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [selectedLog, setSelectedLog] = useState<(SystemLog & { subscribers: any }) | null>(null);
  const [filters, setFilters] = useState<LogFilters>({
    search: '',
    email: '',
    event_type: 'all',
    level: 'all',
    source: 'all',
    dateRange: '7d',
  });

  const { data, isLoading } = useSystemLogs(filters, page);
  const { data: eventTypes } = useLogEventTypes();

  const pageSize = 50;
  const totalPages = Math.ceil((data?.totalCount || 0) / pageSize);

  const getLevelIcon = (level: string) => {
    switch (level) {
      case 'error':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      case 'warn':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Info className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getLevelBadge = (level: string) => {
    switch (level) {
      case 'error':
        return <Badge variant="destructive">error</Badge>;
      case 'warn':
        return <Badge className="bg-yellow-500 hover:bg-yellow-600">warn</Badge>;
      default:
        return <Badge variant="secondary">info</Badge>;
    }
  };

  const getSubscriberDisplay = (log: SystemLog & { subscribers: any }) => {
    if (log.subscribers) {
      const { telegram_username, first_name, last_name, email } = log.subscribers;
      if (email) return email;
      if (telegram_username) return `@${telegram_username}`;
      if (first_name || last_name) return `${first_name || ''} ${last_name || ''}`.trim();
    }
    if (log.telegram_user_id) return `ID: ${log.telegram_user_id}`;
    return '—';
  };

  const handleOpenSubscriber = (subscriberId: string) => {
    navigate(`/admin/subscribers?highlight=${subscriberId}`);
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Логи системы</h1>
          <p className="text-muted-foreground">История событий и действий</p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по сообщению, событию, request_id..."
              value={filters.search}
              onChange={(e) => {
                setFilters({ ...filters, search: e.target.value });
                setPage(0);
              }}
              className="pl-9"
            />
          </div>

          <div className="min-w-[180px]">
            <Input
              placeholder="Email подписчика..."
              value={filters.email}
              onChange={(e) => {
                setFilters({ ...filters, email: e.target.value });
                setPage(0);
              }}
            />
          </div>

          <Select
            value={filters.event_type}
            onValueChange={(value) => {
              setFilters({ ...filters, event_type: value });
              setPage(0);
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Тип события" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все события</SelectItem>
              {eventTypes?.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.level}
            onValueChange={(value) => {
              setFilters({ ...filters, level: value });
              setPage(0);
            }}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Уровень" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все уровни</SelectItem>
              {LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.source}
            onValueChange={(value) => {
              setFilters({ ...filters, source: value });
              setPage(0);
            }}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Источник" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все источники</SelectItem>
              {SOURCES.map((source) => (
                <SelectItem key={source} value={source}>
                  {source}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.dateRange}
            onValueChange={(value: '24h' | '7d' | '30d' | 'all') => {
              setFilters({ ...filters, dateRange: value });
              setPage(0);
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Период" />
            </SelectTrigger>
            <SelectContent>
              {DATE_RANGES.map((range) => (
                <SelectItem key={range.value} value={range.value}>
                  {range.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">Дата/Время</TableHead>
                <TableHead className="w-[80px]">Уровень</TableHead>
                <TableHead className="w-[180px]">Событие</TableHead>
                <TableHead className="w-[120px]">Источник</TableHead>
                <TableHead className="w-[150px]">Подписчик</TableHead>
                <TableHead>Сообщение</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mx-auto" />
                  </TableCell>
                </TableRow>
              ) : data?.logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Логи не найдены
                  </TableCell>
                </TableRow>
              ) : (
                data?.logs.map((log) => (
                  <TableRow
                    key={log.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedLog(log)}
                  >
                    <TableCell className="font-mono text-xs">
                      {format(new Date(log.created_at), 'dd.MM.yyyy HH:mm:ss', { locale: ru })}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {getLevelIcon(log.level)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {log.event_type}
                      </code>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {log.source}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {getSubscriberDisplay(log)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground truncate max-w-[300px]">
                      {log.message || '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Всего: {data?.totalCount || 0} записей
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">
              {page + 1} / {Math.max(1, totalPages)}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedLog && getLevelIcon(selectedLog.level)}
              <span>{selectedLog?.event_type}</span>
            </DialogTitle>
          </DialogHeader>

          {selectedLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Дата/Время</p>
                  <p className="font-medium">
                    {format(new Date(selectedLog.created_at), 'dd.MM.yyyy HH:mm:ss', { locale: ru })}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Уровень</p>
                  {getLevelBadge(selectedLog.level)}
                </div>
                <div>
                  <p className="text-muted-foreground">Источник</p>
                  <Badge variant="outline">{selectedLog.source}</Badge>
                </div>
                <div>
                  <p className="text-muted-foreground">Request ID</p>
                  <code className="text-xs">{selectedLog.request_id || '—'}</code>
                </div>
              </div>

              {selectedLog.message && (
                <div>
                  <p className="text-muted-foreground text-sm mb-1">Сообщение</p>
                  <p>{selectedLog.message}</p>
                </div>
              )}

              {selectedLog.subscriber_id && (
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-muted-foreground text-sm">Подписчик:</p>
                  <p>{getSubscriberDisplay(selectedLog)}</p>
                  {selectedLog.subscribers?.email && (
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                      {selectedLog.subscribers.email}
                    </code>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      handleOpenSubscriber(selectedLog.subscriber_id!);
                      setSelectedLog(null);
                    }}
                  >
                    <ExternalLink className="h-4 w-4 mr-1" />
                    Открыть
                  </Button>
                </div>
              )}

              <div>
                <p className="text-muted-foreground text-sm mb-2">Payload (JSON)</p>
                <ScrollArea className="h-[200px] rounded-lg border bg-muted p-3">
                  <pre className="text-xs font-mono whitespace-pre-wrap">
                    {JSON.stringify(selectedLog.payload, null, 2)}
                  </pre>
                </ScrollArea>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
