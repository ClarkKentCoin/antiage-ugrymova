import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  isLoading: boolean;
  tenantId: string | null;
  tenantSlug: string | null;
  tenantLoading: boolean;
  bootstrapFailed: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [tenantLoading, setTenantLoading] = useState(true);
  const [bootstrapFailed, setBootstrapFailed] = useState(false);

  const loadTenantContext = async (userId: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase
        .from('tenants')
        .select('id, slug')
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn('Error loading tenant context:', error);
        setTenantId(null);
        setTenantSlug(null);
        return false;
      } else if (data) {
        setTenantId(data.id);
        setTenantSlug(data.slug);
        console.debug('Tenant context loaded', { tenantId: data.id, tenantSlug: data.slug, userId });
        return true;
      } else {
        console.warn('No tenant found for user:', userId);
        setTenantId(null);
        setTenantSlug(null);
        return false;
      }
    } catch (error) {
      console.warn('Exception loading tenant context:', error);
      setTenantId(null);
      setTenantSlug(null);
      return false;
    }
  };

  const handleAdminBootstrap = async (userId: string) => {
    setTenantLoading(true);
    setBootstrapFailed(false);

    const found = await loadTenantContext(userId);
    if (found) {
      setTenantLoading(false);
      return;
    }

    // Admin but no tenant — attempt self-heal bootstrap
    console.debug('[bootstrap] Admin detected without tenant, calling ensure_current_admin_bootstrap');
    try {
      const { data, error } = await supabase.rpc('ensure_current_admin_bootstrap');
      if (error) {
        console.error('[bootstrap] RPC error:', error);
        setBootstrapFailed(true);
        setTenantLoading(false);
        return;
      }
      console.debug('[bootstrap] RPC result:', data);

      // Reload tenant context after bootstrap
      const reloaded = await loadTenantContext(userId);
      console.debug('[bootstrap] Tenant reload result:', reloaded ? 'success' : 'still missing');
      if (!reloaded) {
        setBootstrapFailed(true);
      }
    } catch (err) {
      console.error('[bootstrap] Exception:', err);
      setBootstrapFailed(true);
    } finally {
      setTenantLoading(false);
    }
  };

  const handleNonAdminTenant = async (userId: string) => {
    setTenantLoading(true);
    await loadTenantContext(userId);
    setTenantLoading(false);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        checkAdminRole(session.user.id);
      } else {
        setIsLoading(false);
        setTenantLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        checkAdminRole(session.user.id);
      } else {
        setIsAdmin(false);
        setIsLoading(false);
        setTenantId(null);
        setTenantSlug(null);
        setTenantLoading(false);
        setBootstrapFailed(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const checkAdminRole = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('role', 'admin')
        .maybeSingle();
      
      const adminResult = !!data && !error;
      setIsAdmin(adminResult);

      if (adminResult) {
        console.debug('[auth] Admin role confirmed for', userId);
        await handleAdminBootstrap(userId);
      } else {
        await handleNonAdminTenant(userId);
      }
    } catch (error) {
      console.error('Error checking admin role:', error);
      setIsAdmin(false);
      setTenantLoading(false);
    } finally {
      setIsLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, isAdmin, isLoading, tenantId, tenantSlug, tenantLoading, bootstrapFailed, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
