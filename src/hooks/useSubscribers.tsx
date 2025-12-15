import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface Subscriber {
  id: string;
  telegram_user_id: number;
  telegram_username: string | null;
  first_name: string | null;
  last_name: string | null;
  tier_id: string | null;
  subscription_start: string | null;
  subscription_end: string | null;
  status: string;
  is_in_channel: boolean;
  created_at: string;
  updated_at: string;
  subscription_tiers?: {
    name: string;
    duration_days: number;
    price: number;
  } | null;
}

export interface CreateSubscriberInput {
  telegram_user_id: number;
  telegram_username?: string;
  first_name?: string;
  last_name?: string;
  tier_id?: string;
  subscription_start?: string;
  subscription_end?: string;
  status?: string;
  payment_note?: string;
  amount?: number;
}

export function useSubscribers() {
  return useQuery({
    queryKey: ['subscribers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscribers')
        .select(`
          *,
          subscription_tiers (
            name,
            duration_days,
            price
          )
        `)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as Subscriber[];
    },
  });
}

export function useSubscriber(telegramUserId: number | null) {
  return useQuery({
    queryKey: ['subscriber', telegramUserId],
    queryFn: async () => {
      if (!telegramUserId) return null;
      
      const { data, error } = await supabase
        .from('subscribers')
        .select(`
          *,
          subscription_tiers (
            name,
            duration_days,
            price
          )
        `)
        .eq('telegram_user_id', telegramUserId)
        .maybeSingle();
      
      if (error) throw error;
      return data as Subscriber | null;
    },
    enabled: !!telegramUserId,
  });
}

export function useCreateSubscriber() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: CreateSubscriberInput) => {
      // First create the subscriber
      const { data: subscriber, error: subscriberError } = await supabase
        .from('subscribers')
        .insert({
          telegram_user_id: input.telegram_user_id,
          telegram_username: input.telegram_username,
          first_name: input.first_name,
          last_name: input.last_name,
          tier_id: input.tier_id,
          subscription_start: input.subscription_start,
          subscription_end: input.subscription_end,
          status: input.status || 'active',
        })
        .select()
        .single();

      if (subscriberError) throw subscriberError;

      // If payment info provided, create payment record
      if (input.amount && input.tier_id) {
        const { error: paymentError } = await supabase
          .from('payment_history')
          .insert({
            subscriber_id: subscriber.id,
            tier_id: input.tier_id,
            amount: input.amount,
            payment_method: 'manual',
            payment_note: input.payment_note,
          });

        if (paymentError) throw paymentError;
      }

      return subscriber;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscribers'] });
      toast({ title: 'Subscriber added successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error adding subscriber', description: error.message, variant: 'destructive' });
    },
  });
}

export function useUpdateSubscriber() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Subscriber> & { id: string }) => {
      const { data, error } = await supabase
        .from('subscribers')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscribers'] });
      toast({ title: 'Subscriber updated successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error updating subscriber', description: error.message, variant: 'destructive' });
    },
  });
}

export function useDeleteSubscriber() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('subscribers')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscribers'] });
      toast({ title: 'Subscriber removed successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error removing subscriber', description: error.message, variant: 'destructive' });
    },
  });
}
