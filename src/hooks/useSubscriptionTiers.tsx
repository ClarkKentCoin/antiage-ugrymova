import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

// Default tenant ID for public/MiniApp queries (temporary until Step 4 implements t=tenant_slug)
const DEFAULT_PUBLIC_TENANT_ID =
  import.meta.env.VITE_PUBLIC_TENANT_ID || '6749bded-94d6-4793-9f46-09724da30ab6';

export type IntervalUnit = 'day' | 'week' | 'month' | 'year';

export interface SubscriptionTier {
  id: string;
  name: string;
  description: string | null;
  duration_days: number;
  price: number;
  is_active: boolean;
  interval_unit: IntervalUnit | null;
  interval_count: number | null;
  billing_timezone: string | null;
  grace_period_enabled: boolean;
  show_in_dashboard: boolean;
  purchase_once_only: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateTierInput {
  name: string;
  description?: string;
  duration_days: number;
  price: number;
  is_active?: boolean;
  grace_period_enabled?: boolean;
  show_in_dashboard?: boolean;
  purchase_once_only?: boolean;
  interval_unit: IntervalUnit;
  interval_count: number;
  billing_timezone: string;
}

export interface UpdateTierInput {
  id: string;
  name?: string;
  description?: string | null;
  duration_days?: number;
  price?: number;
  is_active?: boolean;
  grace_period_enabled?: boolean;
  show_in_dashboard?: boolean;
  interval_unit?: IntervalUnit;
  interval_count?: number;
  billing_timezone?: string;
}

// Helper to derive interval from legacy duration_days
export function deriveIntervalFromDays(durationDays: number): { unit: IntervalUnit; count: number } {
  if (durationDays === 30) {
    return { unit: 'month', count: 1 };
  }
  if (durationDays === 365) {
    return { unit: 'year', count: 1 };
  }
  if (durationDays % 7 === 0) {
    return { unit: 'week', count: durationDays / 7 };
  }
  return { unit: 'day', count: durationDays };
}

// Helper to compute duration_days from interval (for backward compatibility)
// For month/year, use fixed values to prevent legacy code from misinterpreting
export function computeDurationDays(unit: IntervalUnit, count: number): number {
  switch (unit) {
    case 'day':
      return count;
    case 'week':
      return count * 7;
    case 'month':
      return count * 30;
    case 'year':
      return count * 365;
    default:
      return count;
  }
}

// Helper to format duration for display
export function formatDuration(tier: SubscriptionTier): string {
  const derived = deriveIntervalFromDays(tier.duration_days);
  const unit = tier.interval_unit ?? derived.unit;
  const count = tier.interval_count ?? derived.count;

  const labels: Record<IntervalUnit, { singular: string; plural: string }> = {
    day: { singular: 'день', plural: 'дней' },
    week: { singular: 'неделя', plural: 'недель' },
    month: { singular: 'месяц', plural: 'месяцев' },
    year: { singular: 'год', plural: 'лет' },
  };

  // Russian pluralization rules
  const getPlural = (n: number, unit: IntervalUnit): string => {
    const { singular, plural } = labels[unit];
    if (n === 1) return singular;
    if (unit === 'month') {
      if (n >= 2 && n <= 4) return 'месяца';
      return plural;
    }
    if (unit === 'week') {
      if (n >= 2 && n <= 4) return 'недели';
      return plural;
    }
    if (unit === 'year') {
      if (n >= 2 && n <= 4) return 'года';
      return plural;
    }
    if (unit === 'day') {
      if (n >= 2 && n <= 4) return 'дня';
      return plural;
    }
    return plural;
  };

  return `${count} ${getPlural(count, unit)}`;
}

export function useSubscriptionTiers() {
  const { user, tenantId, tenantLoading } = useAuth();

  return useQuery({
    queryKey: ['subscription_tiers', user ? tenantId : DEFAULT_PUBLIC_TENANT_ID],
    queryFn: async () => {
      let query = supabase
        .from('subscription_tiers')
        .select('*')
        .order('price', { ascending: true });
      
      // For authenticated users (admin UI), filter by tenant
      if (user && tenantId) {
        query = query.eq('tenant_id', tenantId);
      } else {
        // For public/MiniApp, lock to default production tenant
        query = query.eq('tenant_id', DEFAULT_PUBLIC_TENANT_ID);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      return data as SubscriptionTier[];
    },
    // Don't query until tenant is loaded for authenticated users
    enabled: !user || (!tenantLoading && !!tenantId),
  });
}

// Admin-only tier name (hidden from MiniApp by default)
const ADMIN_ONLY_TIER_NAME = 'добавлен админом';

export function useActiveTiers(options?: { includeAdminOnly?: boolean }) {
  const { user, tenantId, tenantLoading } = useAuth();
  const includeAdminOnly = options?.includeAdminOnly ?? false;
  
  return useQuery({
    queryKey: ['subscription_tiers', 'active', user ? tenantId : DEFAULT_PUBLIC_TENANT_ID, { includeAdminOnly }],
    queryFn: async () => {
      let query = supabase
        .from('subscription_tiers')
        .select('*')
        .eq('is_active', true)
        .order('price', { ascending: true });
      
      // For authenticated users (admin UI), filter by tenant
      if (user && tenantId) {
        query = query.eq('tenant_id', tenantId);
      } else {
        // For public/MiniApp, lock to default production tenant
        query = query.eq('tenant_id', DEFAULT_PUBLIC_TENANT_ID);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      let tiers = data as SubscriptionTier[];
      
      // Filter out admin-only tiers for MiniApp
      if (!includeAdminOnly) {
        tiers = tiers.filter(t => t.name.toLowerCase() !== ADMIN_ONLY_TIER_NAME);
      }
      
      return tiers;
    },
    // Don't query until tenant is loaded for authenticated users
    enabled: !user || (!tenantLoading && !!tenantId),
  });
}

export function useCreateTier() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, tenantId } = useAuth();

  return useMutation({
    mutationFn: async (input: CreateTierInput) => {
      // For authenticated users, always include tenant_id
      const insertData = user && tenantId 
        ? { ...input, tenant_id: tenantId }
        : input;

      const { data, error } = await supabase
        .from('subscription_tiers')
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription_tiers'] });
      toast({ title: 'Тариф создан' });
    },
    onError: (error: Error) => {
      toast({ title: 'Ошибка создания тарифа', description: error.message, variant: 'destructive' });
    },
  });
}

export function useUpdateTier() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, tenantId } = useAuth();

  return useMutation({
    mutationFn: async ({ id, ...updates }: UpdateTierInput) => {
      let query = supabase
        .from('subscription_tiers')
        .update(updates)
        .eq('id', id);

      // For authenticated users, also filter by tenant_id to prevent cross-tenant updates
      if (user && tenantId) {
        query = query.eq('tenant_id', tenantId);
      }

      const { data, error } = await query.select().single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription_tiers'] });
      toast({ title: 'Тариф обновлён' });
    },
    onError: (error: Error) => {
      toast({ title: 'Ошибка обновления тарифа', description: error.message, variant: 'destructive' });
    },
  });
}

export function useDeleteTier() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, tenantId } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => {
      // Build delete query
      let deleteQuery = supabase
        .from('subscription_tiers')
        .delete()
        .eq('id', id);

      // For authenticated users, also filter by tenant_id to prevent cross-tenant deletes
      if (user && tenantId) {
        deleteQuery = deleteQuery.eq('tenant_id', tenantId);
      }

      // First try hard delete
      const { error: deleteError } = await deleteQuery;

      // If foreign key constraint error, soft delete instead
      if (deleteError?.code === '23503') {
        let updateQuery = supabase
          .from('subscription_tiers')
          .update({ is_active: false })
          .eq('id', id);

        // For authenticated users, also filter by tenant_id
        if (user && tenantId) {
          updateQuery = updateQuery.eq('tenant_id', tenantId);
        }

        const { error: updateError } = await updateQuery;

        if (updateError) throw updateError;
        return { softDeleted: true };
      }

      if (deleteError) throw deleteError;
      return { softDeleted: false };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['subscription_tiers'] });
      if (result?.softDeleted) {
        toast({ title: 'Тариф деактивирован', description: 'Тариф связан с платежами и был деактивирован вместо удаления' });
      } else {
        toast({ title: 'Тариф удалён' });
      }
    },
    onError: (error: Error) => {
      toast({ title: 'Ошибка удаления тарифа', description: error.message, variant: 'destructive' });
    },
  });
}
