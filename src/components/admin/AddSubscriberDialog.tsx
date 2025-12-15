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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSubscriptionTiers } from '@/hooks/useSubscriptionTiers';
import { useCreateSubscriber } from '@/hooks/useSubscribers';

interface AddSubscriberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddSubscriberDialog({ open, onOpenChange }: AddSubscriberDialogProps) {
  const { data: tiers } = useSubscriptionTiers();
  const createSubscriber = useCreateSubscriber();

  const [formData, setFormData] = useState({
    telegram_user_id: '',
    telegram_username: '',
    first_name: '',
    last_name: '',
    tier_id: '',
    payment_note: '',
  });

  const selectedTier = tiers?.find((t) => t.id === formData.tier_id);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
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
        onOpenChange(false);
        setFormData({
          telegram_user_id: '',
          telegram_username: '',
          first_name: '',
          last_name: '',
          tier_id: '',
          payment_note: '',
        });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Subscriber</DialogTitle>
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
              <Label htmlFor="first_name">First Name</Label>
              <Input
                id="first_name"
                value={formData.first_name}
                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last_name">Last Name</Label>
              <Input
                id="last_name"
                value={formData.last_name}
                onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tier">Subscription Tier *</Label>
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
            <div className="rounded-lg bg-muted p-3 text-sm">
              <p className="text-muted-foreground">
                Subscription will expire on{' '}
                <span className="font-medium text-foreground">
                  {format(addDays(new Date(), selectedTier.duration_days), 'MMMM d, yyyy')}
                </span>
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="payment_note">Payment Note</Label>
            <Textarea
              id="payment_note"
              placeholder="e.g., Cash payment received on..."
              value={formData.payment_note}
              onChange={(e) => setFormData({ ...formData, payment_note: e.target.value })}
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createSubscriber.isPending}>
              {createSubscriber.isPending ? 'Adding...' : 'Add Subscriber'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
