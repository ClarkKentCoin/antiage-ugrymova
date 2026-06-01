import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
import { logEvent, generateRequestId } from '@/lib/logger';
import { useToast } from '@/hooks/use-toast';

interface ExtendSubscriptionDialogProps {
  subscriber: Subscriber | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExtendSubscriptionDialog({ subscriber, open, onOpenChange }: ExtendSubscriptionDialogProps) {
  const { data: tiers } = useSubscriptionTiers();
  const updateSubscriber = useUpdateSubscriber();
  const createPayment = useCreatePayment();
  const { toast } = useToast();

  const [mode, setMode] = useState<'tier' | 'custom_days'>('tier');
  const [formData, setFormData] = useState({
    tier_id: '',
    payment_note: '',
    custom_days: '',
  });

  const selectedTier = tiers?.find((t) => t.id === formData.tier_id);
  const customDaysNum = parseInt(formData.custom_days, 10);
  const customDaysValid = !isNaN(customDaysNum) && customDaysNum >= 1 && customDaysNum <= 3650;

  // Compute new end date — stacks from max(now, currentEnd if in future)
  const getNewEndDate = (): string | null => {
    const nowISO = new Date().toISOString();
    const currentEndISO = subscriber?.subscription_end || null;

    if (mode === 'custom_days') {
      if (!customDaysValid) return null;
      const now = new Date(nowISO).getTime();
      const currentEnd = currentEndISO ? new Date(currentEndISO).getTime() : 0;
      const startFrom = currentEnd > now ? currentEnd : now;
      return new Date(startFrom + customDaysNum * 24 * 60 * 60 * 1000).toISOString();
    }

    if (!selectedTier) return null;
    const { unit, count, timezone } = getTierInterval(selectedTier);
    return computeNextEndISO(nowISO, currentEndISO, unit, count, timezone);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subscriber) return;

    if (mode === 'tier' && !selectedTier) {
      toast({ title: 'Выберите тариф', variant: 'destructive' });
      return;
    }
    if (mode === 'custom_days' && !customDaysValid) {
      toast({ title: 'Введите корректное количество дней (1–3650)', variant: 'destructive' });
      return;
    }

    const newEndISO = getNewEndDate();
    const oldEndISO = subscriber.subscription_end;
    const requestId = generateRequestId();

    // Tier-based extension keeps existing behavior: updates tier_id.
    // Custom-days mode: do NOT overwrite tier_id.
    const updatePayload =
      mode === 'tier'
        ? {
            id: subscriber.id,
            tier_id: formData.tier_id,
            subscription_end: newEndISO || undefined,
            status: 'active',
          }
        : {
            id: subscriber.id,
            subscription_end: newEndISO || undefined,
            status: 'active',
          };

    updateSubscriber.mutate(updatePayload, {
      onSuccess: () => {
        if (mode === 'tier' && selectedTier) {
          createPayment.mutate({
            subscriber_id: subscriber.id,
            tier_id: formData.tier_id,
            amount: selectedTier.price,
            payment_method: 'manual',
            payment_note: formData.payment_note || `Продление подписки: ${selectedTier.name}`,
          });

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
            },
          });
        } else {
          // Manual custom-days extension — audit payment with amount 0
          createPayment.mutate({
            subscriber_id: subscriber.id,
            amount: 0,
            payment_method: 'manual',
            payment_note: `Ручное продление без оплаты: ${customDaysNum} дн.${formData.payment_note ? ` — ${formData.payment_note}` : ''}`,
          });

          logEvent({
            event_type: 'subscription.manual_access_extended',
            source: 'admin_ui',
            subscriber_id: subscriber.id,
            telegram_user_id: subscriber.telegram_user_id,
            request_id: requestId,
            message: 'Admin extended subscription manually (no tier)',
            payload: {
              old_end: oldEndISO,
              new_end: newEndISO,
              custom_days: customDaysNum,
              amount: 0,
            },
          });
        }

        onOpenChange(false);
        setFormData({ tier_id: '', payment_note: '', custom_days: '' });
        setMode('tier');
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

  const newEnd = getNewEndDate();
  const previewTz = mode === 'tier' && selectedTier ? getTierInterval(selectedTier).timezone : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] max-h-[90vh] overflow-y-auto">
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

          <div className="space-y-3">
            <Label>Режим продления</Label>
            <RadioGroup
              value={mode}
              onValueChange={(value: 'tier' | 'custom_days') => setMode(value)}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3"
            >
              <div className="flex items-center space-x-2 rounded-lg border p-3 cursor-pointer hover:bg-muted/50">
                <RadioGroupItem value="tier" id="ext-tier" />
                <Label htmlFor="ext-tier" className="cursor-pointer">По тарифу</Label>
              </div>
              <div className="flex items-center space-x-2 rounded-lg border p-3 cursor-pointer hover:bg-muted/50">
                <RadioGroupItem value="custom_days" id="ext-custom" />
                <Label htmlFor="ext-custom" className="cursor-pointer">На любое количество дней</Label>
              </div>
            </RadioGroup>
          </div>

          {mode === 'tier' && (
            <div className="space-y-2">
              <Label htmlFor="tier">Добавить период</Label>
              <Select
                value={formData.tier_id}
                onValueChange={(value) => setFormData({ ...formData, tier_id: value })}
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
          )}

          {mode === 'custom_days' && (
            <div className="space-y-2">
              <Label htmlFor="ext_custom_days">Количество дней *</Label>
              <Input
                id="ext_custom_days"
                type="number"
                min={1}
                max={3650}
                placeholder="Например: 30"
                value={formData.custom_days}
                onChange={(e) => setFormData({ ...formData, custom_days: e.target.value })}
                required
              />
            </div>
          )}

          {newEnd && (
            <div className="rounded-lg bg-primary/10 p-3 text-sm">
              <p className="text-foreground">
                Доступ до{' '}
                <span className="font-medium">
                  {formatDateInTimezone(newEnd, previewTz)}
                </span>
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="payment_note">Примечание к платежу</Label>
            <Textarea
              id="payment_note"
              placeholder={mode === 'custom_days' ? 'Например: Бонусный доступ...' : 'Например: Оплата наличными...'}
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
