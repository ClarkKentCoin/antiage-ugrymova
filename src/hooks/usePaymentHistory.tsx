import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export type PaymentStatus = 'pending' | 'completed' | 'failed';

export interface PaymentRecord {
  id: string;
  subscriber_id: string;
  tier_id: string | null;
  amount: number;
  payment_method: string;
  payment_note: string | null;
  payment_date: string;
  created_at: string;
  status: PaymentStatus;
  subscribers?: {
    telegram_username: string | null;
    first_name: string | null;
    last_name: string | null;
  };
  subscription_tiers?: {
    name: string;
  } | null;
}

export interface CreatePaymentInput {
  subscriber_id: string;
  tier_id?: string;
  amount: number;
  payment_method?: string;
  payment_note?: string;
}

export interface UsePaymentHistoryOptions {
  subscriberId?: string;
  status?: PaymentStatus | null;
}

export function usePaymentHistory(options: UsePaymentHistoryOptions = {}) {
  const { subscriberId, status } = options;
  return useQuery({
    queryKey: ['payment_history', subscriberId],
    queryFn: async () => {
      let query = supabase
        .from('payment_history')
        .select(`
          *,
          subscribers (
            telegram_username,
            first_name,
            last_name
          ),
          subscription_tiers (
            name
          )
        `)
        .order('created_at', { ascending: false });
      
      if (status) {
        query = query.eq('status', status);
      }
      
      if (subscriberId) {
        query = query.eq('subscriber_id', subscriberId);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      return data as PaymentRecord[];
    },
  });
}

export function useCreatePayment() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: CreatePaymentInput) => {
      const { data, error } = await supabase
        .from('payment_history')
        .insert({
          ...input,
          payment_method: input.payment_method || 'manual',
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment_history'] });
      toast({ title: 'Payment recorded successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error recording payment', description: error.message, variant: 'destructive' });
    },
  });
}
