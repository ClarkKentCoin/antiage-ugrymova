import { useState, useEffect } from 'react';
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
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  SubscriptionTier, 
  useUpdateTier, 
  IntervalUnit, 
  deriveIntervalFromDays,
  computeDurationDays 
} from '@/hooks/useSubscriptionTiers';
import { logEvent, generateRequestId } from '@/lib/logger';

interface EditTierDialogProps {
  tier: SubscriptionTier;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const INTERVAL_UNIT_OPTIONS: { value: IntervalUnit; label: string }[] = [
  { value: 'day', label: 'День' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'year', label: 'Год' },
];

export function EditTierDialog({ tier, open, onOpenChange }: EditTierDialogProps) {
  const updateTier = useUpdateTier();

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    interval_unit: 'month' as IntervalUnit,
    interval_count: '1',
    billing_timezone: 'Europe/Moscow',
    price: '',
    is_active: true,
    grace_period_enabled: true,
    show_in_dashboard: false,
    purchase_once_only: false,
  });

  useEffect(() => {
    if (tier) {
      // Use interval fields if available, otherwise derive from duration_days
      let intervalUnit: IntervalUnit = 'month';
      let intervalCount = 1;

      if (tier.interval_unit && tier.interval_count) {
        intervalUnit = tier.interval_unit;
        intervalCount = tier.interval_count;
      } else {
        // Derive from legacy duration_days
        const derived = deriveIntervalFromDays(tier.duration_days);
        intervalUnit = derived.unit;
        intervalCount = derived.count;
      }

      setFormData({
        name: tier.name,
        description: tier.description || '',
        interval_unit: intervalUnit,
        interval_count: intervalCount.toString(),
        billing_timezone: tier.billing_timezone || 'Europe/Moscow',
        price: tier.price.toString(),
        is_active: tier.is_active,
        grace_period_enabled: tier.grace_period_enabled ?? true,
        show_in_dashboard: tier.show_in_dashboard ?? false,
        purchase_once_only: tier.purchase_once_only ?? false,
      });
    }
  }, [tier]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const intervalCount = parseInt(formData.interval_count) || 1;
    const durationDays = computeDurationDays(formData.interval_unit, intervalCount);
    const requestId = generateRequestId();

    const oldValues = {
      name: tier.name,
      price: tier.price,
      interval_unit: tier.interval_unit,
      interval_count: tier.interval_count,
      is_active: tier.is_active,
    };

    updateTier.mutate({
      id: tier.id,
      name: formData.name,
      description: formData.description || null,
      duration_days: durationDays,
      price: parseFloat(formData.price),
      is_active: formData.is_active,
      grace_period_enabled: formData.grace_period_enabled,
      show_in_dashboard: formData.show_in_dashboard,
      purchase_once_only: formData.purchase_once_only,
      interval_unit: formData.interval_unit,
      interval_count: intervalCount,
      billing_timezone: formData.billing_timezone,
    }, {
      onSuccess: () => {
        logEvent({
          event_type: 'tier.updated',
          source: 'admin_ui',
          tier_id: tier.id,
          request_id: requestId,
          message: `Updated tier: ${formData.name}`,
          payload: {
            old_values: oldValues,
            new_values: {
              name: formData.name,
              price: parseFloat(formData.price),
              interval_unit: formData.interval_unit,
              interval_count: intervalCount,
              is_active: formData.is_active,
            },
          },
        });
        onOpenChange(false);
      },
      onError: (error) => {
        logEvent({
          level: 'error',
          event_type: 'admin.error',
          source: 'admin_ui',
          tier_id: tier.id,
          request_id: requestId,
          message: 'Failed to update tier',
          payload: { error: error.message },
        });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Редактировать тариф</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Название *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Описание</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Длительность *</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                value={formData.interval_count}
                onChange={(e) => setFormData({ ...formData, interval_count: e.target.value })}
                required
                min="1"
              />
              <Select
                value={formData.interval_unit}
                onValueChange={(value: IntervalUnit) => setFormData({ ...formData, interval_unit: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите период" />
                </SelectTrigger>
                <SelectContent>
                  {INTERVAL_UNIT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="price">Цена (₽) *</Label>
            <Input
              id="price"
              type="number"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              required
              min="0"
              step="0.01"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="billing_timezone">Часовой пояс</Label>
            <Input
              id="billing_timezone"
              value={formData.billing_timezone}
              onChange={(e) => setFormData({ ...formData, billing_timezone: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Используется для расчёта дат продления
            </p>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="is_active">Активен</Label>
            <Switch
              id="is_active"
              checked={formData.is_active}
              onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="grace_period_enabled">Грейс-период</Label>
              <p className="text-xs text-muted-foreground">Разрешить льготный период после окончания подписки</p>
            </div>
            <Switch
              id="grace_period_enabled"
              checked={formData.grace_period_enabled}
              onCheckedChange={(checked) => setFormData({ ...formData, grace_period_enabled: checked })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="show_in_dashboard">Показывать на дашборде</Label>
              <p className="text-xs text-muted-foreground">Отображать карточку с этим тарифом в статистике</p>
            </div>
            <Switch
              id="show_in_dashboard"
              checked={formData.show_in_dashboard}
              onCheckedChange={(checked) => setFormData({ ...formData, show_in_dashboard: checked })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="purchase_once_only">Можно купить только 1 раз</Label>
              <p className="text-xs text-muted-foreground">Если включено, один и тот же подписчик сможет купить этот тариф только один раз</p>
            </div>
            <Switch
              id="purchase_once_only"
              checked={formData.purchase_once_only}
              onCheckedChange={(checked) => setFormData({ ...formData, purchase_once_only: checked })}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={updateTier.isPending}>
              {updateTier.isPending ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
