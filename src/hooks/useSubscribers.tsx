import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface Subscriber {
  id: string;
  telegram_user_id: number;
  telegram_username: string | null;
  first_name: string | null;
  last_name: string | null;
  phone_number: string | null;
  tier_id: string | null;
  subscription_start: string | null;
  subscription_end: string | null;
  status: string;
  is_in_channel: boolean;
  auto_renewal?: boolean;
  auto_renewal_consent_date?: string | null;
  created_at: string;
  updated_at: string;
  subscription_tiers?: {
    id?: string;
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

export function useSubscriber(telegramUserId: number | null, initData?: string | null) {
  return useQuery({
    queryKey: ['subscriber', telegramUserId, initData ? 'telegram' : 'direct'],
    queryFn: async () => {
      if (telegramUserId == null) return null;

      // In Telegram Mini App we use a backend function that validates initData
      if (initData) {
        const { data, error } = await supabase.functions.invoke('get-subscriber-status', {
          body: {
            telegram_user_id: telegramUserId,
            init_data: initData,
          },
        });

        // Handle edge function errors
        if (error) {
          console.error('[useSubscriber] Edge function error:', error);
          throw error;
        }

        // Handle application-level errors returned from edge function
        if (data?.error) {
          console.error('[useSubscriber] API error:', data.error, data.reason);
          // For invalid_init_data or other auth errors, return null (user not found/not authorized)
          if (data.error === 'invalid_init_data' || data.error === 'user_id_mismatch') {
            return null;
          }
          throw new Error(data.error);
        }

        return (data?.subscriber ?? null) as Subscriber | null;
      }

      // Fallback for dev/test flows (no Telegram initData available)
      const { data, error } = await supabase
        .from('subscribers')
        .select(`
          *,
          subscription_tiers (
            id,
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
    enabled: telegramUserId != null,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    retry: false, // Don't retry on error - if initData is invalid, retrying won't help
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

      // Auto-send invite to the new subscriber
      try {
        const { data: inviteResult } = await supabase.functions.invoke('telegram-channel', {
          body: { 
            action: 'send_invite', 
            telegram_user_id: input.telegram_user_id,
            subscriber_id: subscriber.id 
          },
        });
        
        return { ...subscriber, inviteResult };
      } catch (inviteError) {
        // Don't fail the whole operation if invite fails
        console.error('Failed to send invite:', inviteError);
        return { ...subscriber, inviteResult: null };
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['subscribers'] });
      if (data.inviteResult?.message_sent) {
        toast({ title: 'Подписчик добавлен', description: 'Приглашение отправлено в Telegram' });
      } else if (data.inviteResult?.invite_link) {
        navigator.clipboard.writeText(data.inviteResult.invite_link);
        toast({ 
          title: 'Подписчик добавлен', 
          description: 'Пользователь должен запустить бота. Ссылка скопирована.' 
        });
      } else {
        toast({ title: 'Подписчик добавлен' });
      }
    },
    onError: (error: Error) => {
      toast({ title: 'Ошибка добавления', description: error.message, variant: 'destructive' });
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
