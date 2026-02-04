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
  // Used for inner join filtering - only subscribers with completed payments
  payment_history?: { id: string; status: string }[];
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
      // Use INNER join with payment_history to only get subscribers
      // who have at least one completed payment (manual or robokassa)
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
          ),
          payment_history!inner(id, status)
        `)
        .eq('payment_history.status', 'completed')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Subscriber[];
    },
  });
}

// Response type from get-subscriber-status edge function
export interface SubscriberStatusResponse {
  subscriber: Subscriber | null;
  grace_period_days: number;
  grace_days_remaining: number | null;
  grace_end_at: string | null;
  // Debug fields
  function_version?: string;
  server_now?: string;
  expires_at_raw?: string | null;
  grace_ms_remaining?: number | null;
  _debug?: {
    tenant_id_used: string;
    tenant_slug_used: string | null;
    identity_source?: 'telegram' | 'test';
    resolved_user_id?: number | null;
  };
}

export function useSubscriber(telegramUserId: number | null, initData?: string | null, tenantSlug?: string | null, testMode?: boolean) {
  // Check if we're in browser test mode (no initData but have user id)
  const isTestMode = testMode === true || (!initData && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('test'));
  
  return useQuery({
    // Include nocache timestamp in key ONLY for test mode to prevent stale cache
    queryKey: ['subscriber', telegramUserId, initData ? 'telegram' : 'direct', tenantSlug, isTestMode ? Date.now() : 'stable'],
    queryFn: async (): Promise<SubscriberStatusResponse | null> => {
      if (telegramUserId == null) return null;

      // In Telegram Mini App we use a backend function that validates initData
      // In test mode, we also use the edge function but skip initData validation
      if (initData || isTestMode) {
        const { data, error } = await supabase.functions.invoke('get-subscriber-status', {
          body: {
            telegram_user_id: telegramUserId,
            init_data: initData ?? null,
            tenant_slug: tenantSlug,
            // For test mode, add nocache to bypass any server caching and signal test mode
            ...(isTestMode ? { nocache: Date.now(), test_mode: true } : {}),
          },
        });

        // Handle edge function errors
        if (error) {
          console.error('[useSubscriber] Edge function error:', error);
          throw error;
        }

        // Handle application-level errors returned from edge function
        if (data?.error) {
          console.error('[useSubscriber] API error:', data.error, data.reason, data._debug);
          // For invalid_init_data or other auth errors, return null (user not found/not authorized)
          if (data.error === 'invalid_init_data' || data.error === 'user_id_mismatch') {
            return null;
          }
          throw new Error(data.error);
        }

        // Return full response with debug info
        return {
          subscriber: data?.subscriber ?? null,
          grace_period_days: data?.grace_period_days ?? 0,
          grace_days_remaining: data?.grace_days_remaining ?? null,
          grace_end_at: data?.grace_end_at ?? null,
          function_version: data?.function_version,
          server_now: data?.server_now,
          expires_at_raw: data?.expires_at_raw,
          grace_ms_remaining: data?.grace_ms_remaining,
          _debug: data?._debug,
        } as SubscriberStatusResponse;
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
      
      // Wrap in response format for consistency
      return {
        subscriber: data as Subscriber | null,
        grace_period_days: 0,
        grace_days_remaining: null,
        grace_end_at: null,
      } as SubscriberStatusResponse;
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
        .select('telegram_user_id, status, subscription_end')
        .eq('id', id)
        .single();

      if (fetchError) throw fetchError;

      const oldStatus = _oldStatus || currentSubscriber?.status;
      const newStatus = updates.status;

      // Update the subscriber
      const { data, error } = await supabase
        .from('subscribers')
        .update(updates)
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
              subscription_end: updates.subscription_end || currentSubscriber.subscription_end,
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
