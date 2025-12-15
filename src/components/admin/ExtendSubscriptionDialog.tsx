import { useState } from 'react';
import { addDays, format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Subscriber, useUpdateSubscriber } from '@/hooks/useSubscribers';
import { useSubscriptionTiers } from '@/hooks/useSubscriptionTiers';
import { useCreatePayment } from '@/hooks/usePaymentHistory';

interface ExtendSubscriptionDialogProps {
  subscriber: Subscriber | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExtendSubscriptionDialog({ subscriber, open, onOpenChange }: ExtendSubscriptionDialogProps) {
  const { data: tiers } = useSubscriptionTiers();
  const updateSubscriber = useUpdateSubscriber();
  const createPayment = useCreatePayment();

  const [formData, setFormData] = useState({
    tier_id: '',
    payment_note: '',
  });

  const selectedTier = tiers?.find((t) => t.id === formData.tier_id);
  
  const getNewEndDate = () => {
    if (!selectedTier) return null;
    
    const baseDate = subscriber?.subscription_end 
      ? new Date(subscriber.subscription_end)
      : new Date();
    
    // If subscription is expired, start from today
    const startFrom = baseDate > new Date() ? baseDate : new Date();
    return addDays(startFrom, selectedTier.duration_days);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subscriber || !selectedTier) return;

    const newEndDate = getNewEndDate();
    
    // Update subscriber
    updateSubscriber.mutate({
      id: subscriber.id,
      tier_id: formData.tier_id,
      subscription_end: newEndDate?.toISOString(),
      status: 'active',
    }, {
      onSuccess: () => {
        // Record payment
        createPayment.mutate({
          subscriber_id: subscriber.id,
          tier_id: formData.tier_id,
          amount: selectedTier.price,
          payment_method: 'manual',
          payment_note: formData.payment_note || `Extended subscription: ${selectedTier.name}`,
        });
        
        onOpenChange(false);
        setFormData({ tier_id: '', payment_note: '' });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Extend Subscription</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {subscriber && (
            <div className="rounded-lg bg-muted p-3">
              <p className="text-sm text-muted-foreground">
                Current expiry:{' '}
                <span className="font-medium text-foreground">
                  {subscriber.subscription_end 
                    ? format(new Date(subscriber.subscription_end), 'MMMM d, yyyy')
                    : 'No active subscription'
                  }
                </span>
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="tier">Add Time Period</Label>
            <Select
              value={formData.tier_id}
              onValueChange={(value) => setFormData({ ...formData, tier_id: value })}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a tier" />
              </SelectTrigger>
              <SelectContent>
                {tiers?.filter(t => t.is_active).map((tier) => (
                  <SelectItem key={tier.id} value={tier.id}>
                    {tier.name} - {tier.price}₽ ({tier.duration_days} days)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedTier && (
            <div className="rounded-lg bg-primary/10 p-3 text-sm">
              <p className="text-foreground">
                New expiry date:{' '}
                <span className="font-medium">
                  {format(getNewEndDate()!, 'MMMM d, yyyy')}
                </span>
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="payment_note">Payment Note</Label>
            <Textarea
              id="payment_note"
              placeholder="e.g., Cash payment received..."
              value={formData.payment_note}
              onChange={(e) => setFormData({ ...formData, payment_note: e.target.value })}
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateSubscriber.isPending}>
              {updateSubscriber.isPending ? 'Extending...' : 'Extend Subscription'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
