import { useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { SubscriberTable } from '@/components/admin/SubscriberTable';
import { AddSubscriberDialog } from '@/components/admin/AddSubscriberDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSubscribers } from '@/hooks/useSubscribers';
import { Plus, Search } from 'lucide-react';

export default function AdminSubscribers() {
  const { data: subscribers, isLoading } = useSubscribers();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filteredSubscribers = subscribers?.filter(sub => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      sub.telegram_username?.toLowerCase().includes(searchLower) ||
      sub.first_name?.toLowerCase().includes(searchLower) ||
      sub.last_name?.toLowerCase().includes(searchLower) ||
      sub.email?.toLowerCase().includes(searchLower) ||
      sub.phone_number?.includes(search) ||
      sub.telegram_user_id.toString().includes(search)
    );
  });

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-muted rounded" />
          <div className="h-64 bg-muted rounded-lg" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Subscribers</h1>
            <p className="text-muted-foreground">Manage your channel subscribers</p>
          </div>
          <Button onClick={() => setIsAddDialogOpen(true)} className="w-full sm:w-auto">
            <Plus className="mr-2 h-4 w-4" />
            Add Subscriber
          </Button>
        </div>

        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search subscribers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <SubscriberTable subscribers={filteredSubscribers || []} />

        <AddSubscriberDialog
          open={isAddDialogOpen}
          onOpenChange={setIsAddDialogOpen}
        />
      </div>
    </AdminLayout>
  );
}
