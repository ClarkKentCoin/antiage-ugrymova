import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export type PaymentStatus = 'pending' | 'completed' | 'failed';

export interface PaymentRecord {
  id: string;
  subscriber_id?: string;
  tier_id?: string | null;
  amount: number;
  payment_method: string;
  payment_note: string | null;
  payment_date?: string;
  created_at: string;
  status: PaymentStatus;
  invoice_id?: string | null;
  subscribers?: {
    telegram_username: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
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

// Hook for MiniApp - fetches via edge function with init_data validation
export function usePaymentHistoryForUser(
  telegramUserId: number | null | undefined,
  initData: string | null | undefined,
  tenantSlug?: string | null
) {
  return useQuery({
    queryKey: ['payment_history_user', telegramUserId, tenantSlug],
    queryFn: async () => {
      if (!telegramUserId || !initData) {
        return [];
      }

      const { data, error } = await supabase.functions.invoke('get-payment-history', {
        body: { 
          telegram_user_id: telegramUserId, 
          init_data: initData,
          tenant_slug: tenantSlug,
        },
      });

      if (error) {
        console.error('get-payment-history error:', error);
        return [];
      }

      return (data?.payments ?? []) as PaymentRecord[];
    },
    enabled: !!telegramUserId && !!initData,
  });
}

// Hook for admin panel - direct DB query (requires admin RLS)
export function usePaymentHistory(options: UsePaymentHistoryOptions = {}) {
  const { subscriberId, status } = options;
  return useQuery({
    queryKey: ['payment_history', subscriberId, status],
    queryFn: async () => {
      let query = supabase
        .from('payment_history')
        .select(`
          *,
          subscribers (
            telegram_username,
            first_name,
            last_name,
            email
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

export function usePaymentCounts() {
  return useQuery({
    queryKey: ['payment_counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payment_history')
        .select('status');
      
      if (error) throw error;
      
      const counts = {
        all: data.length,
        completed: data.filter(p => p.status === 'completed').length,
        pending: data.filter(p => p.status === 'pending').length,
        failed: data.filter(p => p.status === 'failed').length,
      };
      
      return counts;
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
