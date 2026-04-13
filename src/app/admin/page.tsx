'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { PaginationControls } from '@/components/ui/pagination-controls';
import { paginateItems } from '@/lib/pagination';

// ── Your admin user ID — change this to your Supabase auth UID ───────────────
// Get it from Supabase → Authentication → Users → your row → User UID
const ADMIN_UID = process.env.NEXT_PUBLIC_ADMIN_UID ?? '';

// ── Types ─────────────────────────────────────────────────────────────────────
interface PlatformKPIs {
  total_servers: number; active_servers: number; verified_servers: number;
  official_servers: number; smithery_servers: number; glama_servers: number;
  github_servers: number; direct_servers: number;
  scan_failures: number; servers_with_cves: number; avg_trust_score: number;
  calls_24h: number; calls_7d: number; calls_30d: number; dlp_triggers_7d: number;
  total_users: number; active_api_keys: number;
  total_ingest_runs: number; last_ingest_at: string;
}
interface IngestQuality {
  source: string; total_servers: number; active_servers: number;
  rejected_servers: number; scan_passed: number; has_cve_issues: number;
  avg_trust_score: number; rejection_rate_pct: number;
}
interface SecurityThreat {
  day: string; total_calls: number; unique_ips: number;
  dlp_triggers: number; blocked_calls: number; rate_limited: number;
  errors: number; dlp_rate_pct: number; avg_latency_ms: number;
}
interface SuspiciousIP {
  ip: string; calls_1h: number; dlp_triggers: number;
  blocked_calls: number; servers_hit: number; risk_score: number;
  first_seen: string; last_seen: string;
}
interface TopServer {
  name: string; source: string; trust_score: number;
  calls_30d: number; error_rate_pct: number; dlp_triggers_30d: number;
}
interface IngestRun {
  id: string; source: string; started_at: string; finished_at: string;
  servers_found: number; servers_added: number; servers_rejected: number;
}

type Tab = 'overview' | 'ingest' | 'security' | 'servers' | 'threats';
const ADMIN_PAGE_SIZES = [8, 16, 24];

export default function AdminPage() {
  const supabase = createClient();
  const router   = useRouter();
  const { user, loading: authLoading } = useAuth();
  const adminUid = ADMIN_UID.trim();
  const isAdmin = Boolean(user && adminUid && user.id === adminUid);
  const [tab,        setTab]        = useState<Tab>('overview');
  const [kpis,       setKpis]       = useState<PlatformKPIs | null>(null);
  const [ingest,     setIngest]     = useState<IngestQuality[]>([]);
  const [threats,    setThreats]    = useState<SecurityThreat[]>([]);
  const [suspIPs,    setSuspIPs]    = useState<SuspiciousIP[]>([]);
  const [topServers, setTopServers] = useState<TopServer[]>([]);
  const [ingestRuns, setIngestRuns] = useState<IngestRun[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [lastRefresh,setLastRefresh]= useState<Date>(new Date());
  const [ingestFeedback, setIngestFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [tablePageSize, setTablePageSize] = useState(8);
  const [tablePages, setTablePages] = useState({
    ingestRuns: 1,
    threats: 1,
    topServers: 1,
    suspIPs: 1,
  });

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // ── Auth guard ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/login?redirect=%2Fadmin');
    }
  }, [authLoading, router, user]);

  // ── Data fetching ─────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setAdminError(null);
    const svc = supabase;

    try {
      const [kpisRes, ingestRes, threatsRes, suspRes, topRes, runsRes] = await Promise.all([
        svc.from('platform_kpis').select('*').single(),
        svc.from('ingest_quality').select('*'),
        svc.from('security_threats').select('*').limit(30),
        svc.from('suspicious_ips').select('*').limit(100),
        svc.from('top_servers_by_usage').select('*').limit(100),
        svc.from('ingest_runs').select('*').order('started_at', { ascending: false }).limit(100),
      ]) as any[];

      if (kpisRes.error) throw new Error(kpisRes.error.message);

      if (kpisRes.data)    setKpis(kpisRes.data as any);
      if (ingestRes.data)  setIngest(ingestRes.data as any);
      if (threatsRes.data) setThreats(threatsRes.data as any);
      if (suspRes.data)    setSuspIPs(suspRes.data as any);
      if (topRes.data)     setTopServers(topRes.data as any);
      if (runsRes.data)    setIngestRuns(runsRes.data as any);
      setLastRefresh(new Date());
    } catch (error: any) {
      setAdminError(error.message ?? 'Could not load admin dashboard');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, supabase]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    if (!isAdmin) return;
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [isAdmin, load]);

  // ── Trigger ingest ─────────────────────────────────────────────────────────
  const [ingesting, setIngesting] = useState(false);
  async function triggerIngest(source: string) {
    setIngesting(true);
    setIngestFeedback(null);
    try {
      // Admin ingest triggers through a dedicated admin API route
      // that validates the user's session server-side — no secrets in client bundle
      const res = await fetch('/api/admin/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error ?? 'Failed to trigger ingest');
      }
      setIngestFeedback({
        tone: 'success',
        message: json.message ?? `Ingest completed for ${source}.`,
      });
      await load();
    } catch (error: any) {
      setIngestFeedback({
        tone: 'error',
        message: error.message ?? 'Failed to trigger ingest',
      });
    } finally {
      setIngesting(false);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  const fmt  = (n: number) => n?.toLocaleString() ?? '—';
  const pct  = (n: number) => `${(n ?? 0).toFixed(1)}%`;
  const ago  = (s: string) => {
    if (!s) return '—';
    const d = Math.floor((Date.now() - new Date(s).getTime()) / 60000);
    return d < 60 ? `${d}m ago` : d < 1440 ? `${Math.floor(d/60)}h ago` : `${Math.floor(d/1440)}d ago`;
  };

  const C = {
    red: '#dc2626', orange: '#d97706', green: '#16a34a',
    blue: '#2563eb', purple: '#7c3aed', grey: '#6b7280',
  };

  function Stat({ label, value, color = 'var(--text)', sub }: any) {
    return (
      <div style={{ padding: '16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>
        <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px' }}>{label}</div>
        <div style={{ fontSize: '26px', fontWeight: 700, color, fontFamily: 'var(--mono)', lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '4px' }}>{sub}</div>}
      </div>
    );
  }

  function TH({ children }: any) {
    return <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: '11px', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--border)', background: 'var(--bg-1)', whiteSpace: 'nowrap' }}>{children}</th>;
  }
  function TD({ children, mono, color }: any) {
    return <td style={{ padding: '9px 12px', fontSize: '13px', fontFamily: mono ? 'var(--mono)' : 'var(--font)', color: color ?? 'var(--text-2)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{children ?? '—'}</td>;
  }

  const pagedIngestRuns = useMemo(
    () => paginateItems(ingestRuns, tablePages.ingestRuns, tablePageSize),
    [ingestRuns, tablePages.ingestRuns, tablePageSize]
  );
  const pagedThreats = useMemo(
    () => paginateItems(threats, tablePages.threats, tablePageSize),
    [threats, tablePages.threats, tablePageSize]
  );
  const pagedTopServers = useMemo(
    () => paginateItems(topServers, tablePages.topServers, tablePageSize),
    [topServers, tablePages.topServers, tablePageSize]
  );
  const pagedSuspIPs = useMemo(
    () => paginateItems(suspIPs, tablePages.suspIPs, tablePageSize),
    [suspIPs, tablePages.suspIPs, tablePageSize]
  );

  function setTablePage<K extends keyof typeof tablePages>(key: K, page: number) {
    setTablePages((current) => ({ ...current, [key]: page }));
  }

  if (authLoading) {
    return (
      <div style={{ display: 'flex', minHeight: '60vh', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)' }}>
        Loading admin access...
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ display: 'flex', minHeight: '60vh', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)' }}>
        Redirecting to login...
      </div>
    );
  }

  if (!adminUid) {
    return (
      <div style={{ padding: '48px 24px', maxWidth: '720px', margin: '0 auto' }}>
        <div style={{ padding: '24px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px' }}>
          <div style={{ fontSize: '11px', fontFamily: 'var(--mono)', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>admin</div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '10px' }}>Admin panel is not configured yet</h1>
          <p style={{ fontSize: '14px', color: 'var(--text-2)', lineHeight: 1.6, marginBottom: '18px' }}>
            Set <code>NEXT_PUBLIC_ADMIN_UID</code> to your Supabase Auth user ID, then restart the app.
          </p>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <Link href="/dashboard" className="btn btn-ghost btn-sm">Back to dashboard</Link>
            <Link href="/docs" className="btn btn-ghost btn-sm">Open docs</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: '48px 24px', maxWidth: '720px', margin: '0 auto' }}>
        <div style={{ padding: '24px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px' }}>
          <div style={{ fontSize: '11px', fontFamily: 'var(--mono)', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>admin</div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '10px' }}>Admin access required</h1>
          <p style={{ fontSize: '14px', color: 'var(--text-2)', lineHeight: 1.6, marginBottom: '18px' }}>
            This account is signed in, but it does not match the configured admin user.
          </p>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <Link href="/dashboard" className="btn btn-ghost btn-sm">Back to dashboard</Link>
            <button onClick={() => router.replace('/')} className="btn btn-ghost btn-sm">Go home</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '32px 48px', maxWidth: '1400px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '11px', fontFamily: 'var(--mono)', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>admin</div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '-0.02em' }}>Platform Dashboard</h1>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
            {mounted ? `Last refresh: ${lastRefresh.toLocaleTimeString()} · auto-refreshes every 60s` : 'Loading...'}
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
            table size
            <select
              className="input"
              style={{ width: 'auto', padding: '0.45rem 0.7rem', fontSize: '12px' }}
              value={String(tablePageSize)}
              onChange={(e) => {
                setTablePageSize(Number(e.target.value));
                setTablePages({ ingestRuns: 1, threats: 1, topServers: 1, suspIPs: 1 });
              }}
            >
              {ADMIN_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
          <button onClick={load} className="btn btn-ghost btn-sm" disabled={loading}>
            {loading ? '...' : '↺ Refresh'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '2px', borderBottom: '1px solid var(--border)', marginBottom: '28px' }}>
        {(['overview','ingest','security','servers','threats'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '9px 18px', background: 'none', border: 'none', cursor: 'pointer',
            borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom: '-1px', fontSize: '13px', fontWeight: tab === t ? 600 : 400,
            color: tab === t ? 'var(--text)' : 'var(--text-3)', textTransform: 'capitalize',
          }}>{t}</button>
        ))}
      </div>

      {loading && !kpis && (
        <div style={{ textAlign: 'center', padding: '80px', color: 'var(--text-3)' }}>Loading...</div>
      )}

      {adminError && (
        <div style={{ marginBottom: '20px', padding: '14px 16px', background: '#2b1111', border: '1px solid #7f1d1d', borderRadius: '10px', color: '#fca5a5', fontSize: '13px' }}>
          {adminError}
        </div>
      )}

      {/* ── OVERVIEW ─────────────────────────────────────────────────────────── */}
      {tab === 'overview' && kpis && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
            <Stat label="Active Servers"  value={fmt(kpis.active_servers)}  color={C.green} sub={`${fmt(kpis.verified_servers)} verified`} />
            <Stat label="Calls (24h)"     value={fmt(kpis.calls_24h)}       color={C.blue}  sub={`${fmt(kpis.calls_7d)} this week`} />
            <Stat label="DLP Triggers 7d" value={fmt(kpis.dlp_triggers_7d)} color={kpis.dlp_triggers_7d > 100 ? C.red : C.orange} sub="credential or injection patterns" />
            <Stat label="Avg Trust Score" value={`${kpis.avg_trust_score ?? 0}`} color={C.purple} sub="platform average" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
            <Stat label="Scan Failures" value={fmt(kpis.scan_failures)}      color={kpis.scan_failures > 50 ? C.red : C.grey} />
            <Stat label="CVE Servers"   value={fmt(kpis.servers_with_cves)}  color={kpis.servers_with_cves > 10 ? C.orange : C.grey} />
            <Stat label="Total Users"   value={fmt(kpis.total_users)}        />
            <Stat label="Last Ingest"   value={ago(kpis.last_ingest_at)}     color={C.green} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
            {[
              { label: 'Official',  n: kpis.official_servers,  color: C.green  },
              { label: 'Smithery',  n: kpis.smithery_servers,  color: C.blue   },
              { label: 'Glama',     n: kpis.glama_servers,     color: C.purple },
              { label: 'GitHub',    n: kpis.github_servers,    color: C.grey   },
              { label: 'Direct',    n: kpis.direct_servers,    color: C.orange },
            ].map(s => (
              <div key={s.label} style={{ padding: '12px 14px', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: '8px', textAlign: 'center' }}>
                <div style={{ fontSize: '20px', fontWeight: 700, color: s.color, fontFamily: 'var(--mono)' }}>{fmt(s.n)}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── INGEST ───────────────────────────────────────────────────────────── */}
      {tab === 'ingest' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {ingestFeedback && (
            <div style={{
              padding: '12px 14px',
              background: ingestFeedback.tone === 'success' ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${ingestFeedback.tone === 'success' ? '#86efac' : '#fecaca'}`,
              borderRadius: '10px',
              fontSize: '13px',
              color: ingestFeedback.tone === 'success' ? C.green : C.red,
            }}>
              {ingestFeedback.message}
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-2)', marginRight: '4px' }}>Trigger ingest:</span>
            {['all','official','smithery','glama','pulsemcp','github'].map(src => (
              <button key={src} onClick={() => triggerIngest(src)}
                disabled={ingesting} className="btn btn-ghost btn-sm"
                style={{ fontFamily: 'var(--mono)' }}>
                {ingesting ? '...' : src}
              </button>
            ))}
          </div>

          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Source quality</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
              <thead><tr>
                <TH>Source</TH><TH>Total</TH><TH>Active</TH><TH>Rejected</TH>
                <TH>Scan Pass</TH><TH>CVE Issues</TH><TH>Avg Trust</TH><TH>Rejection %</TH>
              </tr></thead>
              <tbody>
                {ingest.map(row => (
                  <tr key={row.source}>
                    <TD mono color={C.blue}>{row.source}</TD>
                    <TD>{fmt(row.total_servers)}</TD>
                    <TD color={C.green}>{fmt(row.active_servers)}</TD>
                    <TD color={row.rejected_servers > 0 ? C.red : undefined}>{fmt(row.rejected_servers)}</TD>
                    <TD color={C.green}>{fmt(row.scan_passed)}</TD>
                    <TD color={row.has_cve_issues > 0 ? C.orange : undefined}>{fmt(row.has_cve_issues)}</TD>
                    <TD color={C.purple}>{row.avg_trust_score}</TD>
                    <TD color={row.rejection_rate_pct > 10 ? C.red : undefined}>{pct(row.rejection_rate_pct)}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Recent ingest runs</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
              <thead><tr>
                <TH>Source</TH><TH>Started</TH><TH>Duration</TH>
                <TH>Found</TH><TH>Added</TH><TH>Rejected</TH>
              </tr></thead>
              <tbody>
                {pagedIngestRuns.items.map(run => {
                  const dur = run.finished_at
                    ? `${Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s`
                    : 'running...';
                  return (
                    <tr key={run.id}>
                      <TD mono color={C.blue}>{run.source}</TD>
                      <TD>{ago(run.started_at)}</TD>
                      <TD mono>{dur}</TD>
                      <TD>{fmt(run.servers_found)}</TD>
                      <TD color={C.green}>{fmt(run.servers_added)}</TD>
                      <TD color={run.servers_rejected > 0 ? C.red : undefined}>{fmt(run.servers_rejected)}</TD>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <PaginationControls
              className="mt-4"
              page={pagedIngestRuns.page}
              pages={pagedIngestRuns.pages}
              from={pagedIngestRuns.from}
              to={pagedIngestRuns.to}
              total={pagedIngestRuns.total}
              pageSize={pagedIngestRuns.pageSize}
              onPageChange={(nextPage) => setTablePage('ingestRuns', nextPage)}
            />
          </div>
        </div>
      )}

      {/* ── SECURITY ─────────────────────────────────────────────────────────── */}
      {tab === 'security' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Security events — last 14 days</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
              <thead><tr>
                <TH>Date</TH><TH>Total Calls</TH><TH>Unique IPs</TH>
                <TH>DLP Triggers</TH><TH>Blocked</TH><TH>Rate Limited</TH>
                <TH>Errors</TH><TH>DLP Rate</TH><TH>Avg Latency</TH>
              </tr></thead>
              <tbody>
                {pagedThreats.items.map(row => (
                  <tr key={row.day}>
                    <TD mono>{row.day?.slice(0,10)}</TD>
                    <TD>{fmt(row.total_calls)}</TD>
                    <TD>{fmt(row.unique_ips)}</TD>
                    <TD color={row.dlp_triggers > 10 ? C.red : undefined}>{fmt(row.dlp_triggers)}</TD>
                    <TD color={row.blocked_calls > 0 ? C.orange : undefined}>{fmt(row.blocked_calls)}</TD>
                    <TD color={row.rate_limited > 0 ? C.orange : undefined}>{fmt(row.rate_limited)}</TD>
                    <TD color={row.errors > 0 ? C.red : undefined}>{fmt(row.errors)}</TD>
                    <TD color={row.dlp_rate_pct > 5 ? C.red : undefined}>{pct(row.dlp_rate_pct)}</TD>
                    <TD mono>{row.avg_latency_ms}ms</TD>
                  </tr>
                ))}
              </tbody>
            </table>
            <PaginationControls
              className="mt-4"
              page={pagedThreats.page}
              pages={pagedThreats.pages}
              from={pagedThreats.from}
              to={pagedThreats.to}
              total={pagedThreats.total}
              pageSize={pagedThreats.pageSize}
              onPageChange={(nextPage) => setTablePage('threats', nextPage)}
            />
          </div>
        </div>
      )}

      {/* ── TOP SERVERS ──────────────────────────────────────────────────────── */}
      {tab === 'servers' && (
        <div>
          <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Top servers by usage (30d)</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
            <thead><tr>
              <TH>Server</TH><TH>Source</TH><TH>Trust</TH>
              <TH>Calls 30d</TH><TH>Error Rate</TH><TH>DLP Triggers</TH>
            </tr></thead>
            <tbody>
              {pagedTopServers.items.map(row => (
                <tr key={row.name}>
                  <TD mono color={C.blue}>{row.name}</TD>
                  <TD>{row.source}</TD>
                  <TD color={row.trust_score >= 85 ? C.green : row.trust_score >= 70 ? C.orange : C.red}>
                    {row.trust_score}
                  </TD>
                  <TD>{fmt(row.calls_30d)}</TD>
                  <TD color={row.error_rate_pct > 5 ? C.red : undefined}>{pct(row.error_rate_pct)}</TD>
                  <TD color={row.dlp_triggers_30d > 0 ? C.orange : undefined}>{fmt(row.dlp_triggers_30d)}</TD>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationControls
            className="mt-4"
            page={pagedTopServers.page}
            pages={pagedTopServers.pages}
            from={pagedTopServers.from}
            to={pagedTopServers.to}
            total={pagedTopServers.total}
            pageSize={pagedTopServers.pageSize}
            onPageChange={(nextPage) => setTablePage('topServers', nextPage)}
          />
        </div>
      )}

      {/* ── THREATS ──────────────────────────────────────────────────────────── */}
      {tab === 'threats' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ padding: '14px 18px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', fontSize: '13px', color: C.red }}>
            These IPs showed suspicious behaviour in the last hour. To block: Vercel Dashboard → Security → IP Blocking.
          </div>

          {suspIPs.length === 0
            ? <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-3)' }}>No suspicious IPs detected in the last hour.</div>
            : (
              <div>
                <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <thead><tr>
                    <TH>IP</TH><TH>Calls/h</TH><TH>DLP Hits</TH><TH>Blocked</TH>
                    <TH>Servers Hit</TH><TH>Risk Score</TH><TH>Last Seen</TH>
                  </tr></thead>
                  <tbody>
                    {pagedSuspIPs.items.map(row => (
                      <tr key={row.ip}>
                        <TD mono color={C.red}>{row.ip}</TD>
                        <TD>{fmt(row.calls_1h)}</TD>
                        <TD color={row.dlp_triggers > 0 ? C.red : undefined}>{fmt(row.dlp_triggers)}</TD>
                        <TD color={row.blocked_calls > 0 ? C.orange : undefined}>{fmt(row.blocked_calls)}</TD>
                        <TD>{fmt(row.servers_hit)}</TD>
                        <TD color={row.risk_score > 100 ? C.red : row.risk_score > 50 ? C.orange : C.grey}>
                          {row.risk_score}
                        </TD>
                        <TD>{ago(row.last_seen)}</TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <PaginationControls
                  className="mt-4"
                  page={pagedSuspIPs.page}
                  pages={pagedSuspIPs.pages}
                  from={pagedSuspIPs.from}
                  to={pagedSuspIPs.to}
                  total={pagedSuspIPs.total}
                  pageSize={pagedSuspIPs.pageSize}
                  onPageChange={(nextPage) => setTablePage('suspIPs', nextPage)}
                />
              </div>
            )
          }
        </div>
      )}
    </div>
  );
}
