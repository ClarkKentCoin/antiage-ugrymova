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
import { useCreateTier } from '@/hooks/useSubscriptionTiers';

interface CreateTierDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateTierDialog({ open, onOpenChange }: CreateTierDialogProps) {
  const createTier = useCreateTier();

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    duration_days: '',
    price: '',
    is_active: true,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    createTier.mutate({
      name: formData.name,
      description: formData.description || undefined,
      duration_days: parseInt(formData.duration_days),
      price: parseFloat(formData.price),
      is_active: formData.is_active,
    }, {
      onSuccess: () => {
        onOpenChange(false);
        setFormData({
          name: '',
          description: '',
          duration_days: '',
          price: '',
          is_active: true,
        });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Tier</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              placeholder="e.g., Monthly"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Optional description"
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
                placeholder="30"
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
                placeholder="500"
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
            <Button type="submit" disabled={createTier.isPending}>
              {createTier.isPending ? 'Creating...' : 'Create Tier'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
