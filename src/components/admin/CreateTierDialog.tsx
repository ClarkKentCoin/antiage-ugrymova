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
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateTier, IntervalUnit, computeDurationDays } from '@/hooks/useSubscriptionTiers';
import { logEvent, generateRequestId } from '@/lib/logger';

interface CreateTierDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const INTERVAL_UNIT_OPTIONS: { value: IntervalUnit; label: string }[] = [
  { value: 'day', label: 'День' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'year', label: 'Год' },
];

export function CreateTierDialog({ open, onOpenChange }: CreateTierDialogProps) {
  const createTier = useCreateTier();

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const intervalCount = parseInt(formData.interval_count) || 1;
    const durationDays = computeDurationDays(formData.interval_unit, intervalCount);
    const requestId = generateRequestId();

    createTier.mutate({
      name: formData.name,
      description: formData.description || undefined,
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
      onSuccess: (data) => {
        logEvent({
          event_type: 'tier.created',
          source: 'admin_ui',
          tier_id: data.id,
          request_id: requestId,
          message: `Created tier: ${formData.name}`,
          payload: {
            name: formData.name,
            price: parseFloat(formData.price),
            interval_unit: formData.interval_unit,
            interval_count: intervalCount,
            is_active: formData.is_active,
          },
        });
        onOpenChange(false);
        setFormData({
          name: '',
          description: '',
          interval_unit: 'month',
          interval_count: '1',
          billing_timezone: 'Europe/Moscow',
          price: '',
          is_active: true,
          grace_period_enabled: true,
          show_in_dashboard: false,
        });
      },
      onError: (error) => {
        logEvent({
          level: 'error',
          event_type: 'admin.error',
          source: 'admin_ui',
          request_id: requestId,
          message: 'Failed to create tier',
          payload: { error: error.message, tier_name: formData.name },
        });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Создать тариф</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Название *</Label>
            <Input
              id="name"
              placeholder="например, Месячный"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Описание</Label>
            <Textarea
              id="description"
              placeholder="Необязательное описание"
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
                placeholder="1"
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
              placeholder="500"
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
              placeholder="Europe/Moscow"
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

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={createTier.isPending}>
              {createTier.isPending ? 'Создание...' : 'Создать тариф'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
