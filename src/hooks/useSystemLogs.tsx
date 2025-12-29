import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SystemLog {
  id: string;
  created_at: string;
  level: string;
  event_type: string;
  source: string;
  subscriber_id: string | null;
  telegram_user_id: number | null;
  tier_id: string | null;
  request_id: string | null;
  message: string | null;
  payload: Record<string, any>;
}

export interface LogFilters {
  search?: string;
  email?: string;
  event_type?: string;
  level?: string;
  source?: string;
  dateRange?: '24h' | '7d' | '30d' | 'all';
}

export function useSystemLogs(filters: LogFilters = {}, page: number = 0, pageSize: number = 50) {
  return useQuery({
    queryKey: ['system-logs', filters, page, pageSize],
    queryFn: async () => {
      let query = supabase
        .from('system_logs')
        .select('*, subscribers(telegram_username, first_name, last_name, email)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      // Apply filters
      if (filters.event_type && filters.event_type !== 'all') {
        query = query.eq('event_type', filters.event_type);
      }

      if (filters.level && filters.level !== 'all') {
        query = query.eq('level', filters.level);
      }

      if (filters.source && filters.source !== 'all') {
        query = query.eq('source', filters.source);
      }

      // Date range filter
      if (filters.dateRange && filters.dateRange !== 'all') {
        const now = new Date();
        let startDate: Date;
        
        switch (filters.dateRange) {
          case '24h':
            startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            break;
          case '7d':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case '30d':
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
          default:
            startDate = new Date(0);
        }
        
        query = query.gte('created_at', startDate.toISOString());
      }

      // Search filter (searches in message, event_type, request_id, and telegram_user_id)
      if (filters.search) {
        const searchTerm = filters.search.trim();
        // Try to parse as number for telegram_user_id search
        const searchNum = parseInt(searchTerm, 10);
        
        if (!isNaN(searchNum)) {
          query = query.or(`message.ilike.%${searchTerm}%,event_type.ilike.%${searchTerm}%,request_id.ilike.%${searchTerm}%,telegram_user_id.eq.${searchNum}`);
        } else {
          query = query.or(`message.ilike.%${searchTerm}%,event_type.ilike.%${searchTerm}%,request_id.ilike.%${searchTerm}%`);
        }
      }

      // Email filter - requires a subquery approach
      // We'll filter on the client side after fetching if email filter is set
      // This is a workaround since Supabase doesn't support filtering on joined fields directly in .or()

      const { data, error, count } = await query;

      if (error) throw error;

      // Filter by email on client side if email filter is provided
      let filteredData = data as (SystemLog & { subscribers: { telegram_username: string | null; first_name: string | null; last_name: string | null; email: string | null } | null })[];
      
      if (filters.email && filters.email.trim()) {
        const emailSearch = filters.email.trim().toLowerCase();
        filteredData = filteredData.filter(log => 
          log.subscribers?.email?.toLowerCase().includes(emailSearch)
        );
      }

      return {
        logs: filteredData,
        totalCount: filters.email ? filteredData.length : (count || 0),
      };
    },
  });
}

export function useLogEventTypes() {
  return useQuery({
    queryKey: ['log-event-types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_logs')
        .select('event_type')
        .limit(1000);

      if (error) throw error;

      // Get unique event types
      const uniqueTypes = [...new Set(data?.map(d => d.event_type) || [])].sort();
      return uniqueTypes;
    },
    staleTime: 60000, // Cache for 1 minute
  });
}
