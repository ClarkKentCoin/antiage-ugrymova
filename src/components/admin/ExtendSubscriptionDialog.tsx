import { useState } from 'react';
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
import { useSubscriptionTiers, formatDuration } from '@/hooks/useSubscriptionTiers';
import { useCreatePayment } from '@/hooks/usePaymentHistory';
import { computeNextEndISO, getTierInterval, formatDateInTimezone } from '@/lib/dateUtils';

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
  
  // Compute new end date using calendar intervals with stacking
  const getNewEndDate = (): string | null => {
    if (!selectedTier) return null;
    
    const nowISO = new Date().toISOString();
    const currentEndISO = subscriber?.subscription_end || null;
    const { unit, count, timezone } = getTierInterval(selectedTier);
    
    return computeNextEndISO(nowISO, currentEndISO, unit, count, timezone);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subscriber || !selectedTier) return;

    const newEndISO = getNewEndDate();
    
    // Update subscriber - never overwrite subscription_start if already set
    updateSubscriber.mutate({
      id: subscriber.id,
      tier_id: formData.tier_id,
      subscription_end: newEndISO || undefined,
      status: 'active',
    }, {
      onSuccess: () => {
        // Record payment
        createPayment.mutate({
          subscriber_id: subscriber.id,
          tier_id: formData.tier_id,
          amount: selectedTier.price,
          payment_method: 'manual',
          payment_note: formData.payment_note || `Продление подписки: ${selectedTier.name}`,
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
          <DialogTitle>Продлить подписку</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {subscriber && (
            <div className="rounded-lg bg-muted p-3">
              <p className="text-sm text-muted-foreground">
                Текущий срок:{' '}
                <span className="font-medium text-foreground">
                  {subscriber.subscription_end 
                    ? formatDateInTimezone(subscriber.subscription_end)
                    : 'Нет активной подписки'
                  }
                </span>
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="tier">Добавить период</Label>
            <Select
              value={formData.tier_id}
              onValueChange={(value) => setFormData({ ...formData, tier_id: value })}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="Выберите тариф" />
              </SelectTrigger>
              <SelectContent>
                {tiers?.filter(t => t.is_active).map((tier) => (
                  <SelectItem key={tier.id} value={tier.id}>
                    {tier.name} - {tier.price}₽ ({formatDuration(tier)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedTier && (() => {
            const interval = getTierInterval(selectedTier);
            const newEnd = getNewEndDate();
            return (
              <div className="rounded-lg bg-primary/10 p-3 text-sm">
                <p className="text-foreground">
                  Новый срок:{' '}
                  <span className="font-medium">
                    {newEnd ? formatDateInTimezone(newEnd, interval.timezone) : '—'}
                  </span>
                </p>
              </div>
            );
          })()}

          <div className="space-y-2">
            <Label htmlFor="payment_note">Примечание к платежу</Label>
            <Textarea
              id="payment_note"
              placeholder="Например: Оплата наличными..."
              value={formData.payment_note}
              onChange={(e) => setFormData({ ...formData, payment_note: e.target.value })}
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={updateSubscriber.isPending}>
              {updateSubscriber.isPending ? 'Продление...' : 'Продлить подписку'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
