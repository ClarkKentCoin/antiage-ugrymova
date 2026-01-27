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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Subscriber, useUpdateSubscriber } from '@/hooks/useSubscribers';
import { useSubscriptionTiers } from '@/hooks/useSubscriptionTiers';
import { useConsentLogs } from '@/hooks/useConsentLogs';
import { computeNextEndISO, getTierInterval } from '@/lib/dateUtils';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { CheckCircle, XCircle, ScrollText, AlertTriangle } from 'lucide-react';

interface EditSubscriberDialogProps {
  subscriber: Subscriber | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditSubscriberDialog({ subscriber, open, onOpenChange }: EditSubscriberDialogProps) {
  const { data: tiers } = useSubscriptionTiers();
  const { data: consentLogs, isLoading: loadingLogs } = useConsentLogs(subscriber?.id || null);
  const updateSubscriber = useUpdateSubscriber();

  const [formData, setFormData] = useState({
    telegram_username: '',
    first_name: '',
    last_name: '',
    email: '',
    tier_id: '',
    status: '',
  });

  useEffect(() => {
    if (subscriber) {
      setFormData({
        telegram_username: subscriber.telegram_username || '',
        first_name: subscriber.first_name || '',
        last_name: subscriber.last_name || '',
        email: subscriber.email || '',
        tier_id: subscriber.tier_id || '',
        status: subscriber.status,
      });
    }
  }, [subscriber]);

  // Check if we need to compute a new subscription_end
  const selectedTier = tiers?.find(t => t.id === formData.tier_id);
  const isActivating = formData.status === 'active' && subscriber?.status !== 'active';
  const isTierChanged = formData.tier_id && formData.tier_id !== subscriber?.tier_id;
  const needsNewEndDate = isActivating || (formData.status === 'active' && isTierChanged);
  
  // Check if current subscription_end is in the past
  const currentEndInPast = subscriber?.subscription_end 
    ? new Date(subscriber.subscription_end).getTime() < Date.now()
    : true;
  
  // Show warning if activating with past end date and no tier change
  const showEndDateWarning = isActivating && currentEndInPast && !isTierChanged && !formData.tier_id;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subscriber) return;

    const updates: Record<string, unknown> = {
      id: subscriber.id,
      telegram_username: formData.telegram_username || null,
      first_name: formData.first_name || null,
      last_name: formData.last_name || null,
      email: formData.email || null,
      tier_id: formData.tier_id || null,
      status: formData.status,
    };

    // Auto-compute subscription_end when activating or changing tier while active
    if (needsNewEndDate && selectedTier) {
      const nowISO = new Date().toISOString();
      // If activating from expired/inactive, start from now; otherwise stack on existing end
      const currentEndISO = (isActivating && currentEndInPast) ? null : (subscriber.subscription_end || null);
      const { unit, count, timezone } = getTierInterval(selectedTier);
      const newEndISO = computeNextEndISO(nowISO, currentEndISO, unit, count, timezone);
      
      updates.subscription_end = newEndISO;
      console.log('[EditSubscriberDialog] Auto-computed subscription_end:', {
        isActivating,
        isTierChanged,
        currentEndInPast,
        oldEnd: subscriber.subscription_end,
        newEnd: newEndISO,
        tier: selectedTier.name,
      });
    }

    updateSubscriber.mutate(updates as any, {
      onSuccess: () => onOpenChange(false),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Редактирование подписчика</DialogTitle>
        </DialogHeader>
        
        <Tabs defaultValue="info" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="info">Информация</TabsTrigger>
            <TabsTrigger value="consent">История согласий</TabsTrigger>
          </TabsList>
          
          <TabsContent value="info">
            <form onSubmit={handleSubmit} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="telegram_username">Username</Label>
                <Input
                  id="telegram_username"
                  placeholder="@username"
                  value={formData.telegram_username}
                  onChange={(e) => setFormData({ ...formData, telegram_username: e.target.value.replace('@', '') })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="first_name">Имя</Label>
                  <Input
                    id="first_name"
                    value={formData.first_name}
                    onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="last_name">Фамилия</Label>
                  <Input
                    id="last_name"
                    value={formData.last_name}
                    onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="email@example.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tier">Тариф</Label>
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
                        {tier.name} - {tier.price}₽
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">Статус</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) => setFormData({ ...formData, status: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Активен</SelectItem>
                    <SelectItem value="grace_period">Грейс период</SelectItem>
                    <SelectItem value="inactive">Неактивен</SelectItem>
                    <SelectItem value="expired">Истёк</SelectItem>
                    <SelectItem value="cancelled">Отменён</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Warning when activating without tier and past end date */}
              {showEndDateWarning && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30 text-warning">
                  <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium">Внимание</p>
                    <p className="text-muted-foreground">
                      Дата окончания подписки в прошлом. Выберите тариф, чтобы автоматически установить новую дату окончания.
                    </p>
                  </div>
                </div>
              )}

              {/* Show computed new end date when activating with tier */}
              {needsNewEndDate && selectedTier && (
                <div className="p-3 rounded-lg bg-primary/10 border border-primary/30 text-sm">
                  <p className="text-muted-foreground">
                    Новый срок подписки будет автоматически рассчитан на основе выбранного тарифа ({selectedTier.name}).
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Отмена
                </Button>
                <Button type="submit" disabled={updateSubscriber.isPending}>
                  {updateSubscriber.isPending ? 'Сохранение...' : 'Сохранить'}
                </Button>
              </div>
            </form>
          </TabsContent>
          
          <TabsContent value="consent" className="pt-4">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <ScrollText className="h-4 w-4" />
                <span className="text-sm">История согласий на автосписания</span>
              </div>
              
              {loadingLogs ? (
                <div className="animate-pulse space-y-2">
                  <div className="h-10 bg-muted rounded" />
                  <div className="h-10 bg-muted rounded" />
                </div>
              ) : consentLogs && consentLogs.length > 0 ? (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Дата</TableHead>
                        <TableHead>Действие</TableHead>
                        <TableHead>IP адрес</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {consentLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-sm">
                            {format(new Date(log.consent_date), 'd MMM yyyy, HH:mm', { locale: ru })}
                          </TableCell>
                          <TableCell>
                            {log.consent_type === 'auto_renewal_enabled' ? (
                              <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Включено
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
                                <XCircle className="h-3 w-3 mr-1" />
                                Отключено
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground font-mono">
                            {log.ip_address || '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <ScrollText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Нет записей о согласиях</p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
