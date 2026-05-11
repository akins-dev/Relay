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
}

const Ctx = createContext<AuthCtx>({
  user: null,
  loading: true,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase  = useRef(createClient()).current;

  const loadUser = useCallback(async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) {
      setUser(null);
      setLoading(false);
      return;
    }
    // maybeSingle() returns null instead of throwing 406 when row is missing
    const { data: profile } = await supabase
      .from('profiles')
      .select('username, avatar_url')
      .eq('id', authUser.id)
      .maybeSingle<{ username: string; avatar_url: string | null }>();
    setUser({
      id:         authUser.id,
      email:      authUser.email ?? '',
      username:   profile?.username ?? authUser.email?.split('@')[0] ?? '',
      avatar_url: profile?.avatar_url ?? null,
    });
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (!session || event === 'SIGNED_OUT') {
        setUser(null);
        setLoading(false);
        return;
      }
      // INITIAL_SESSION fires once on mount with the existing session.
      // SIGNED_IN fires after a fresh login.
      // Both need a full loadUser() to get the profile.
      loadUser();
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [loadUser, supabase]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, [supabase]);

  return (
    <Ctx.Provider value={{ user, loading, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);