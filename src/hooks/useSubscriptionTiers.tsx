import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface SubscriptionTier {
  id: string;
  name: string;
  description: string | null;
  duration_days: number;
  price: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateTierInput {
  name: string;
  description?: string;
  duration_days: number;
  price: number;
  is_active?: boolean;
}

export function useSubscriptionTiers() {
  return useQuery({
    queryKey: ['subscription_tiers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscription_tiers')
        .select('*')
        .order('price', { ascending: true });
      
      if (error) throw error;
      return data as SubscriptionTier[];
    },
  });
}

export function useActiveTiers() {
  return useQuery({
    queryKey: ['subscription_tiers', 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscription_tiers')
        .select('*')
        .eq('is_active', true)
        .order('price', { ascending: true });
      
      if (error) throw error;
      return data as SubscriptionTier[];
    },
  });
}

export function useCreateTier() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: CreateTierInput) => {
      const { data, error } = await supabase
        .from('subscription_tiers')
        .insert(input)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription_tiers'] });
      toast({ title: 'Tier created successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error creating tier', description: error.message, variant: 'destructive' });
    },
  });
}

export function useUpdateTier() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<SubscriptionTier> & { id: string }) => {
      const { data, error } = await supabase
        .from('subscription_tiers')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription_tiers'] });
      toast({ title: 'Tier updated successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error updating tier', description: error.message, variant: 'destructive' });
    },
  });
}

export function useDeleteTier() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('subscription_tiers')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription_tiers'] });
      toast({ title: 'Tier deleted successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error deleting tier', description: error.message, variant: 'destructive' });
    },
  });
}
