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
import { Subscriber, useUpdateSubscriber } from '@/hooks/useSubscribers';
import { useSubscriptionTiers } from '@/hooks/useSubscriptionTiers';

interface EditSubscriberDialogProps {
  subscriber: Subscriber | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditSubscriberDialog({ subscriber, open, onOpenChange }: EditSubscriberDialogProps) {
  const { data: tiers } = useSubscriptionTiers();
  const updateSubscriber = useUpdateSubscriber();

  const [formData, setFormData] = useState({
    telegram_username: '',
    first_name: '',
    last_name: '',
    tier_id: '',
    status: '',
  });

  useEffect(() => {
    if (subscriber) {
      setFormData({
        telegram_username: subscriber.telegram_username || '',
        first_name: subscriber.first_name || '',
        last_name: subscriber.last_name || '',
        tier_id: subscriber.tier_id || '',
        status: subscriber.status,
      });
    }
  }, [subscriber]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subscriber) return;

    updateSubscriber.mutate({
      id: subscriber.id,
      telegram_username: formData.telegram_username || null,
      first_name: formData.first_name || null,
      last_name: formData.last_name || null,
      tier_id: formData.tier_id || null,
      status: formData.status,
    }, {
      onSuccess: () => onOpenChange(false),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Subscriber</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
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
            <Label htmlFor="tier">Subscription Tier</Label>
            <Select
              value={formData.tier_id}
              onValueChange={(value) => setFormData({ ...formData, tier_id: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a tier" />
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
            <Label htmlFor="status">Status</Label>
            <Select
              value={formData.status}
              onValueChange={(value) => setFormData({ ...formData, status: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateSubscriber.isPending}>
              {updateSubscriber.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
