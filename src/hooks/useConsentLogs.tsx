import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ConsentLog {
  id: string;
  subscriber_id: string;
  consent_type: string;
  consent_date: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export function useConsentLogs(subscriberId: string | null) {
  return useQuery({
    queryKey: ['consent-logs', subscriberId],
    queryFn: async () => {
      if (!subscriberId) return [];
      
      const { data, error } = await supabase
        .from('subscription_consent_log')
        .select('*')
        .eq('subscriber_id', subscriberId)
        .order('consent_date', { ascending: false });
      
      if (error) throw error;
      return data as ConsentLog[];
    },
    enabled: !!subscriberId,
  });
}
