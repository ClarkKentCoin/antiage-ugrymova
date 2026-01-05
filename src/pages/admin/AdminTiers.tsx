import { useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { TierCard } from '@/components/admin/TierCard';
import { CreateTierDialog } from '@/components/admin/CreateTierDialog';
import { Button } from '@/components/ui/button';
import { useSubscriptionTiers } from '@/hooks/useSubscriptionTiers';
import { Plus } from 'lucide-react';

export default function AdminTiers() {
  const { data: tiers, isLoading } = useSubscriptionTiers();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-muted rounded" />
          <div className="grid gap-4 md:grid-cols-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-48 bg-muted rounded-lg" />
            ))}
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Subscription Tiers</h1>
            <p className="text-muted-foreground">Configure your pricing plans</p>
          </div>
          <Button onClick={() => setIsCreateDialogOpen(true)} className="w-full sm:w-auto">
            <Plus className="mr-2 h-4 w-4" />
            Create Tier
          </Button>
        </div>

        {tiers?.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-12 text-center">
            <p className="text-muted-foreground mb-4">No subscription tiers yet</p>
            <Button onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Your First Tier
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {tiers?.map(tier => (
              <TierCard key={tier.id} tier={tier} />
            ))}
          </div>
        )}

        <CreateTierDialog
          open={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
        />
      </div>
    </AdminLayout>
  );
}
