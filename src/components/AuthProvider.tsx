'use client';
import {
  createContext, useContext, useState, useEffect,
  useCallback, useRef, ReactNode,
} from 'react';
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

  // Stable singleton ref — never changes across renders, safe for useCallback deps
  const supabase = useRef(createClient()).current;

  const loadUser = useCallback(async () => {
    setLoading(true); // Hold components in loading state while we validate with the server
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) {
      setUser(null);
      setLoading(false);
      return;
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('username, avatar_url')
      .eq('id', authUser.id)
      .single<{ username: string; avatar_url: string | null }>();
    setUser({
      id:         authUser.id,
      email:      authUser.email ?? '',
      username:   profile?.username ?? authUser.email?.split('@')[0] ?? '',
      avatar_url: profile?.avatar_url,
    });
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // Initial load
    loadUser();

    // Listen for all subsequent auth events.
    // IMPORTANT: also handle INITIAL_SESSION — Supabase fires this on every
    // page load before SIGNED_IN. Without it, an authenticated user on first
    // render sees the wrong state until loadUser() resolves.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session || event === 'SIGNED_OUT') {
        setUser(null);
        setLoading(false);
      } else {
        // Covers: INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED
        loadUser();
      }
    });

    return () => subscription.unsubscribe();
  }, [loadUser, supabase]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, [supabase]);

  return (
    <Ctx.Provider value={{ user, loading, logout, refresh: loadUser }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
