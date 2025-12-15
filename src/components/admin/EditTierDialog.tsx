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
import { SubscriptionTier, useUpdateTier } from '@/hooks/useSubscriptionTiers';

interface EditTierDialogProps {
  tier: SubscriptionTier;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditTierDialog({ tier, open, onOpenChange }: EditTierDialogProps) {
  const updateTier = useUpdateTier();

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    duration_days: '',
    price: '',
    is_active: true,
  });

  useEffect(() => {
    if (tier) {
      setFormData({
        name: tier.name,
        description: tier.description || '',
        duration_days: tier.duration_days.toString(),
        price: tier.price.toString(),
        is_active: tier.is_active,
      });
    }
  }, [tier]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    updateTier.mutate({
      id: tier.id,
      name: formData.name,
      description: formData.description || null,
      duration_days: parseInt(formData.duration_days),
      price: parseFloat(formData.price),
      is_active: formData.is_active,
    }, {
      onSuccess: () => onOpenChange(false),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Tier</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="duration_days">Duration (days) *</Label>
              <Input
                id="duration_days"
                type="number"
                value={formData.duration_days}
                onChange={(e) => setFormData({ ...formData, duration_days: e.target.value })}
                required
                min="1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price">Price (₽) *</Label>
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
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="is_active">Active</Label>
            <Switch
              id="is_active"
              checked={formData.is_active}
              onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateTier.isPending}>
              {updateTier.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
