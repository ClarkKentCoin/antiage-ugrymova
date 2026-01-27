import { useState } from 'react';
import { addDays, addMonths, addYears, isPast } from 'date-fns';
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
import { formatDateInTimezone } from '@/lib/dateUtils';
import { logEvent, generateRequestId } from '@/lib/logger';

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
  
  // Compute new end date using explicit date-fns calculation
  const calculateNewEndDate = (): { startDate: Date; newEndDate: Date; isExpired: boolean } | null => {
    if (!selectedTier) return null;
    
    // 1. Determine Start Date (Now if expired/null, else current end date)
    const currentEnd = subscriber?.subscription_end ? new Date(subscriber.subscription_end) : null;
    const isExpired = !currentEnd || isPast(currentEnd);
    const startDate = isExpired ? new Date() : currentEnd;
    
    // 2. Calculate Duration based on Tier
    let newEndDate = new Date(startDate);
    const { interval_unit, interval_count, duration_days } = selectedTier;
    
    // Prefer interval fields, fallback to duration_days
    if (interval_unit && interval_count) {
      if (interval_unit === 'year') newEndDate = addYears(startDate, interval_count);
      else if (interval_unit === 'month') newEndDate = addMonths(startDate, interval_count);
      else if (interval_unit === 'week') newEndDate = addDays(startDate, interval_count * 7);
      else if (interval_unit === 'day') newEndDate = addDays(startDate, interval_count);
      else newEndDate = addDays(startDate, duration_days || 30);
    } else {
      newEndDate = addDays(startDate, duration_days || 30);
    }
    
    return { startDate, newEndDate, isExpired };
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subscriber || !selectedTier) return;

    // CRITICAL: Calculate new end date explicitly using date-fns
    const calcResult = calculateNewEndDate();
    if (!calcResult) {
      console.error('[ExtendSubscriptionDialog] Failed to calculate new end date');
      return;
    }
    
    const { startDate, newEndDate, isExpired } = calcResult;
    const newEndISO = newEndDate.toISOString();
    const oldEndISO = subscriber.subscription_end;
    const requestId = generateRequestId();
    
    // Debug logging
    console.log('[ExtendSubscriptionDialog] Manual Calc:', { 
      isExpired, 
      startDate: startDate.toISOString(), 
      oldEndISO,
      newEndISO,
      tier: selectedTier.name,
      interval_unit: selectedTier.interval_unit,
      interval_count: selectedTier.interval_count,
    });
    
    // Update subscriber with explicit subscription_end - never pass undefined!
    updateSubscriber.mutate({
      id: subscriber.id,
      tier_id: formData.tier_id,
      subscription_end: newEndISO, // Always a valid ISO string from explicit calculation
      status: 'active',
      _oldStatus: subscriber.status, // Pass old status for status change detection
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

        // Log success
        logEvent({
          event_type: 'subscription.extended',
          source: 'admin_ui',
          subscriber_id: subscriber.id,
          telegram_user_id: subscriber.telegram_user_id,
          tier_id: formData.tier_id,
          request_id: requestId,
          message: 'Admin extended subscription',
          payload: {
            old_end: oldEndISO,
            new_end: newEndISO,
            tier_name: selectedTier.name,
            amount: selectedTier.price,
            was_expired: isExpired,
          },
        });
        
        onOpenChange(false);
        setFormData({ tier_id: '', payment_note: '' });
      },
      onError: (error) => {
        logEvent({
          level: 'error',
          event_type: 'admin.error',
          source: 'admin_ui',
          subscriber_id: subscriber.id,
          request_id: requestId,
          message: 'Failed to extend subscription',
          payload: { error: error.message },
        });
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
            const calcResult = calculateNewEndDate();
            return (
              <div className="rounded-lg bg-primary/10 p-3 text-sm">
                <p className="text-foreground">
                  Новый срок:{' '}
                  <span className="font-medium">
                    {calcResult ? formatDateInTimezone(calcResult.newEndDate.toISOString()) : '—'}
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
