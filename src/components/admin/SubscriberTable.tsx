import { useState } from 'react';
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
import { MoreHorizontal, Pencil, Trash2, Calendar, Send, UserMinus, CheckCircle, Loader2 } from 'lucide-react';
import { Subscriber, useDeleteSubscriber } from '@/hooks/useSubscribers';
import { useSendInvite, useKickUser, useCheckMembership } from '@/hooks/useTelegramChannel';
import { EditSubscriberDialog } from './EditSubscriberDialog';
import { ExtendSubscriptionDialog } from './ExtendSubscriptionDialog';

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
  const deleteSubscriber = useDeleteSubscriber();
  const sendInvite = useSendInvite();
  const kickUser = useKickUser();
  const checkMembership = useCheckMembership();

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
                <TableHead>User</TableHead>
                <TableHead className="hidden lg:table-cell">Full Name</TableHead>
                <TableHead className="hidden lg:table-cell">Email</TableHead>
                <TableHead className="hidden xl:table-cell">Phone</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden lg:table-cell">Grace Period</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscribers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-muted-foreground whitespace-nowrap">
                  No subscribers yet
                </TableCell>
              </TableRow>
            ) : (
              subscribers.map((subscriber) => {
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
    </>
  );
}
