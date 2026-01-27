import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { addDays, addMonths, addYears, isPast } from 'date-fns';

export interface Subscriber {
  id: string;
  telegram_user_id: number;
  telegram_username: string | null;
  first_name: string | null;
  last_name: string | null;
  phone_number: string | null;
  email: string | null;
  tier_id: string | null;
  subscription_start: string | null;
  subscription_end: string | null;
  status: string;
  is_in_channel: boolean;
  auto_renewal?: boolean;
  auto_renewal_consent_date?: string | null;
  subscriber_payment_method?: string | null;
  created_at: string;
  updated_at: string;
  subscription_tiers?: {
    id?: string;
    name: string;
    duration_days: number;
    price: number;
    interval_unit?: string | null;
    interval_count?: number | null;
    billing_timezone?: string | null;
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
            price,
            interval_unit,
            interval_count,
            billing_timezone
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
            price,
            interval_unit,
            interval_count,
            billing_timezone
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
      // Check if subscriber already exists
      const { data: existingSubscriber } = await supabase
        .from('subscribers')
        .select('id, subscription_start')
        .eq('telegram_user_id', input.telegram_user_id)
        .maybeSingle();

      let subscriber;
      let wasUpdated = false;

      if (existingSubscriber) {
        // Update existing subscriber - never overwrite subscription_start if already set
        const updateData: Record<string, unknown> = {
          telegram_username: input.telegram_username,
          first_name: input.first_name,
          last_name: input.last_name,
          tier_id: input.tier_id,
          subscription_end: input.subscription_end,
          status: input.status || 'active',
        };

        // Only set subscription_start if it was null before
        if (!existingSubscriber.subscription_start && input.subscription_start) {
          updateData.subscription_start = input.subscription_start;
        }

        const { data: updatedSubscriber, error: updateError } = await supabase
          .from('subscribers')
          .update(updateData)
          .eq('id', existingSubscriber.id)
          .select()
          .single();

        if (updateError) throw updateError;
        subscriber = updatedSubscriber;
        wasUpdated = true;
      } else {
        // Insert new subscriber
        const { data: newSubscriber, error: insertError } = await supabase
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

        if (insertError) throw insertError;
        subscriber = newSubscriber;
      }

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

      // Call edge function to:
      // 1. Send payment success notification
      // 2. Send invite to channel
      try {
        // First send notification about successful subscription
        await supabase.functions.invoke('subscriber-status-change', {
          body: {
            action: wasUpdated ? 'subscription_renewed' : 'new_subscriber',
            subscriber_id: subscriber.id,
            telegram_user_id: input.telegram_user_id,
            subscription_end: input.subscription_end,
            amount: input.amount,
          },
        });
      } catch (notifyError) {
        console.error('Failed to send subscriber notification:', notifyError);
      }

      // Then send invite link
      try {
        const { data: inviteResult } = await supabase.functions.invoke('telegram-channel', {
          body: { 
            action: 'send_invite', 
            telegram_user_id: input.telegram_user_id,
            subscriber_id: subscriber.id 
          },
        });
        
        return { ...subscriber, inviteResult, wasUpdated };
      } catch (inviteError) {
        // Don't fail the whole operation if invite fails
        console.error('Failed to send invite:', inviteError);
        return { ...subscriber, inviteResult: null, wasUpdated };
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['subscribers'] });
      const title = data.wasUpdated ? 'Подписчик обновлён' : 'Подписчик добавлен';
      if (data.inviteResult?.message_sent) {
        toast({ title, description: 'Уведомление и приглашение отправлены в Telegram' });
      } else if (data.inviteResult?.invite_link) {
        navigator.clipboard.writeText(data.inviteResult.invite_link);
        toast({ 
          title, 
          description: 'Уведомление отправлено. Пользователь должен запустить бота. Ссылка скопирована.' 
        });
      } else {
        toast({ title, description: 'Уведомление отправлено' });
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
    mutationFn: async ({ 
      id, 
      _oldStatus, 
      ...updates 
    }: Partial<Subscriber> & { id: string; _oldStatus?: string }) => {
      // First get current subscriber to compare status
      const { data: currentSubscriber, error: fetchError } = await supabase
        .from('subscribers')
        .select('telegram_user_id, status, subscription_end, tier_id')
        .eq('id', id)
        .single();

      if (fetchError) throw fetchError;

      const oldStatus = _oldStatus || currentSubscriber?.status;
      const newStatus = updates.status;

      // If admin sets status to active but doesn't provide subscription_end,
      // and the current end date is missing/expired, compute a new end date from the tier.
      // This prevents Telegram notification + MiniApp from using a past date.
      let computedSubscriptionEnd: string | null = null;
      const currentEnd = currentSubscriber?.subscription_end ? new Date(currentSubscriber.subscription_end) : null;
      const currentEndIsExpired = !currentEnd || isPast(currentEnd);
      const effectiveTierId = (updates.tier_id ?? currentSubscriber?.tier_id) as string | null | undefined;

      if (
        newStatus === 'active' &&
        (updates.subscription_end == null) &&
        currentEndIsExpired &&
        effectiveTierId
      ) {
        const { data: tier, error: tierError } = await supabase
          .from('subscription_tiers')
          .select('interval_unit, interval_count, duration_days')
          .eq('id', effectiveTierId)
          .single();

        if (tierError) throw tierError;

        const startDate = new Date();
        const intervalUnit = (tier?.interval_unit ?? null) as string | null;
        const intervalCount = typeof tier?.interval_count === 'number' ? tier.interval_count : null;
        const durationDays = typeof tier?.duration_days === 'number' ? tier.duration_days : 30;

        let newEndDate = new Date(startDate);
        if (intervalUnit && intervalCount) {
          if (intervalUnit === 'year') newEndDate = addYears(startDate, intervalCount);
          else if (intervalUnit === 'month') newEndDate = addMonths(startDate, intervalCount);
          else if (intervalUnit === 'week') newEndDate = addDays(startDate, intervalCount * 7);
          else if (intervalUnit === 'day') newEndDate = addDays(startDate, intervalCount);
          else newEndDate = addDays(startDate, durationDays || 30);
        } else {
          newEndDate = addDays(startDate, durationDays || 30);
        }

        computedSubscriptionEnd = newEndDate.toISOString();
        console.log('[useUpdateSubscriber] Auto computed subscription_end for activation', {
          subscriber_id: id,
          effectiveTierId,
          current_end: currentSubscriber?.subscription_end,
          computed_end: computedSubscriptionEnd,
          interval_unit: intervalUnit,
          interval_count: intervalCount,
          duration_days: durationDays,
        });
      }

      const finalUpdates: Record<string, unknown> = {
        ...updates,
        ...(computedSubscriptionEnd ? { subscription_end: computedSubscriptionEnd } : null),
      };

      // Update the subscriber
      const { data, error } = await supabase
        .from('subscribers')
        .update(finalUpdates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // If status changed, call edge function to handle kick/notifications
      if (newStatus && oldStatus !== newStatus && currentSubscriber?.telegram_user_id) {
        try {
          console.log(`Status changed: ${oldStatus} -> ${newStatus}, triggering edge function`);
          
          const { error: fnError } = await supabase.functions.invoke('subscriber-status-change', {
            body: {
              action: 'status_change',
              subscriber_id: id,
              telegram_user_id: currentSubscriber.telegram_user_id,
              old_status: oldStatus,
              new_status: newStatus,
              subscription_end:
                (finalUpdates.subscription_end as string | undefined) ||
                currentSubscriber.subscription_end,
            },
          });

          if (fnError) {
            console.error('Status change edge function error:', fnError);
            // Don't throw - the update succeeded, just log the notification failure
          }
        } catch (e) {
          console.error('Failed to trigger status change actions:', e);
        }
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscribers'] });
      toast({ title: 'Подписчик обновлён' });
    },
    onError: (error: Error) => {
      toast({ title: 'Ошибка обновления', description: error.message, variant: 'destructive' });
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
