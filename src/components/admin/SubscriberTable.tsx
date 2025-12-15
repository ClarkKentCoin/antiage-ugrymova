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
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal, Pencil, Trash2, Calendar } from 'lucide-react';
import { Subscriber, useDeleteSubscriber } from '@/hooks/useSubscribers';
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
};

export function SubscriberTable({ subscribers }: SubscriberTableProps) {
  const [editingSubscriber, setEditingSubscriber] = useState<Subscriber | null>(null);
  const [extendingSubscriber, setExtendingSubscriber] = useState<Subscriber | null>(null);
  const deleteSubscriber = useDeleteSubscriber();

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to remove this subscriber?')) {
      deleteSubscriber.mutate(id);
    }
  };

  const getDisplayName = (subscriber: Subscriber) => {
    if (subscriber.telegram_username) return `@${subscriber.telegram_username}`;
    if (subscriber.first_name) {
      return subscriber.last_name 
        ? `${subscriber.first_name} ${subscriber.last_name}`
        : subscriber.first_name;
    }
    return `ID: ${subscriber.telegram_user_id}`;
  };

  const getDaysRemaining = (endDate: string | null) => {
    if (!endDate) return null;
    const end = new Date(endDate);
    const now = new Date();
    const diff = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  return (
    <>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscribers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No subscribers yet
                </TableCell>
              </TableRow>
            ) : (
              subscribers.map((subscriber) => {
                const daysRemaining = getDaysRemaining(subscriber.subscription_end);
                return (
                  <TableRow key={subscriber.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{getDisplayName(subscriber)}</p>
                        <p className="text-sm text-muted-foreground">
                          {subscriber.telegram_user_id}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {subscriber.subscription_tiers?.name || '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusVariants[subscriber.status]}>
                        {subscriber.status}
                      </Badge>
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
                          <DropdownMenuItem onClick={() => setEditingSubscriber(subscriber)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setExtendingSubscriber(subscriber)}>
                            <Calendar className="mr-2 h-4 w-4" />
                            Extend
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => handleDelete(subscriber.id)}
                            className="text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Remove
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
