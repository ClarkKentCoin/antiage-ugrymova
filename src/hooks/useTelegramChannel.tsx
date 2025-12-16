import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ChannelActionResult {
  success?: boolean;
  error?: string;
  invite_link?: string;
  message_sent?: boolean;
  is_member?: boolean;
  status?: string;
  message?: string;
}

async function callChannelFunction(action: string, telegram_user_id?: number, subscriber_id?: string): Promise<ChannelActionResult> {
  const { data, error } = await supabase.functions.invoke('telegram-channel', {
    body: { action, telegram_user_id, subscriber_id },
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export function useSendInvite() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ telegram_user_id, subscriber_id }: { telegram_user_id: number; subscriber_id?: string }) => {
      return callChannelFunction('send_invite', telegram_user_id, subscriber_id);
    },
    onSuccess: (data) => {
      if (data.message_sent) {
        toast({ title: 'Приглашение отправлено пользователю' });
      } else if (data.invite_link) {
        toast({ 
          title: 'Ссылка создана', 
          description: 'Не удалось отправить сообщение. Пользователь должен сначала запустить бота.' 
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: 'Ошибка', description: error.message, variant: 'destructive' });
    },
  });
}

export function useKickUser() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ telegram_user_id, subscriber_id }: { telegram_user_id: number; subscriber_id?: string }) => {
      return callChannelFunction('kick_user', telegram_user_id, subscriber_id);
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

  return useMutation({
    mutationFn: async ({ telegram_user_id, subscriber_id }: { telegram_user_id: number; subscriber_id?: string }) => {
      return callChannelFunction('check_membership', telegram_user_id, subscriber_id);
    },
    onError: (error: Error) => {
      toast({ title: 'Ошибка проверки', description: error.message, variant: 'destructive' });
    },
  });
}

export function useCreateInviteLink() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      return callChannelFunction('create_invite_link');
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
