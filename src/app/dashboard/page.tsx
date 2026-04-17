'use client';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams }  from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth }    from '@/components/AuthProvider';
import { Button }     from '@/components/ui/button';
import { Input }      from '@/components/ui/input';
import { Badge }      from '@/components/ui/badge';
import { cn }         from '@/lib/cn';
import {
  Server, Key, Lock, User, Plus, Trash2,
  Copy, Check, LogOut, ExternalLink, ShieldCheck,
  Activity, Star, Zap, LayoutDashboard, MonitorPlay
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface DashboardData {
  user:    { id: string; username: string; email: string; created_at: string };
  servers: Array<{
    id: string; name: string; display_name: string;
    stars: number; total_calls: number; status: string; trust_score: number;
  }>;
  apiKeys: Array<{
    id: string; key_prefix: string; name: string;
    last_used_at: string | null; created_at: string;
  }>;
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ value, label, icon: Icon, color = 'text-brand', gradient = 'from-brand/10 to-transparent' }: {
  value: string | number; label: string;
  icon: React.ElementType; color?: string; gradient?: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-white/20 hover:shadow-2xl hover:shadow-black/20">
      <div className={cn("absolute inset-0 bg-gradient-to-br opacity-50", gradient)} />
      <div className="relative z-10 mb-4 flex items-center justify-between">
        <span className="text-[12px] font-bold uppercase tracking-widest text-muted-foreground/80">{label}</span>
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10 transition-transform group-hover:scale-110', color)}>
          <Icon size={16} />
        </div>
      </div>
      <div className={cn('relative z-10 font-mono text-4xl font-extrabold tracking-tight', color)}>{value}</div>
    </div>
  );
}

// ── Tab button ────────────────────────────────────────────────────────────────
function Tab({ id, active, onClick, icon: Icon, label, count }: {
  id: string; active: boolean; onClick: () => void;
  icon: React.ElementType; label: string; count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        '-mb-px flex items-center gap-2.5 border-b-2 px-5 py-3 text-[14px] font-medium transition-all duration-200',
        active
          ? 'border-brand text-foreground shadow-[inset_0_-2px_8px_-4px_rgba(255,100,0,0.4)]'
          : 'border-transparent text-muted-foreground/70 hover:border-white/20 hover:text-foreground'
      )}
    >
      <Icon size={16} className={active ? 'text-brand' : ''} />
      {label}
      {count !== undefined && count > 0 && (
        <span className={cn(
          'ml-1 rounded-full px-2 py-0.5 font-mono text-[11px] font-bold transition-colors',
          active ? 'bg-brand/20 text-brand ring-1 ring-brand/30' : 'bg-white/5 text-muted-foreground ring-1 ring-white/10'
        )}>{count}</span>
      )}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
type TabId = 'servers' | 'keys' | 'secrets' | 'policies' | 'account';

function DashboardContent() {
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlTab = searchParams.get('tab') as TabId | null;
  const adminUid = (process.env.NEXT_PUBLIC_ADMIN_UID ?? '').trim();
  const isAdminUser = Boolean(user && adminUid && user.id === adminUid);

  const [data,        setData]        = useState<DashboardData | null>(null);
  const [tab,         setTab]         = useState<TabId>(urlTab || 'servers');
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError,   setDataError]   = useState('');

  // API key creation
  const [keyName,    setKeyName]    = useState('');
  const [keyError,   setKeyError]   = useState('');
  const [keyLoading, setKeyLoading] = useState(false);
  const [newKey,     setNewKey]     = useState('');
  const [keyCopied,  setKeyCopied]  = useState(false);

  // ── Load dashboard data ───────────────────────────────────────────────────
  const load = useCallback(async () => {
    setDataLoading(true);
    setDataError('');
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      
      const res = await fetch('/api/auth/me', { 
        cache: 'no-store',
        credentials: 'include',
        headers: session ? { 'Authorization': `Bearer ${session.access_token}` } : undefined
      });
      if (!res.ok) {
        let msg = 'Failed to load';
        if (res.status === 401) {
          const raw = await res.json().catch(() => ({}));
          console.error('[Dashboard] 401 response debug:', raw.debug);
          msg = 'Unauthorized';
        }
        throw new Error(msg);
      }
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setDataError(e.message ?? 'Could not load dashboard');
    } finally {
      setDataLoading(false);
    }
  }, []);

  // Sync URL -> Tab
  useEffect(() => {
    if (urlTab && urlTab !== tab) {
      setTab(urlTab);
    }
  }, [urlTab, tab]);

  const handleTabClick = (newTab: TabId) => {
    setTab(newTab);
    router.push(`/dashboard?tab=${newTab}`, { scroll: false });
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push('/login'); return; }
    load();
  }, [user, authLoading, load, router]);

  // ── API key actions ───────────────────────────────────────────────────────
  async function createKey() {
    const name = keyName.trim();
    if (!name) { setKeyError('Key name is required'); return; }
    setKeyLoading(true);
    setKeyError('');
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session) headers['Authorization'] = `Bearer ${session.access_token}`;

      const res = await fetch('/api/auth/api-keys', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to create key');
      setNewKey(json.key);
      setKeyName('');
      load();
    } catch (e: any) {
      setKeyError(e.message);
    } finally {
      setKeyLoading(false);
    }
  }

  async function deleteKey(id: string, name: string) {
    if (!confirm(`Delete API key "${name}"? Any agent using it will immediately lose access.`)) return;
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session) headers['Authorization'] = `Bearer ${session.access_token}`;

      await fetch(`/api/auth/api-keys?id=${id}`, { method: 'DELETE', headers });
      load();
    } catch {
      // Non-fatal — reload will show current state
    }
  }

  function copyKey() {
    navigator.clipboard?.writeText(newKey);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  }

  async function handleLogout() {
    await logout();
    router.push('/');
  }

  // ── Derived stats ─────────────────────────────────────────────────────────
  const totalStars = data?.servers.reduce((a, s) => a + (s.stars || 0), 0) ?? 0;
  const totalCalls = data?.servers.reduce((a, s) => a + (s.total_calls || 0), 0) ?? 0;
  const fmtCalls   = totalCalls >= 1000 ? `${(totalCalls / 1000).toFixed(1)}K` : String(totalCalls);

  // ── Loading / error states ────────────────────────────────────────────────
  if (authLoading || (dataLoading && !data)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-brand" />
      </div>
    );
  }

  if (dataError) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <p className="text-muted-foreground">{dataError}</p>
        <Button variant="outline" onClick={load}>Retry</Button>
      </div>
    );
  }

  if (!data) return null;

  const avatar = data.user.username?.[0]?.toUpperCase() ?? '?';

  return (
    <div className="mx-auto max-w-[1040px] px-6 py-12 sm:px-8">
      
      {/* ── Background Effects ─────────────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-brand/5 via-background to-background" />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-10 flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-brand/80 text-2xl font-black text-white shadow-[0_4px_24px_rgba(255,100,0,0.3)] ring-1 ring-white/20">
            {avatar}
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
              Welcome back, {data.user.username}
            </h1>
            <p className="font-medium text-muted-foreground/80">{data.user.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isAdminUser && (
            <Link href="/admin">
              <Button variant="outline" className="gap-2 rounded-xl border-white/10 bg-white/5 py-5 text-white hover:bg-white/10">
                <LayoutDashboard size={16} /> Admin panel
              </Button>
            </Link>
          )}
          <Link href="/publish">
            <Button className="gap-2 rounded-xl py-5 shadow-lg shadow-brand/20 transition-all hover:scale-105">
              <Plus size={16} /> Publish server
            </Button>
          </Link>
        </div>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard value={data.servers.length}       label="Active Servers" icon={Server}   color="text-white" gradient="from-blue-500/10 to-transparent" />
        <StatCard value={totalStars.toLocaleString()} label="Total Stars"    icon={Star}     color="text-white" gradient="from-amber-500/10 to-transparent" />
        <StatCard value={fmtCalls}                  label="API Calls"      icon={Activity} color="text-white" gradient="from-emerald-500/10 to-transparent" />
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="mb-8 flex overflow-x-auto border-b border-white/10 scrollbar-hide">
        <Tab id="servers"  active={tab==='servers'}  onClick={()=>handleTabClick('servers')}  icon={MonitorPlay} label="Servers"    count={data.servers.length} />
        <Tab id="keys"     active={tab==='keys'}     onClick={()=>handleTabClick('keys')}     icon={Key}         label="API Keys"   count={data.apiKeys.length} />
        <Tab id="secrets"  active={tab==='secrets'}  onClick={()=>handleTabClick('secrets')}  icon={Lock}        label="Secrets"    />
        <Tab id="policies" active={tab==='policies'} onClick={()=>handleTabClick('policies')} icon={ShieldCheck} label="Policies"   />
        <Tab id="account"  active={tab==='account'}  onClick={()=>handleTabClick('account')}  icon={User}        label="Account"    />
      </div>

      {/* ── Servers tab ────────────────────────────────────────────────────── */}
      {tab === 'servers' && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          {data.servers.length === 0 ? (
            <div className="flex flex-col items-center gap-5 rounded-3xl border border-dashed border-white/20 bg-white/5 py-24 text-center backdrop-blur-sm">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand/10 text-brand ring-1 ring-brand/30">
                <MonitorPlay size={32} />
              </div>
              <div>
                <p className="mb-2 text-xl font-bold text-foreground">No servers yet</p>
                <p className="text-muted-foreground">Publish your first MCP server to get started.</p>
              </div>
              <Link href="/publish">
                <Button className="mt-2 rounded-full px-8 py-5 text-[15px] shadow-lg shadow-brand/20 transition-transform hover:scale-105">
                  Publish your first server
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.servers.map(s => (
                <Link key={s.id} href={`/registry/${s.name}`} className="group no-underline">
                  <div className="flex h-full flex-col justify-between rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-brand/40 hover:bg-white/10 hover:shadow-[0_8px_30px_rgba(255,100,0,0.15)]">
                    <div className="mb-6 flex items-start justify-between">
                      <div className="min-w-0 pr-4">
                        <p className="truncate font-mono text-base font-bold text-brand group-hover:text-brand/90">{s.name}</p>
                        <p className="mt-1 line-clamp-1 text-sm text-muted-foreground/80">{s.display_name}</p>
                      </div>
                      <Badge variant={s.status === 'active' ? 'success' : 'destructive'} className="shrink-0 bg-white/10">
                        {s.status}
                      </Badge>
                    </div>
                    <div className="flex items-end justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Star size={14} className="text-amber-400" /> 
                          <span className="font-semibold text-foreground/90">{s.stars.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[12px] text-muted-foreground/70">
                          <Activity size={12} /> {(s.total_calls || 0).toLocaleString()} calls
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <div className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground/60">
                          TRUST <span className={s.trust_score >= 85 ? 'text-green-400' : s.trust_score >= 70 ? 'text-amber-400' : 'text-red-400'}>{s.trust_score}</span>
                        </div>
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10">
                          <div className={cn(
                            'h-full rounded-full transition-all duration-1000',
                            s.trust_score >= 85 ? 'bg-green-500' : s.trust_score >= 70 ? 'bg-amber-400' : 'bg-red-400'
                          )} style={{ width: `${s.trust_score}%` }} />
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── API Keys tab ───────────────────────────────────────────────────── */}
      {tab === 'keys' && (
        <div className="animate-in fade-in slide-in-from-bottom-4 space-y-6 duration-500">
          {/* New key banner */}
          {newKey && (
            <div className="mb-4 rounded-xl border border-green-500/30 bg-green-500/10 p-5 shadow-[0_0_20px_rgba(34,197,94,0.15)] ring-1 ring-green-500/20 backdrop-blur-md">
              <p className="mb-3 text-[14px] font-bold text-green-400">
                ✓ Copy your API key now — it will not be shown again!
              </p>
              <div className="flex items-center gap-3">
                <code className="flex-1 overflow-x-auto rounded-lg bg-black/40 px-4 py-3 font-mono text-[13px] text-green-300 break-all ring-1 ring-white/10">
                  {newKey}
                </code>
                <Button onClick={copyKey} className="shrink-0 gap-2 rounded-xl bg-green-600 px-6 py-5 hover:bg-green-500">
                  {keyCopied ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy Key</>}
                </Button>
              </div>
            </div>
          )}

          {/* Create form */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl transition-colors focus-within:border-brand/40 focus-within:shadow-[0_0_30px_rgba(255,100,0,0.1)]">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-foreground">
              <Key className="text-brand" /> Create new API key
            </h3>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                placeholder="Key name (e.g. Production, CI Agent)"
                value={keyName}
                onChange={e => { setKeyName(e.target.value); setKeyError(''); }}
                onKeyDown={e => e.key === 'Enter' && createKey()}
                className="h-12 flex-1 rounded-xl border-white/20 bg-black/20 text-base placeholder:text-muted-foreground/50 focus:border-brand focus:ring-brand/30"
              />
              <Button onClick={createKey} disabled={keyLoading || !keyName.trim()} className="h-12 shrink-0 rounded-xl px-8 shadow-lg shadow-brand/20 transition-all hover:scale-105">
                {keyLoading ? 'Creating…' : 'Create Key'}
              </Button>
            </div>
            {keyError && <p className="mt-3 text-[13px] font-medium text-red-500">{keyError}</p>}
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-white/5 p-3 text-[12px] text-muted-foreground/80">
              <Zap size={14} className="text-amber-400" />
              <span>Keys give agents <strong>200 calls/min</strong> (vs 30/min anonymous). Pass as <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[11px] text-brand/90 ring-1 ring-white/10">Authorization: Bearer sk_mcp_...</code></span>
            </div>
          </div>

          {/* Keys list */}
          <div className="mt-8">
            <h3 className="mb-4 pl-1 text-[13px] font-bold uppercase tracking-widest text-muted-foreground/80">Your Keys</h3>
            {data.apiKeys.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-transparent py-12 text-center text-[15px] font-medium text-muted-foreground/60">
                No active API keys found.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {data.apiKeys.map(key => (
                  <div key={key.id} className="flex flex-col justify-between rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-md transition-colors hover:border-white/20 hover:bg-white/10">
                    <div className="mb-6">
                      <p className="mb-1.5 text-base font-bold text-foreground">{key.name}</p>
                      <code className="rounded-md bg-black/20 px-2 py-1 font-mono text-[13px] tracking-widest text-brand ring-1 ring-white/10">
                        {key.key_prefix}••••••••••••
                      </code>
                    </div>
                    <div className="flex items-center justify-between border-t border-white/10 pt-4">
                       <span className="text-[12px] font-medium text-muted-foreground/70">
                        {key.last_used_at
                          ? <span className="flex items-center gap-1.5"><Activity size={12} className="text-green-400"/> Used {new Date(key.last_used_at).toLocaleDateString()}</span>
                          : <span className="flex items-center gap-1.5 opacity-60"><Lock size={12}/> Never used</span>}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteKey(key.id, key.name)}
                        className="h-8 gap-1.5 rounded-lg text-red-400/80 hover:bg-red-500/10 hover:text-red-400"
                      >
                        <Trash2 size={13} /> Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Secrets tab ────────────────────────────────────────────────────── */}
      {tab === 'secrets' && (
        <div className="animate-in fade-in slide-in-from-bottom-4 space-y-6 duration-500">
          <div className="rounded-2xl border border-brand/20 bg-gradient-to-br from-brand/10 to-transparent p-8 backdrop-blur-xl">
            <div className="mb-6 flex items-start gap-4">
              <div className="mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand/20 text-brand ring-1 ring-brand/30">
                <Lock size={24} />
              </div>
              <div>
                <h3 className="mb-2 text-xl font-bold text-foreground">Stored Credentials</h3>
                <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground/90">
                  Store provider API keys once. The proxy encrypts them via AES-256-GCM. 
                  When an agent calls a tool requiring auth, the proxy decrypts and injects the credentials at call time — <strong className="text-white">your agent never sees the raw value</strong>.
                </p>
              </div>
            </div>

            <div className="mb-8 grid gap-4 sm:grid-cols-3">
              {[
                { n: '1', t: 'Store keys securely here in Vault' },
                { n: '2', t: 'Agents access tools via Proxy' },
                { n: '3', t: 'Proxy injects keys seamlessly' },
              ].map(s => (
                <div key={s.n} className="rounded-xl bg-black/20 p-5 ring-1 ring-white/5 backdrop-blur-sm transition-colors hover:bg-black/30 text-center sm:text-left">
                  <div className="mx-auto mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-brand/20 font-mono text-sm font-bold text-brand ring-1 ring-brand/40 sm:mx-0">
                    {s.n}
                  </div>
                  <p className="text-[14px] font-medium text-foreground/90">{s.t}</p>
                </div>
              ))}
            </div>

            <Link href="/dashboard/secrets">
              <Button size="lg" className="gap-2 rounded-xl text-base shadow-xl shadow-brand/20 transition-transform hover:scale-105">
                <Key size={18} /> Manage Secrets Now
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* ── Policies & Account tabs skipped for brevity but easily adjustable ──────────────── */}
      
      {tab === 'policies' && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
           {/* Minimal port for brevity */}
           <div className="rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
             <div className="mb-6 flex items-center gap-3">
               <ShieldCheck size={24} className="text-brand" />
               <h3 className="text-xl font-bold text-foreground">Tool Policies</h3>
             </div>
             <p className="mb-8 text-muted-foreground">Manage granular permissions across all authenticated agents dynamically.</p>
             <Link href="/dashboard/policies"><Button className="rounded-xl">Manage Policy Rules</Button></Link>
           </div>
        </div>
      )}

      {tab === 'account' && (
        <div className="animate-in fade-in slide-in-from-bottom-4 max-w-lg duration-500">
          <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
            <h3 className="mb-6 text-[12px] font-bold uppercase tracking-widest text-muted-foreground">
              Account Overview
            </h3>
            <div className="space-y-4 divide-y divide-white/5">
              {[
                ['Username',     data.user.username],
                ['Email',        data.user.email],
                ['Member since', new Date(data.user.created_at).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between pt-4 text-[14px]">
                  <span className="text-muted-foreground/70">{label}</span>
                  <span className="font-semibold text-foreground">{value}</span>
                </div>
              ))}
            </div>
          </div>

          <Button variant="destructive" className="w-full rounded-xl py-6 text-base" onClick={handleLogout}>
            <LogOut size={16} className="mr-2" /> End Session
          </Button>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand/20 border-t-brand" />
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}
