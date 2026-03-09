import { useState, useMemo } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { SubscriberTable } from '@/components/admin/SubscriberTable';
import { AddSubscriberDialog } from '@/components/admin/AddSubscriberDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useSubscribers } from '@/hooks/useSubscribers';
import { useSubscriptionTiers } from '@/hooks/useSubscriptionTiers';
import { Plus, Search, Filter } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type StatusFilter = 'all' | 'active' | 'grace_period' | 'inactive' | 'expired' | 'cancelled';

const filterTabs: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'Активные' },
  { value: 'grace_period', label: 'Грейс-период' },
  { value: 'inactive', label: 'Неактивные' },
  { value: 'expired', label: 'Истекшие' },
  { value: 'cancelled', label: 'Отменённые' },
];

export default function AdminSubscribers() {
  const { data: subscribers, isLoading } = useSubscribers();
  const { data: allTiers } = useSubscriptionTiers();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [tierFilter, setTierFilter] = useState<string>('all');

  // Build tier options: active first, then inactive (grey) only if subscribers use them
  const tierOptions = useMemo(() => {
    if (!allTiers || !subscribers) return [];
    const usedTierIds = new Set(subscribers.map(s => s.tier_id).filter(Boolean));
    const activeTiers = allTiers.filter(t => t.is_active).sort((a, b) => a.name.localeCompare(b.name));
    const inactiveTiers = allTiers.filter(t => !t.is_active && usedTierIds.has(t.id)).sort((a, b) => a.name.localeCompare(b.name));
    return [
      ...activeTiers.map(t => ({ id: t.id, name: t.name, isActive: true })),
      ...inactiveTiers.map(t => ({ id: t.id, name: t.name, isActive: false })),
    ];
  }, [allTiers, subscribers]);
  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: 0, active: 0, grace_period: 0, inactive: 0, expired: 0, cancelled: 0,
    };
    if (!subscribers) return counts;
    counts.all = subscribers.length;
    for (const sub of subscribers) {
      const s = sub.status as StatusFilter;
      if (s in counts && s !== 'all') counts[s]++;
    }
    return counts;
  }, [subscribers]);

  const filteredSubscribers = useMemo(() => {
    let list = subscribers ?? [];
    if (statusFilter !== 'all') {
      list = list.filter(sub => sub.status === statusFilter);
    }
    if (tierFilter !== 'all') {
      list = list.filter(sub => sub.tier_id === tierFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(sub =>
        sub.telegram_username?.toLowerCase().includes(q) ||
        sub.first_name?.toLowerCase().includes(q) ||
        sub.last_name?.toLowerCase().includes(q) ||
        sub.email?.toLowerCase().includes(q) ||
        sub.phone_number?.includes(search) ||
        sub.telegram_user_id.toString().includes(search)
      );
    }
    return list;
  }, [subscribers, statusFilter, tierFilter, search]);

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

        <div className="flex gap-2 flex-wrap">
          {filterTabs.map((tab) => (
            <Button
              key={tab.value}
              variant={statusFilter === tab.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(tab.value)}
              className="flex-1 sm:flex-none"
            >
              <span className="truncate">{tab.label}</span>
              <Badge variant="secondary" className="ml-2 bg-background/20">
                {statusCounts[tab.value]}
              </Badge>
            </Button>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search subscribers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={tierFilter} onValueChange={setTierFilter}>
            <SelectTrigger className="w-full sm:w-[220px]">
              <Filter className="mr-2 h-4 w-4 text-muted-foreground" />
              <SelectValue placeholder="Все тарифы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все тарифы</SelectItem>
              {tierOptions.map((tier) => (
                <SelectItem key={tier.id} value={tier.id} className={tier.isActive ? '' : 'text-muted-foreground'}>
                  {tier.name}{!tier.isActive ? ' (неактивен)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <SubscriberTable subscribers={filteredSubscribers} />

        <AddSubscriberDialog
          open={isAddDialogOpen}
          onOpenChange={setIsAddDialogOpen}
        />
      </div>
    </AdminLayout>
  );
}
