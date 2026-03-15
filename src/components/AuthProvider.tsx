'use client';
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';

interface User { id: string; username: string; email: string; avatar_url?: string | null; }
interface AuthCtx {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({ user: null, loading: true, logout: async () => {}, refresh: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const loadUser = useCallback(async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) { setUser(null); setLoading(false); return; }
    const { data: profile } = await supabase
      .from('profiles').select('username, avatar_url').eq('id', authUser.id).single();
    setUser({
      id:         authUser.id,
      email:      authUser.email ?? '',
      username:   profile?.username ?? authUser.email?.split('@')[0] ?? '',
      avatar_url: profile?.avatar_url,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    loadUser();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) { setUser(null); setLoading(false); }
      else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') loadUser();
    });
    return () => subscription.unsubscribe();
  }, [loadUser]);

  async function logout() {
    await supabase.auth.signOut();
    setUser(null);
  }

  return <Ctx.Provider value={{ user, loading, logout, refresh: loadUser }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
