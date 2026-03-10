import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

interface ChannelActionResult {
  success?: boolean;
  error?: string;
  invite_link?: string;
  message_sent?: boolean;
  is_member?: boolean;
  status?: string;
  message?: string;
}

async function callChannelFunction(
  action: string,
  tenantSlug: string,
  telegram_user_id?: number,
  subscriber_id?: string
): Promise<ChannelActionResult> {
  const { data, error } = await supabase.functions.invoke('telegram-channel', {
    body: { action, telegram_user_id, subscriber_id, tenant_slug: tenantSlug },
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

function requireTenantSlug(tenantSlug: string | null): string {
  if (!tenantSlug) {
    throw new Error('Tenant context is missing. Please reload the page.');
  }
  return tenantSlug;
}

export function useSendInvite() {
  const { toast } = useToast();
  const { tenantSlug } = useAuth();

  return useMutation({
    mutationFn: async ({ telegram_user_id, subscriber_id }: { telegram_user_id: number; subscriber_id?: string }) => {
      const slug = requireTenantSlug(tenantSlug);
      return callChannelFunction('send_invite', slug, telegram_user_id, subscriber_id);
    },
    onSuccess: (data) => {
      if (data.message_sent) {
        toast({ title: 'Приглашение отправлено пользователю' });
      } else if (data.invite_link) {
        navigator.clipboard.writeText(data.invite_link);
        toast({ 
          title: 'Ссылка создана и скопирована', 
          description: data.error || 'Пользователь должен сначала запустить бота. Ссылка скопирована в буфер обмена.' 
        });
      } else {
        toast({ title: 'Приглашение создано', description: 'Проверьте результат' });
      }
    },
    onError: (error: Error) => {
      console.error('Send invite error:', error);
      toast({ title: 'Ошибка', description: error.message, variant: 'destructive' });
    },
  });
}

export function useKickUser() {
  const { toast } = useToast();
  const { tenantSlug } = useAuth();

  return useMutation({
    mutationFn: async ({ telegram_user_id, subscriber_id }: { telegram_user_id: number; subscriber_id?: string }) => {
      const slug = requireTenantSlug(tenantSlug);
      return callChannelFunction('kick_user', slug, telegram_user_id, subscriber_id);
    },
    onSuccess: () => {
      toast({ title: 'Пользователь удалён из канала' });
    },
    onError: (error: Error) => {
      toast({ title: 'Ошибка', description: error.message, variant: 'destructive' });
    },
  });
}

export function useCheckMembership() {
  const { toast } = useToast();
  const { tenantSlug } = useAuth();

  return useMutation({
    mutationFn: async ({ telegram_user_id, subscriber_id }: { telegram_user_id: number; subscriber_id?: string }) => {
      const slug = requireTenantSlug(tenantSlug);
      return callChannelFunction('check_membership', slug, telegram_user_id, subscriber_id);
    },
    onSuccess: (data) => {
      console.log('Check membership result:', data);
      if (data.is_member) {
        toast({ title: 'Пользователь в канале', description: `Статус: ${data.status}` });
      } else {
        const errorMsg = data.error ? ` (${data.error})` : '';
        toast({ 
          title: 'Пользователь НЕ в канале', 
          description: `Статус: ${data.status}${errorMsg}. Отправьте приглашение.`, 
          variant: 'destructive' 
        });
      }
    },
    onError: (error: Error) => {
      console.error('Check membership error:', error);
      toast({ title: 'Ошибка проверки', description: error.message, variant: 'destructive' });
    },
  });
}

export function useCreateInviteLink() {
  const { toast } = useToast();
  const { tenantSlug } = useAuth();

  return useMutation({
    mutationFn: async () => {
      const slug = requireTenantSlug(tenantSlug);
      return callChannelFunction('create_invite_link', slug);
    },
    onSuccess: (data) => {
      if (data.invite_link) {
        toast({ title: 'Ссылка-приглашение создана' });
      }
    },
    onError: (error: Error) => {
      toast({ title: 'Ошибка', description: error.message, variant: 'destructive' });
    },
  });
}
