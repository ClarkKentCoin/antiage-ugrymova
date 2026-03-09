import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator,
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal, Pencil, Trash2, Calendar, Send, UserMinus, CheckCircle, Loader2, ArrowUpDown, ArrowUp, ArrowDown, MessageSquare } from 'lucide-react';
import { Subscriber, useDeleteSubscriber } from '@/hooks/useSubscribers';
import { useSendInvite, useKickUser, useCheckMembership } from '@/hooks/useTelegramChannel';
import { EditSubscriberDialog } from './EditSubscriberDialog';
import { ExtendSubscriptionDialog } from './ExtendSubscriptionDialog';
import { SendMessageDialog } from './SendMessageDialog';

type SortField = 'user' | 'created_at' | 'plan' | 'status' | 'subscription_end' | 'subscription_start';
type SortDirection = 'asc' | 'desc';

interface SubscriberTableProps {
  subscribers: Subscriber[];
}

const statusVariants: Record<string, string> = {
  active: 'status-active',
  expired: 'status-expired',
  inactive: 'status-inactive',
  cancelled: 'status-cancelled',
  grace_period: 'bg-amber-100 text-amber-800 border-amber-300',
};

export function SubscriberTable({ subscribers }: SubscriberTableProps) {
  const [editingSubscriber, setEditingSubscriber] = useState<Subscriber | null>(null);
  const [extendingSubscriber, setExtendingSubscriber] = useState<Subscriber | null>(null);
  const [messagingSubscriber, setMessagingSubscriber] = useState<Subscriber | null>(null);
  const [sortField, setSortField] = useState<SortField>('subscription_start');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const deleteSubscriber = useDeleteSubscriber();
  const sendInvite = useSendInvite();
  const kickUser = useKickUser();
  const checkMembership = useCheckMembership();

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection((field === 'created_at' || field === 'subscription_start') ? 'desc' : 'asc');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />;
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="ml-1 h-3 w-3" />
      : <ArrowDown className="ml-1 h-3 w-3" />;
  };

  const sortedSubscribers = useMemo(() => {
    if (!subscribers) return [];
    
    return [...subscribers].sort((a, b) => {
      let comparison = 0;
      
      switch (sortField) {
        case 'user': {
          const aName = a.telegram_username || a.first_name || '';
          const bName = b.telegram_username || b.first_name || '';
          comparison = aName.localeCompare(bName);
          break;
        }
        case 'created_at': {
          const aDate = new Date(a.created_at).getTime();
          const bDate = new Date(b.created_at).getTime();
          comparison = aDate - bDate;
          break;
        }
        case 'plan': {
          const aPlan = a.subscription_tiers?.name || '';
          const bPlan = b.subscription_tiers?.name || '';
          comparison = aPlan.localeCompare(bPlan);
          break;
        }
        case 'status': {
          const aStatus = a.status || '';
          const bStatus = b.status || '';
          comparison = aStatus.localeCompare(bStatus);
          break;
        }
        case 'subscription_end': {
          const aEnd = a.subscription_end ? new Date(a.subscription_end).getTime() : 0;
          const bEnd = b.subscription_end ? new Date(b.subscription_end).getTime() : 0;
          comparison = aEnd - bEnd;
          break;
        }
        case 'subscription_start': {
          const aStart = a.subscription_start ? new Date(a.subscription_start).getTime() : 0;
          const bStart = b.subscription_start ? new Date(b.subscription_start).getTime() : 0;
          comparison = aStart - bStart;
          break;
        }
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [subscribers, sortField, sortDirection]);

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to remove this subscriber?')) {
      deleteSubscriber.mutate(id);
    }
  };

  const handleSendInvite = (subscriber: Subscriber) => {
    sendInvite.mutate({ 
      telegram_user_id: subscriber.telegram_user_id, 
      subscriber_id: subscriber.id 
    });
  };

  const handleKickUser = (subscriber: Subscriber) => {
    if (confirm('Remove this user from the Telegram channel?')) {
      kickUser.mutate({ 
        telegram_user_id: subscriber.telegram_user_id, 
        subscriber_id: subscriber.id 
      });
    }
  };

  const handleCheckMembership = (subscriber: Subscriber) => {
    checkMembership.mutate({ 
      telegram_user_id: subscriber.telegram_user_id, 
      subscriber_id: subscriber.id 
    });
  };

  const getDisplayName = (subscriber: Subscriber) => {
    if (subscriber.telegram_username) return `@${subscriber.telegram_username}`;
    if (subscriber.first_name && subscriber.last_name) {
      return `${subscriber.first_name} ${subscriber.last_name}`;
    }
    if (subscriber.first_name) return subscriber.first_name;
    return '-';
  };

  const getFullName = (subscriber: Subscriber) => {
    if (subscriber.first_name && subscriber.last_name) {
      return `${subscriber.first_name} ${subscriber.last_name}`;
    }
    if (subscriber.first_name) return subscriber.first_name;
    if (subscriber.last_name) return subscriber.last_name;
    return '-';
  };

  const getDaysRemaining = (endDate: string | null) => {
    if (!endDate) return null;
    const end = new Date(endDate);
    const now = new Date();
    const diff = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  // Calculate days in grace period (days since subscription ended)
  const getGracePeriodDays = (subscriber: Subscriber) => {
    if (subscriber.status !== 'grace_period' || !subscriber.subscription_end) return null;
    const end = new Date(subscriber.subscription_end);
    const now = new Date();
    const daysSinceExpired = Math.ceil((now.getTime() - end.getTime()) / (1000 * 60 * 60 * 24));
    return daysSinceExpired;
  };

  return (
    <>
      <div className="w-full overflow-x-auto rounded-lg border border-border bg-card">
        <div className="min-w-[900px]">
          <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-8 px-2 -ml-2 font-medium hover:bg-transparent"
                  onClick={() => handleSort('user')}
                >
                  User
                  {getSortIcon('user')}
                </Button>
              </TableHead>
              <TableHead className="hidden lg:table-cell">Full Name</TableHead>
              <TableHead className="hidden lg:table-cell">Email</TableHead>
              <TableHead className="hidden xl:table-cell">Phone</TableHead>
              <TableHead>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-8 px-2 -ml-2 font-medium hover:bg-transparent"
                  onClick={() => handleSort('plan')}
                >
                  Plan
                  {getSortIcon('plan')}
                </Button>
              </TableHead>
              <TableHead>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-8 px-2 -ml-2 font-medium hover:bg-transparent"
                  onClick={() => handleSort('status')}
                >
                  Status
                  {getSortIcon('status')}
                </Button>
              </TableHead>
              <TableHead className="hidden lg:table-cell">Grace Period</TableHead>
              <TableHead>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-8 px-2 -ml-2 font-medium hover:bg-transparent"
                  onClick={() => handleSort('subscription_end')}
                >
                  Expires
                  {getSortIcon('subscription_end')}
                </Button>
              </TableHead>
              <TableHead>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-8 px-2 -ml-2 font-medium hover:bg-transparent"
                  onClick={() => handleSort('created_at')}
                >
                  Added
                  {getSortIcon('created_at')}
                </Button>
              </TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedSubscribers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="h-24 text-center text-muted-foreground whitespace-nowrap">
                  No subscribers yet
                </TableCell>
              </TableRow>
            ) : (
              sortedSubscribers.map((subscriber) => {
                const daysRemaining = getDaysRemaining(subscriber.subscription_end);
                const gracePeriodDays = getGracePeriodDays(subscriber);
                return (
                  <TableRow key={subscriber.id}>
                    <TableCell>
                      <div className="min-w-[120px]">
                        <p className="font-medium truncate max-w-[150px]">{getDisplayName(subscriber)}</p>
                        <p className="text-xs text-muted-foreground">
                          ID: {subscriber.telegram_user_id}
                        </p>
                        <p className="text-xs text-muted-foreground truncate max-w-[150px] lg:hidden">
                          {subscriber.email || '-'}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden lg:table-cell">
                      {getFullName(subscriber)}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden lg:table-cell">
                      <span className="truncate block max-w-[180px]">{subscriber.email || '-'}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden xl:table-cell">
                      {subscriber.phone_number || '-'}
                    </TableCell>
                    <TableCell>
                      {subscriber.subscription_tiers?.name || '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusVariants[subscriber.status] || statusVariants.inactive}>
                        {subscriber.status === 'grace_period' ? 'Grace Period' : subscriber.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {gracePeriodDays !== null ? (
                        <div className="flex items-center gap-1">
                          <span className="text-amber-600 font-medium">{gracePeriodDays}</span>
                          <span className="text-xs text-muted-foreground">день</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {subscriber.subscription_end ? (
                        <div>
                          <p className="text-sm">
                            {format(new Date(subscriber.subscription_end), 'MMM d, yyyy')}
                          </p>
                          {daysRemaining !== null && (
                            <p className={`text-xs ${daysRemaining <= 3 ? 'text-destructive' : 'text-muted-foreground'}`}>
                              {daysRemaining > 0 ? `${daysRemaining} days left` : 'Expired'}
                            </p>
                          )}
                        </div>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">
                        {format(new Date(subscriber.created_at), 'MMM d, yyyy')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(subscriber.created_at), 'HH:mm')}
                      </p>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem 
                            onClick={() => handleSendInvite(subscriber)}
                            disabled={sendInvite.isPending}
                          >
                            {sendInvite.isPending ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Send className="mr-2 h-4 w-4" />
                            )}
                            Отправить приглашение
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => handleCheckMembership(subscriber)}
                            disabled={checkMembership.isPending}
                          >
                            {checkMembership.isPending ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle className="mr-2 h-4 w-4" />
                            )}
                            Проверить в канале
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => handleKickUser(subscriber)}
                            disabled={kickUser.isPending}
                          >
                            {kickUser.isPending ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <UserMinus className="mr-2 h-4 w-4" />
                            )}
                            Удалить из канала
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setMessagingSubscriber(subscriber)}>
                            <MessageSquare className="mr-2 h-4 w-4" />
                            Отправить сообщение
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setEditingSubscriber(subscriber)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Редактировать
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setExtendingSubscriber(subscriber)}>
                            <Calendar className="mr-2 h-4 w-4" />
                            Продлить
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => handleDelete(subscriber.id)}
                            className="text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Удалить
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        </div>
      </div>

      <EditSubscriberDialog
        subscriber={editingSubscriber}
        open={!!editingSubscriber}
        onOpenChange={(open) => !open && setEditingSubscriber(null)}
      />

      <ExtendSubscriptionDialog
        subscriber={extendingSubscriber}
        open={!!extendingSubscriber}
        onOpenChange={(open) => !open && setExtendingSubscriber(null)}
      />

      <SendMessageDialog
        subscriber={messagingSubscriber}
        open={!!messagingSubscriber}
        onOpenChange={(open) => !open && setMessagingSubscriber(null)}
      />
    </>
  );
}
