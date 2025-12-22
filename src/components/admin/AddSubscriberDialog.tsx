import { useState } from 'react';
import { addDays, format } from 'date-fns';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSubscriptionTiers } from '@/hooks/useSubscriptionTiers';
import { useCreateSubscriber } from '@/hooks/useSubscribers';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Copy, ExternalLink } from 'lucide-react';

interface AddSubscriberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddSubscriberDialog({ open, onOpenChange }: AddSubscriberDialogProps) {
  const { toast } = useToast();
  const { data: tiers } = useSubscriptionTiers();
  const createSubscriber = useCreateSubscriber();

  const [formData, setFormData] = useState({
    telegram_user_id: '',
    telegram_username: '',
    first_name: '',
    last_name: '',
    tier_id: '',
    payment_note: '',
    payment_method: 'manual' as 'manual' | 'robokassa',
    auto_renewal: false,
  });

  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);

  const selectedTier = tiers?.find((t) => t.id === formData.tier_id);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (formData.payment_method === 'robokassa') {
      // For Robokassa, we just create the subscriber with inactive status
      // Payment will activate them
      createSubscriber.mutate({
        telegram_user_id: parseInt(formData.telegram_user_id),
        telegram_username: formData.telegram_username || undefined,
        first_name: formData.first_name || undefined,
        last_name: formData.last_name || undefined,
        tier_id: formData.tier_id || undefined,
        status: 'inactive',
      }, {
        onSuccess: (data) => {
          // Generate payment link after creating subscriber
          generatePaymentLink(data.id);
        },
      });
      return;
    }
    
    // Manual payment - activate immediately
    const now = new Date();
    const endDate = selectedTier 
      ? addDays(now, selectedTier.duration_days)
      : null;

    createSubscriber.mutate({
      telegram_user_id: parseInt(formData.telegram_user_id),
      telegram_username: formData.telegram_username || undefined,
      first_name: formData.first_name || undefined,
      last_name: formData.last_name || undefined,
      tier_id: formData.tier_id || undefined,
      subscription_start: now.toISOString(),
      subscription_end: endDate?.toISOString(),
      status: 'active',
      payment_note: formData.payment_note || undefined,
      amount: selectedTier?.price,
    }, {
      onSuccess: () => {
        handleClose();
      },
    });
  };

  const generatePaymentLink = async (subscriberId?: string) => {
    if (!formData.tier_id) {
      toast({ title: 'Выберите тариф', variant: 'destructive' });
      return;
    }

    if (!formData.telegram_user_id && !subscriberId) {
      toast({ title: 'Введите Telegram User ID', variant: 'destructive' });
      return;
    }

    setIsGeneratingLink(true);
    setPaymentUrl(null);

    try {
      // If we don't have a subscriber ID, we need to create one first or use an existing one
      let subId = subscriberId;
      
      if (!subId) {
        // Check if subscriber exists
        const { data: existingSubscriber } = await supabase
          .from('subscribers')
          .select('id')
          .eq('telegram_user_id', parseInt(formData.telegram_user_id))
          .maybeSingle();

        if (existingSubscriber) {
          subId = existingSubscriber.id;
        } else {
          // Create a new subscriber with inactive status
          const { data: newSubscriber, error } = await supabase
            .from('subscribers')
            .insert({
              telegram_user_id: parseInt(formData.telegram_user_id),
              telegram_username: formData.telegram_username || null,
              first_name: formData.first_name || null,
              last_name: formData.last_name || null,
              tier_id: formData.tier_id,
              status: 'inactive',
              auto_renewal: formData.auto_renewal,
              subscriber_payment_method: formData.auto_renewal ? 'robokassa_recurring' : 'robokassa_single',
            })
            .select()
            .single();

          if (error) throw error;
          subId = newSubscriber.id;
        }
      }

      // Call edge function to generate payment URL
      const { data, error } = await supabase.functions.invoke('create-robokassa-payment', {
        body: {
          subscriber_id: subId,
          tier_id: formData.tier_id,
          is_recurring: formData.auto_renewal,
        },
      });

      if (error) throw error;

      if (data?.payment_url) {
        setPaymentUrl(data.payment_url);
        toast({ title: 'Ссылка для оплаты создана' });
      } else {
        throw new Error(data?.error || 'Failed to generate payment URL');
      }
    } catch (error) {
      console.error('Error generating payment link:', error);
      toast({ 
        title: 'Ошибка создания ссылки', 
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive' 
      });
    } finally {
      setIsGeneratingLink(false);
    }
  };

  const copyPaymentUrl = () => {
    if (paymentUrl) {
      navigator.clipboard.writeText(paymentUrl);
      toast({ title: 'Ссылка скопирована' });
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setFormData({
      telegram_user_id: '',
      telegram_username: '',
      first_name: '',
      last_name: '',
      tier_id: '',
      payment_note: '',
      payment_method: 'manual',
      auto_renewal: false,
    });
    setPaymentUrl(null);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Добавить подписчика</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="telegram_user_id">Telegram User ID *</Label>
            <Input
              id="telegram_user_id"
              type="number"
              placeholder="123456789"
              value={formData.telegram_user_id}
              onChange={(e) => setFormData({ ...formData, telegram_user_id: e.target.value })}
              required
            />
          </div>

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
            <Label htmlFor="tier">Тариф *</Label>
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
                    {tier.name} - {tier.price}₽ ({tier.duration_days} дн.)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedTier && (
            <div className="rounded-lg bg-muted p-3 text-sm">
              <p className="text-muted-foreground">
                Подписка истечёт{' '}
                <span className="font-medium text-foreground">
                  {format(addDays(new Date(), selectedTier.duration_days), 'd MMMM yyyy')}
                </span>
              </p>
            </div>
          )}

          {/* Payment Method Selection */}
          <div className="space-y-3">
            <Label>Способ оплаты</Label>
            <RadioGroup
              value={formData.payment_method}
              onValueChange={(value: 'manual' | 'robokassa') => {
                setFormData({ ...formData, payment_method: value });
                setPaymentUrl(null);
              }}
              className="grid grid-cols-2 gap-4"
            >
              <div className="flex items-center space-x-2 rounded-lg border p-3 cursor-pointer hover:bg-muted/50">
                <RadioGroupItem value="manual" id="manual" />
                <Label htmlFor="manual" className="cursor-pointer">Вручную</Label>
              </div>
              <div className="flex items-center space-x-2 rounded-lg border p-3 cursor-pointer hover:bg-muted/50">
                <RadioGroupItem value="robokassa" id="robokassa" />
                <Label htmlFor="robokassa" className="cursor-pointer">Robokassa</Label>
              </div>
            </RadioGroup>
          </div>

          {formData.payment_method === 'robokassa' && (
            <div className="space-y-4 rounded-lg border p-4 bg-muted/30">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Автоматическое продление</Label>
                  <p className="text-xs text-muted-foreground">
                    Рекуррентные платежи
                  </p>
                </div>
                <Switch
                  checked={formData.auto_renewal}
                  onCheckedChange={(checked) => setFormData({ ...formData, auto_renewal: checked })}
                />
              </div>

              <Button 
                type="button" 
                variant="outline" 
                className="w-full"
                onClick={() => generatePaymentLink()}
                disabled={isGeneratingLink || !formData.tier_id || !formData.telegram_user_id}
              >
                {isGeneratingLink && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Создать ссылку для оплаты
              </Button>

              {paymentUrl && (
                <div className="space-y-2">
                  <Label>Ссылка для оплаты</Label>
                  <div className="flex gap-2">
                    <Input 
                      value={paymentUrl} 
                      readOnly 
                      className="text-xs font-mono"
                    />
                    <Button type="button" variant="outline" size="icon" onClick={copyPaymentUrl}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button 
                      type="button" 
                      variant="outline" 
                      size="icon"
                      onClick={() => window.open(paymentUrl, '_blank')}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Отправьте эту ссылку пользователю для оплаты. После оплаты подписка активируется автоматически.
                  </p>
                </div>
              )}
            </div>
          )}

          {formData.payment_method === 'manual' && (
            <div className="space-y-2">
              <Label htmlFor="payment_note">Примечание к платежу</Label>
              <Textarea
                id="payment_note"
                placeholder="Например: Оплата наличными получена..."
                value={formData.payment_note}
                onChange={(e) => setFormData({ ...formData, payment_note: e.target.value })}
                rows={2}
              />
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={handleClose}>
              Отмена
            </Button>
            {formData.payment_method === 'manual' && (
              <Button type="submit" disabled={createSubscriber.isPending}>
                {createSubscriber.isPending ? 'Добавление...' : 'Добавить подписчика'}
              </Button>
            )}
            {formData.payment_method === 'robokassa' && paymentUrl && (
              <Button type="button" onClick={handleClose}>
                Готово
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
