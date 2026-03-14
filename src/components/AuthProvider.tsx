'use client';
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface User { id: string; username: string; email: string; }
interface AuthCtx {
  user: User | null; token: string | null;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>({ user: null, token: null, setAuth: () => {}, logout: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const t = localStorage.getItem('mcp_token');
    if (t) {
      setToken(t);
      fetch('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } })
        .then(r => r.json()).then(d => { if (d.user) setUser(d.user); })
        .catch(() => { localStorage.removeItem('mcp_token'); });
    }
  }, []);

  function setAuth(t: string, u: User) {
    localStorage.setItem('mcp_token', t);
    setToken(t); setUser(u);
  }

  function logout() {
    localStorage.removeItem('mcp_token');
    setToken(null); setUser(null);
  }

  return <Ctx.Provider value={{ user, token, setAuth, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
