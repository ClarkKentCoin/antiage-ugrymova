import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Pencil, Trash2 } from 'lucide-react';
import { SubscriptionTier, useDeleteTier } from '@/hooks/useSubscriptionTiers';
import { EditTierDialog } from './EditTierDialog';

interface TierCardProps {
  tier: SubscriptionTier;
}

export function TierCard({ tier }: TierCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const deleteTier = useDeleteTier();

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this tier?')) {
      deleteTier.mutate(tier.id);
    }
  };

  return (
    <>
      <Card className={!tier.is_active ? 'opacity-60' : ''}>
        <CardHeader className="flex flex-row items-start justify-between pb-2">
          <div>
            <CardTitle className="text-lg">{tier.name}</CardTitle>
            {tier.description && (
              <p className="text-sm text-muted-foreground mt-1">{tier.description}</p>
            )}
          </div>
          <Badge variant={tier.is_active ? 'default' : 'secondary'}>
            {tier.is_active ? 'Active' : 'Inactive'}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-1 mb-4">
            <span className="text-3xl font-bold">{tier.price}</span>
            <span className="text-muted-foreground">₽</span>
            <span className="text-muted-foreground ml-1">/ {tier.duration_days} days</span>
          </div>
          
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
              <Pencil className="h-4 w-4 mr-1" />
              Edit
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleDelete}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete
            </Button>
          </div>
        </CardContent>
      </Card>

      <EditTierDialog
        tier={tier}
        open={isEditing}
        onOpenChange={setIsEditing}
      />
    </>
  );
}
