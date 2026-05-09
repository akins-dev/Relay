'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { PaginationControls } from '@/components/ui/pagination-controls';
import { paginateItems } from '@/lib/pagination';
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// ── Inline editable rate limit row ───────────────────────────────────────────
function RateLimitRow({ row, saving, onSave }: {
  row: any;
  saving: boolean;
  onSave: (context: string, limit: number, window: number) => void;
}) {
  const [limit,  setLimit]  = useState(String(row.limit_count));
  const [window, setWindow] = useState(String(row.window_ms));
  const dirty = limit !== String(row.limit_count) || window !== String(row.window_ms);
  return (
    <tr>
      <td style={{ padding: '8px 12px', fontSize: '12px', fontFamily: 'var(--mono)', color: '#2563eb', borderBottom: '1px solid var(--border)' }}>{row.context}</td>
      <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <input
          type="number" value={limit} onChange={e => setLimit(e.target.value)}
          style={{ width: '70px', padding: '4px 6px', fontSize: '12px', fontFamily: 'var(--mono)', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)' }}
        />
      </td>
      <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <input
          type="number" value={window} onChange={e => setWindow(e.target.value)}
          style={{ width: '90px', padding: '4px 6px', fontSize: '12px', fontFamily: 'var(--mono)', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)' }}
        />
      </td>
      <td style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>{row.note ?? '—'}</td>
      <td style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>{row.updated_at ? new Date(row.updated_at).toLocaleString() : '—'}</td>
      <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        {dirty && (
          <button
            onClick={() => onSave(row.context, Number(limit), Number(window))}
            disabled={saving}
            style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600, background: saving ? 'var(--bg-1)' : '#2563eb', color: saving ? 'var(--text-3)' : '#fff', border: 'none', borderRadius: '6px', cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </td>
    </tr>
  );
}


// This is used to show/hide the admin link in the UI. It has NO security impact —
// actual API authorization uses the server-only ADMIN_API_TOKEN via safeCompare.
// Get your UID from Supabase → Authentication → Users → your row → User UID
const ADMIN_UID = process.env.NEXT_PUBLIC_ADMIN_UID ?? '';

// ── Types ─────────────────────────────────────────────────────────────────────
interface PlatformKPIs {
  total_servers: number; active_servers: number; verified_servers: number;
  official_servers: number; smithery_servers: number; glama_servers: number;
  github_servers: number; direct_servers: number;
  scan_failures: number; servers_with_cves: number; avg_trust_score: number;
  no_tool_metadata_servers: number; weak_stdio_rows: number;
  calls_24h: number; calls_7d: number; calls_30d: number; dlp_triggers_7d: number;
  total_users: number; active_api_keys: number;
  total_ingest_runs: number; last_ingest_at: string;
}
interface IngestQuality {
  source: string; total_servers: number; active_servers: number;
  rejected_servers: number; scan_passed: number; has_cve_issues: number;
  probe_backed: number; sandbox_backed: number; readme_backed: number;
  no_tool_metadata: number; weak_stdio_rows: number;
  avg_trust_score: number; rejection_rate_pct: number;
}
interface IngestProvenanceQuality {
  source: string; tool_extraction_source: string; server_count: number;
  stdio_count: number; active_count: number; avg_trust_score: number;
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
interface CronJobRun {
  id: string; job_name: string; started_at: string; finished_at: string;
  status: string; result: any; error: string | null; duration_seconds: number;
}
interface CronHistoryRun extends CronJobRun {
  created_at?: string;
}
interface DriftEvent {
  name: string; display_name: string; source: string; status: string;
  trust_score: number; drifted_at: string; issues: any; details: string;
}
interface UptimeIssue {
  name: string; display_name: string; source: string; endpoint: string;
  transport: string; uptime_pct: number; latency_ms: number;
  trust_score: number; mcp_compliant: boolean; last_scanned_at: string;
}
interface SuspendedServer {
  id: string; name: string; display_name: string; source: string; status: string;
  trust_score: number; scan_issues: any; last_scanned_at: string; updated_at: string;
  tool_extraction_source: string; transport: string;
}
interface ReleaseGate {
  name: string;
  state: 'pass' | 'fail' | 'warn';
  value: string;
  rule: string;
  notes: string | null;
}
interface ReleaseReport {
  generated_at: string;
  release: 'go' | 'no-go';
  blocking_failures: ReleaseGate[];
  gates: ReleaseGate[];
}

type Tab = 'overview' | 'ingest' | 'security' | 'servers' | 'threats' | 'operations' | 'analytics' | 'release' | 'config';
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
  const [ingestProvenance, setIngestProvenance] = useState<IngestProvenanceQuality[]>([]);
  const [threats,    setThreats]    = useState<SecurityThreat[]>([]);
  const [suspIPs,    setSuspIPs]    = useState<SuspiciousIP[]>([]);
  const [topServers, setTopServers] = useState<TopServer[]>([]);
  const [ingestRuns, setIngestRuns] = useState<IngestRun[]>([]);
  const [cronJobs,   setCronJobs]   = useState<CronJobRun[]>([]);
  const [cronHistory,setCronHistory]= useState<CronHistoryRun[]>([]);
  const [driftEvents,setDriftEvents]= useState<DriftEvent[]>([]);
  const [uptimeIssues,setUptimeIssues]= useState<UptimeIssue[]>([]);
  const [suspendedServers,setSuspendedServers]= useState<SuspendedServer[]>([]);
  // Analytics intelligence data (Migration 022)
  const [topIntents,       setTopIntents]       = useState<any[]>([]);
  const [ecosystemGaps,    setEcosystemGaps]    = useState<any[]>([]);
  const [searchQuality,    setSearchQuality]    = useState<any[]>([]);
  const [serverReliability,setServerReliability]= useState<any[]>([]);
  // Rate limit config
  const [rateLimits,       setRateLimits]       = useState<any[]>([]);
  const [releaseReport,    setReleaseReport]    = useState<ReleaseReport | null>(null);
  const [rlSaving,         setRlSaving]         = useState<string | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [lastRefresh,setLastRefresh]= useState<Date>(new Date());
  const [ingestFeedback, setIngestFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [opsFeedback, setOpsFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [runningCron, setRunningCron] = useState<string | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [tablePageSize, setTablePageSize] = useState(8);
  const [tablePages, setTablePages] = useState({
    ingestRuns: 1,
    threats: 1,
    topServers: 1,
    suspIPs: 1,
    cronHistory: 1,
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
      const [kpisRes, ingestRes, ingestProvRes, threatsRes, suspRes, topRes, runsRes, cronRes, driftRes, uptimeRes, intentRes, gapsRes, sqRes, srRes, rlRes] = await Promise.all([
        svc.from('platform_kpis').select('*').single(),
        svc.from('ingest_quality').select('*'),
        svc.from('ingest_provenance_quality').select('*'),
        svc.from('security_threats').select('*').limit(30),
        svc.from('suspicious_ips').select('*').limit(100),
        svc.from('top_servers_by_usage').select('*').limit(100),
        svc.from('ingest_runs').select('*').order('started_at', { ascending: false }).limit(100),
        svc.from('cron_job_health').select('*'),
        svc.from('drift_events').select('*').limit(50),
        svc.from('uptime_issues').select('*').limit(50),
        // Analytics (Migration 022)
        svc.from('top_intents').select('*').limit(50),
        svc.from('ecosystem_gaps').select('*').limit(50),
        svc.from('search_quality_daily').select('*').limit(30),
        svc.from('server_reliability').select('*').limit(50),
        // Rate limit config (Migration 023)
        svc.from('rate_limit_config').select('*').order('context'),
      ]) as any[];

      if (kpisRes.error) throw new Error(kpisRes.error.message);

      if (kpisRes.data)    setKpis(kpisRes.data as any);
      if (ingestRes.data)  setIngest(ingestRes.data as any);
      if (ingestProvRes.data) setIngestProvenance(ingestProvRes.data as any);
      if (threatsRes.data) setThreats(threatsRes.data as any);
      if (suspRes.data)    setSuspIPs(suspRes.data as any);
      if (topRes.data)     setTopServers(topRes.data as any);
      if (runsRes.data)    setIngestRuns(runsRes.data as any);
      if (cronRes?.data)   setCronJobs(cronRes.data as any);
      if (driftRes?.data)  setDriftEvents(driftRes.data as any);
      if (uptimeRes?.data) setUptimeIssues(uptimeRes.data as any);
      if (intentRes?.data) setTopIntents(intentRes.data as any);
      if (gapsRes?.data)   setEcosystemGaps(gapsRes.data as any);
      if (sqRes?.data)     setSearchQuality(sqRes.data as any);
      if (srRes?.data)     setServerReliability(srRes.data as any);
      if (rlRes?.data)     setRateLimits(rlRes.data as any);
      const [releaseRes, opsRes] = await Promise.all([
        fetch('/api/admin/release-report').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/admin/operations').then((r) => (r.ok ? r.json() : null)),
      ])
        .catch(() => [null, null]);
      if (releaseRes) setReleaseReport(releaseRes as ReleaseReport);
      if (opsRes) {
        if (opsRes.cron_history) setCronHistory(opsRes.cron_history as CronHistoryRun[]);
        if (opsRes.drift_events) setDriftEvents(opsRes.drift_events as DriftEvent[]);
        if (opsRes.uptime_issues) setUptimeIssues(opsRes.uptime_issues as UptimeIssue[]);
        if (opsRes.suspended_servers) setSuspendedServers(opsRes.suspended_servers as SuspendedServer[]);
      }
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

  // ── Save rate limit config ─────────────────────────────────────────────────
  async function saveRateLimit(context: string, limitCount: number, windowMs: number) {
    setRlSaving(context);
    try {
      const result = await (supabase
        .from('rate_limit_config') as any)
        .update({ limit_count: limitCount, window_ms: windowMs, updated_at: new Date().toISOString() })
        .eq('context', context);
      if (result.error) throw result.error;
      await load();
    } catch (e: any) {
      setAdminError(e.message);
    } finally {
      setRlSaving(null);
    }
  }

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

  async function triggerCron(job: 'uptime_check' | 'schema_drift' | 'reset_daily_calls') {
    setRunningCron(job);
    setOpsFeedback(null);
    try {
      const res = await fetch('/api/admin/cron/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Failed to run ${job}`);
      setOpsFeedback({
        tone: 'success',
        message: `${job} completed: ${JSON.stringify(json.result ?? {}).slice(0, 180)}`,
      });
      await load();
    } catch (error: any) {
      setOpsFeedback({
        tone: 'error',
        message: error.message ?? `Failed to run ${job}`,
      });
    } finally {
      setRunningCron(null);
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
  const formatIsoDate = (s?: string | null) => {
    if (!s) return '—';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleString();
  };
  const stringifyJson = (value: any, max = 1200) => {
    if (!value) return '—';
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return text.length > max ? `${text.slice(0, max)}\n... truncated` : text;
  };

  const C = {
    red: '#dc2626', orange: '#d97706', green: '#16a34a',
    blue: '#2563eb', purple: '#7c3aed', grey: '#6b7280',
  };

  function downloadTextFile(filename: string, text: string, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  const releaseMarkdown = useMemo(() => {
    if (!releaseReport) return '';
    const title = `Release Report — ${releaseReport.release.toUpperCase()}`;
    const generated = formatIsoDate(releaseReport.generated_at);

    const rows = (releaseReport.gates ?? []).map((g) => {
      const icon = g.state === 'pass' ? '✅' : g.state === 'warn' ? '⚠️' : '❌';
      const notes = (g.notes ?? '—').replace(/\n/g, ' ');
      const rule = (g.rule ?? '—').replace(/\n/g, ' ');
      const value = (g.value ?? '—').replace(/\n/g, ' ');
      return `| ${icon} ${g.name} | ${g.state} | ${value} | ${rule} | ${notes} |`;
    });

    const blocking = (releaseReport.blocking_failures ?? []).map((g) => `- **${g.name}**: ${g.value} (${g.rule})${g.notes ? ` — ${g.notes}` : ''}`);

    return [
      `# ${title}`,
      ``,
      `- **Decision**: ${releaseReport.release.toUpperCase()}`,
      `- **Generated**: ${generated}`,
      ``,
      `## Blocking failures`,
      blocking.length ? blocking.join('\n') : `- None`,
      ``,
      `## Gates`,
      `| Gate | Status | Value | Rule | Notes |`,
      `|---|---|---|---|---|`,
      ...rows,
      ``,
      `## Sprint review notes (template)`,
      ``,
      `### Highlights`,
      `- `,
      ``,
      `### Risks / follow-ups`,
      `- `,
      ``,
      `### Decisions`,
      `- `,
      ``,
      `### Next week focus`,
      `- `,
      ``,
    ].join('\n');
  }, [releaseReport]);

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

  function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'danger' | 'success'; title: string; children: any }) {
    const t = tone === 'success'
      ? { bg: '#f0fdf4', border: '#86efac', text: C.green }
      : tone === 'warn'
        ? { bg: '#fffbeb', border: '#fde68a', text: '#92400e' }
        : tone === 'danger'
          ? { bg: '#fef2f2', border: '#fecaca', text: C.red }
          : { bg: 'var(--bg-1)', border: 'var(--border)', text: 'var(--text-2)' };
    return (
      <div style={{ padding: '14px 16px', borderRadius: '12px', background: t.bg, border: `1px solid ${t.border}` }}>
        <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '6px', color: t.text }}>{title}</div>
        <div style={{ fontSize: '13px', color: 'var(--text-2)', lineHeight: 1.55 }}>{children}</div>
      </div>
    );
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
  const pagedCronHistory = useMemo(
    () => paginateItems(cronHistory, tablePages.cronHistory, tablePageSize),
    [cronHistory, tablePages.cronHistory, tablePageSize]
  );

  const sourceQualityChart = useMemo(() => ingest.map((row) => ({
    source: row.source,
    active: row.active_servers,
    noTools: row.no_tool_metadata,
    rejected: row.rejected_servers,
  })), [ingest]);

  const cronChart = useMemo(() => cronHistory.slice(0, 30).reverse().map((run) => ({
    label: `${run.job_name.replace('_', ' ')} ${new Date(run.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
    duration: run.duration_seconds ?? (
      run.finished_at ? Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000) : 0
    ),
    errors: run.status === 'error' ? 1 : 0,
  })), [cronHistory]);

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
                setTablePages({ ingestRuns: 1, threats: 1, topServers: 1, suspIPs: 1, cronHistory: 1 });
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
      <div style={{ display: 'flex', gap: '2px', borderBottom: '1px solid var(--border)', marginBottom: '28px', overflowX: 'auto' }}>
        {(['overview','ingest','security','servers','threats','operations','analytics','release','config'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '9px 18px', background: 'none', border: 'none', cursor: 'pointer',
            borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom: '-1px', fontSize: '13px', fontWeight: tab === t ? 600 : 400,
            color: tab === t ? 'var(--text)' : 'var(--text-3)', textTransform: 'capitalize',
            whiteSpace: 'nowrap',
          }}>{t}</button>
        ))}
      </div>

      <div style={{ marginBottom: '20px' }}>
        <Callout title="Admin directions">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div>
              Use <b>Ingest</b> to refresh sources, <b>Operations</b> to spot uptime/schema drift, and <b>Release</b> to export a release decision packet for sprint review.
            </div>
            <div style={{ color: 'var(--text-3)', fontSize: '12px' }}>
              Tip: this page auto-refreshes every 60 seconds; use “↺ Refresh” after triggering ingest.
            </div>
          </div>
        </Callout>
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
            <Stat label="Weak Stdio"    value={fmt(kpis.weak_stdio_rows)} color={kpis.weak_stdio_rows > 0 ? C.orange : C.green} sub="readme/none-backed stdio rows" />
            <Stat label="No Tool Data"  value={fmt(kpis.no_tool_metadata_servers)} color={kpis.no_tool_metadata_servers > 0 ? C.orange : C.green} sub="servers with zero persisted tool metadata" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
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
            {['all','official','smithery','glama','mcp_directory'].map(src => (
              <button key={src} onClick={() => triggerIngest(src)}
                disabled={ingesting} className="btn btn-ghost btn-sm"
                style={{ fontFamily: 'var(--mono)' }}>
                {ingesting ? '...' : src}
              </button>
            ))}
          </div>

          <Callout title="What verified and no-tool rows mean" tone={kpis?.no_tool_metadata_servers ? 'warn' : 'info'}>
            <div>
              <b>Verified</b> is upstream reputation metadata, not proof that Relay can invoke the server. For an invokable MVP row, the important fields are endpoint or stdio package metadata, non-empty tools, scan pass, and a stable schema hash.
              <b> No Tool Data</b> means the registry row has no persisted tool names/schemas, so it should be treated as discovery-incomplete until upstream detail or README extraction succeeds.
            </div>
          </Callout>

          {sourceQualityChart.length > 0 && (
            <div style={{ padding: '18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Source quality mix</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={sourceQualityChart} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  <XAxis dataKey="source" tick={{ fontSize: 11, fill: 'var(--text-3)', fontFamily: 'var(--mono)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)', fontFamily: 'var(--mono)' }} />
                  <Tooltip contentStyle={{ background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: '8px', fontSize: '12px' }} />
                  <Bar dataKey="active" fill="#16a34a" name="Active" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="noTools" fill="#d97706" name="No tool metadata" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="rejected" fill="#dc2626" name="Rejected" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Source quality</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
              <thead><tr>
                <TH>Source</TH><TH>Total</TH><TH>Active</TH><TH>Rejected</TH>
                <TH>Scan Pass</TH><TH>CVE Issues</TH><TH>Probe</TH><TH>Sandbox</TH><TH>README</TH><TH>No Tools</TH><TH>Weak stdio</TH><TH>Avg Trust</TH><TH>Rejection %</TH>
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
                    <TD color={row.probe_backed > 0 ? C.green : undefined}>{fmt(row.probe_backed)}</TD>
                    <TD color={row.sandbox_backed > 0 ? C.blue : undefined}>{fmt(row.sandbox_backed)}</TD>
                    <TD color={row.readme_backed > 0 ? C.orange : undefined}>{fmt(row.readme_backed)}</TD>
                    <TD color={row.no_tool_metadata > 0 ? C.red : undefined}>{fmt(row.no_tool_metadata)}</TD>
                    <TD color={row.weak_stdio_rows > 0 ? C.orange : C.green}>{fmt(row.weak_stdio_rows)}</TD>
                    <TD color={C.purple}>{row.avg_trust_score}</TD>
                    <TD color={row.rejection_rate_pct > 10 ? C.red : undefined}>{pct(row.rejection_rate_pct)}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Extraction provenance</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
              <thead><tr>
                <TH>Source</TH><TH>Provenance</TH><TH>Servers</TH><TH>Stdio</TH><TH>Active</TH><TH>Avg Trust</TH>
              </tr></thead>
              <tbody>
                {ingestProvenance.map(row => (
                  <tr key={`${row.source}:${row.tool_extraction_source}`}>
                    <TD mono color={C.blue}>{row.source}</TD>
                    <TD mono color={row.tool_extraction_source === 'none' ? C.red : row.tool_extraction_source === 'readme' ? C.orange : C.green}>{row.tool_extraction_source}</TD>
                    <TD>{fmt(row.server_count)}</TD>
                    <TD color={row.stdio_count > 0 ? C.orange : undefined}>{fmt(row.stdio_count)}</TD>
                    <TD color={C.green}>{fmt(row.active_count)}</TD>
                    <TD color={C.purple}>{row.avg_trust_score}</TD>
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
                  <TD color={row.trust_score >= 85 ? C.green : row.trust_score >= 65 ? C.orange : C.red}>
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
      {/* ── OPERATIONS ────────────────────────────────────────────────────── */}
      {tab === 'operations' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {opsFeedback && (
            <div style={{
              padding: '12px 14px',
              background: opsFeedback.tone === 'success' ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${opsFeedback.tone === 'success' ? '#86efac' : '#fecaca'}`,
              borderRadius: '10px',
              fontSize: '13px',
              color: opsFeedback.tone === 'success' ? C.green : C.red,
            }}>
              {opsFeedback.message}
            </div>
          )}

          <Callout title="Operations model">
            <div>
              <b>Schema drift</b> re-probes active servers and hashes live tools plus version, endpoint, and GitHub URL. If that differs from the approved baseline, the server is suspended because its callable surface changed after approval.
              <b> Reset daily calls</b> only resets the denormalized <code>calls_today</code> counter on servers; historical metering events remain available for charts and analysis.
            </div>
          </Callout>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-2)', marginRight: '4px' }}>Run job now:</span>
            {[
              { key: 'uptime_check', label: 'uptime check' },
              { key: 'schema_drift', label: 'schema drift' },
              { key: 'reset_daily_calls', label: 'reset daily calls' },
            ].map((job) => (
              <button
                key={job.key}
                onClick={() => triggerCron(job.key as 'uptime_check' | 'schema_drift' | 'reset_daily_calls')}
                disabled={Boolean(runningCron)}
                className="btn btn-ghost btn-sm"
                style={{ fontFamily: 'var(--mono)' }}
              >
                {runningCron === job.key ? 'running...' : job.label}
              </button>
            ))}
          </div>

          {cronChart.length > 0 && (
            <div style={{ padding: '18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Cron duration history</h3>
              <ResponsiveContainer width="100%" height={190}>
                <AreaChart data={cronChart} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <XAxis dataKey="label" hide />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)', fontFamily: 'var(--mono)' }} />
                  <Tooltip contentStyle={{ background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: '8px', fontSize: '12px' }} />
                  <Area type="monotone" dataKey="duration" stroke="#2563eb" fill="#2563eb" fillOpacity={0.12} strokeWidth={1.5} name="Duration seconds" dot={false} />
                  <Area type="stepAfter" dataKey="errors" stroke="#dc2626" fill="#dc2626" fillOpacity={0.08} strokeWidth={1.2} name="Error runs" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          {/* Cron Job Health */}
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Background Job Health</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
              <thead><tr>
                <TH>Job</TH><TH>Last Run</TH><TH>Status</TH><TH>Duration</TH><TH>Result</TH>
              </tr></thead>
              <tbody>
                {(cronJobs.length > 0 ? cronJobs : [
                  { id: '-', job_name: 'uptime_check', started_at: '', finished_at: '', status: 'no data', result: null, error: null, duration_seconds: 0 },
                  { id: '-', job_name: 'schema_drift', started_at: '', finished_at: '', status: 'no data', result: null, error: null, duration_seconds: 0 },
                  { id: '-', job_name: 'reset_daily_calls', started_at: '', finished_at: '', status: 'no data', result: null, error: null, duration_seconds: 0 },
                  { id: '-', job_name: 'ingest', started_at: '', finished_at: '', status: 'no data', result: null, error: null, duration_seconds: 0 },
                ]).map(job => (
                  <tr key={job.job_name}>
                    <TD mono color={C.blue}>{job.job_name}</TD>
                    <TD>{job.started_at ? ago(job.started_at) : '—'}</TD>
                    <TD color={job.status === 'success' ? C.green : job.status === 'error' ? C.red : job.status === 'running' ? C.orange : C.grey}>
                      {job.status === 'success' ? '✓ success' : job.status === 'error' ? '✗ error' : job.status === 'running' ? '⟳ running' : job.status}
                    </TD>
                    <TD mono>{job.duration_seconds ? `${job.duration_seconds}s` : '—'}</TD>
                    <TD>
                      <details>
                        <summary style={{ cursor: 'pointer', color: job.error ? C.red : C.blue }}>
                          {job.error ? 'error details' : job.result ? 'view result' : '—'}
                        </summary>
                        <pre style={{ whiteSpace: 'pre-wrap', maxWidth: '520px', maxHeight: '220px', overflow: 'auto', marginTop: '8px', fontSize: '11px', lineHeight: 1.5, color: 'var(--text-2)' }}>
                          {job.error ?? stringifyJson(job.result)}
                        </pre>
                      </details>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Cron run history</h3>
            {cronHistory.length === 0
              ? <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-3)', background: 'var(--surface)', borderRadius: '10px', border: '1px solid var(--border)' }}>No cron history yet. Run a job above or wait for scheduled cron.</div>
              : (
                <>
                  <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                    <thead><tr>
                      <TH>Job</TH><TH>Started</TH><TH>Status</TH><TH>Duration</TH><TH>Result / Error</TH>
                    </tr></thead>
                    <tbody>
                      {pagedCronHistory.items.map((run) => (
                        <tr key={run.id}>
                          <TD mono color={C.blue}>{run.job_name}</TD>
                          <TD>{formatIsoDate(run.started_at)}</TD>
                          <TD color={run.status === 'success' ? C.green : run.status === 'error' ? C.red : C.orange}>{run.status}</TD>
                          <TD mono>{run.duration_seconds ? `${run.duration_seconds}s` : run.finished_at ? `${Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s` : 'running'}</TD>
                          <TD>
                            <details>
                              <summary style={{ cursor: 'pointer', color: run.error ? C.red : C.blue }}>
                                {run.error ? 'show error' : 'show result'}
                              </summary>
                              <pre style={{ whiteSpace: 'pre-wrap', maxWidth: '620px', maxHeight: '260px', overflow: 'auto', marginTop: '8px', fontSize: '11px', lineHeight: 1.5, color: 'var(--text-2)' }}>
                                {run.error ?? stringifyJson(run.result)}
                              </pre>
                            </details>
                          </TD>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <PaginationControls
                    className="mt-4"
                    page={pagedCronHistory.page}
                    pages={pagedCronHistory.pages}
                    from={pagedCronHistory.from}
                    to={pagedCronHistory.to}
                    total={pagedCronHistory.total}
                    pageSize={pagedCronHistory.pageSize}
                    onPageChange={(nextPage) => setTablePage('cronHistory', nextPage)}
                  />
                </>
              )
            }
          </div>

          {/* Schema Drift Events */}
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Schema Drift Events <span style={{ fontSize: '11px', color: 'var(--text-3)', fontWeight: 400 }}>(tools changed post-approval → suspended)</span></h3>
            {driftEvents.length === 0
              ? <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-3)', background: 'var(--surface)', borderRadius: '10px', border: '1px solid var(--border)' }}>No schema drift events detected. All servers are stable.</div>
              : (
                <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <thead><tr>
                    <TH>Server</TH><TH>Source</TH><TH>Drifted</TH><TH>Status</TH><TH>Details</TH>
                  </tr></thead>
                  <tbody>
                    {driftEvents.map(ev => (
                      <tr key={ev.name + ev.drifted_at}>
                        <TD mono color={C.red}>{ev.name}</TD>
                        <TD>{ev.source}</TD>
                        <TD>{ago(ev.drifted_at)}</TD>
                        <TD color={ev.status === 'suspended' ? C.red : C.orange}>{ev.status}</TD>
                        <TD>
                          <details>
                            <summary style={{ cursor: 'pointer', color: C.blue }}>{ev.details?.slice(0, 90) ?? 'view evidence'}</summary>
                            <pre style={{ whiteSpace: 'pre-wrap', maxWidth: '620px', maxHeight: '260px', overflow: 'auto', marginTop: '8px', fontSize: '11px', lineHeight: 1.5, color: 'var(--text-2)' }}>
                              {stringifyJson({ details: ev.details, issues: ev.issues })}
                            </pre>
                          </details>
                        </TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </div>

          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Suspended servers</h3>
            {suspendedServers.length === 0
              ? <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-3)', background: 'var(--surface)', borderRadius: '10px', border: '1px solid var(--border)' }}>No suspended servers.</div>
              : (
                <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <thead><tr>
                    <TH>Server</TH><TH>Source</TH><TH>Trust</TH><TH>Extraction</TH><TH>Updated</TH><TH>Reason</TH>
                  </tr></thead>
                  <tbody>
                    {suspendedServers.map((server) => (
                      <tr key={server.id}>
                        <TD mono color={C.red}>
                          <Link href={`/registry/${server.name}`} style={{ color: C.red, textDecoration: 'none' }}>{server.name}</Link>
                        </TD>
                        <TD>{server.source}</TD>
                        <TD>{server.trust_score ?? '—'}</TD>
                        <TD mono>{server.transport}/{server.tool_extraction_source}</TD>
                        <TD>{server.updated_at ? ago(server.updated_at) : '—'}</TD>
                        <TD>
                          <details>
                            <summary style={{ cursor: 'pointer', color: C.blue }}>show reason</summary>
                            <pre style={{ whiteSpace: 'pre-wrap', maxWidth: '620px', maxHeight: '260px', overflow: 'auto', marginTop: '8px', fontSize: '11px', lineHeight: 1.5, color: 'var(--text-2)' }}>
                              {stringifyJson(server.scan_issues)}
                            </pre>
                          </details>
                        </TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </div>

          {/* Uptime Issues */}
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Uptime Issues <span style={{ fontSize: '11px', color: 'var(--text-3)', fontWeight: 400 }}>(&lt;95% uptime or &gt;5s latency)</span></h3>
            {uptimeIssues.length === 0
              ? <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-3)', background: 'var(--surface)', borderRadius: '10px', border: '1px solid var(--border)' }}>All active servers meet uptime and latency thresholds.</div>
              : (
                <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <thead><tr>
                    <TH>Server</TH><TH>Source</TH><TH>Transport</TH><TH>Uptime</TH><TH>Latency</TH><TH>Trust</TH><TH>Last Scan</TH>
                  </tr></thead>
                  <tbody>
                    {uptimeIssues.slice(0, tablePageSize).map(s => (
                      <tr key={s.name}>
                        <TD mono color={C.blue}>{s.name}</TD>
                        <TD>{s.source}</TD>
                        <TD>{s.transport}</TD>
                        <TD color={s.uptime_pct < 90 ? C.red : C.orange}>{s.uptime_pct != null ? `${Number(s.uptime_pct).toFixed(1)}%` : '—'}</TD>
                        <TD color={s.latency_ms > 5000 ? C.red : undefined}>{s.latency_ms ? `${s.latency_ms}ms` : '—'}</TD>
                        <TD>{s.trust_score ?? '—'}</TD>
                        <TD>{s.last_scanned_at ? ago(s.last_scanned_at) : '—'}</TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </div>

          {/* API Endpoint Catalog */}
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>API Endpoint Catalog</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
              <thead><tr>
                <TH>Endpoint</TH><TH>Method</TH><TH>Auth</TH><TH>Description</TH><TH>Rate Limit</TH>
              </tr></thead>
              <tbody>
                {[
                  { path: '/api/servers', method: 'GET', auth: 'None', desc: 'List & filter all active servers', rate: '60/min' },
                  { path: '/api/servers/search', method: 'GET', auth: 'None', desc: 'Full-text + tag + tool search', rate: '60/min' },
                  { path: '/api/servers/stats', method: 'GET', auth: 'None', desc: 'Global registry statistics', rate: '120/min' },
                  { path: '/api/servers/[name]', method: 'GET', auth: 'None', desc: 'Server details by name', rate: '60/min' },
                  { path: '/api/proxy/[server]/[tool]', method: 'POST', auth: 'Optional API key', desc: 'Proxy MCP tool call through registry', rate: '30/min (200 w/ key)' },
                  { path: '/api/ingest', method: 'POST', auth: 'CRON_SECRET', desc: 'Trigger ingestion pipeline', rate: 'Admin only' },
                  { path: '/api/ingest', method: 'GET', auth: 'CRON_SECRET', desc: 'Get last 10 ingest runs', rate: 'Admin only' },
                  { path: '/api/admin/ingest', method: 'POST', auth: 'Admin session', desc: 'Trigger ingest from dashboard', rate: 'Admin only' },
                  { path: '/api/cron/uptime-check', method: 'GET', auth: 'CRON_SECRET', desc: 'Probe all active server endpoints (every 15m)', rate: 'Cron only' },
                  { path: '/api/cron/schema-drift', method: 'GET', auth: 'CRON_SECRET', desc: 'Detect tool schema changes (every 6h)', rate: 'Cron only' },
                  { path: '/api/cron/reset-daily-calls', method: 'GET', auth: 'CRON_SECRET', desc: 'Reset calls_today counters (daily)', rate: 'Cron only' },
                  { path: '/api/mcp-server', method: 'POST', auth: 'None', desc: 'MCP-over-MCP server endpoint', rate: '60/min' },
                  { path: '/api/auth/callback', method: 'GET', auth: 'OAuth flow', desc: 'Auth provider callback', rate: 'N/A' },
                ].map(ep => (
                  <tr key={ep.path + ep.method}>
                    <TD mono color={C.blue}>{ep.path}</TD>
                    <TD mono>{ep.method}</TD>
                    <TD>{ep.auth}</TD>
                    <TD>{ep.desc}</TD>
                    <TD mono>{ep.rate}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Server Status Reference */}
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Server Status Lifecycle</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
              <thead><tr>
                <TH>Status</TH><TH>Set By</TH><TH>Visible (UI)</TH><TH>Visible (AI)</TH><TH>Callable</TH><TH>Description</TH>
              </tr></thead>
              <tbody>
                {[
                  { s: 'active', by: 'Ingest (scan ok)', ui: '✅', ai: '✅', call: '✅', desc: 'Live and available to all users' },
                  { s: 'pending_review', by: 'Ingest (high sev)', ui: '❌', ai: '❌', call: '❌', desc: 'Has high-severity issues, needs admin review' },
                  { s: 'pending', by: 'Manual publish', ui: '❌', ai: '❌', call: '❌', desc: 'Awaiting initial scan' },
                  { s: 'rejected', by: 'Ingest (critical)', ui: '❌', ai: '❌', call: '❌', desc: 'Failed security scan with critical issues' },
                  { s: 'suspended', by: 'Schema drift cron', ui: '❌', ai: '❌', call: '❌', desc: 'Tools changed post-approval (rug-pull detected)' },
                ].map(row => (
                  <tr key={row.s}>
                    <TD mono color={row.s === 'active' ? C.green : row.s === 'suspended' ? C.red : C.orange}>{row.s}</TD>
                    <TD>{row.by}</TD>
                    <TD>{row.ui}</TD>
                    <TD>{row.ai}</TD>
                    <TD>{row.call}</TD>
                    <TD>{row.desc}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── ANALYTICS ──────────────────────────────────────────────────────── */}
      {tab === 'analytics' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
          <div style={{ padding: '12px 14px', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: '10px', fontSize: '12px', color: 'var(--text-3)' }}>
            This data powers Relay&apos;s feedback loop. Intent→server mappings improve search ranking automatically.
            After ~10K invocations, this becomes the training corpus for the Gap 3 fine-tuned model.
          </div>

          {/* Top Intents */}
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Top Intents — what agents are trying to do</h3>
            {topIntents.length === 0
              ? <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-3)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>No intent data yet. Data accumulates as agents use search_tools.</div>
              : (
                <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <thead><tr><TH>Intent</TH><TH>Invocations</TH><TH>Successes</TH><TH>Success %</TH><TH>Servers</TH><TH>Last Seen</TH></tr></thead>
                  <tbody>
                    {topIntents.slice(0, tablePageSize).map((r, i) => (
                      <tr key={i}>
                        <TD>{r.intent_text}</TD>
                        <TD>{fmt(r.total_invocations)}</TD>
                        <TD color={C.green}>{fmt(r.total_successes)}</TD>
                        <TD color={Number(r.success_rate_pct) > 80 ? C.green : Number(r.success_rate_pct) > 50 ? C.orange : C.red}>{pct(r.success_rate_pct)}</TD>
                        <TD>{r.server_diversity}</TD>
                        <TD>{ago(r.last_seen)}</TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </div>

          {/* Ecosystem Gaps */}
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Ecosystem Gaps — intents with zero results</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '12px' }}>These are things agents need that the ecosystem can&apos;t serve. Ingest prioritization signal.</p>
            {ecosystemGaps.length === 0
              ? <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-3)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>No gaps recorded yet. Gaps appear when search_tools returns 0 results for an action intent.</div>
              : (
                <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <thead><tr><TH>Intent</TH><TH>Attempts</TH><TH>Last Tried</TH></tr></thead>
                  <tbody>
                    {ecosystemGaps.slice(0, tablePageSize).map((r, i) => (
                      <tr key={i}>
                        <TD color={C.orange}>{r.intent_text}</TD>
                        <TD>{fmt(r.search_attempts)}</TD>
                        <TD>{ago(r.last_attempted)}</TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </div>

          {/* Search Quality */}
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Search Quality — daily</h3>
            {searchQuality.length === 0
              ? <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-3)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>No search data yet.</div>
              : (
                <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <thead><tr><TH>Day</TH><TH>Searches</TH><TH>Zero Results</TH><TH>Knowledge Deflected</TH><TH>Cache Hits</TH><TH>Cache %</TH><TH>Avg ms</TH></tr></thead>
                  <tbody>
                    {searchQuality.slice(0, tablePageSize).map((r, i) => (
                      <tr key={i}>
                        <TD mono>{r.day}</TD>
                        <TD>{fmt(r.total_searches)}</TD>
                        <TD color={Number(r.zero_result_pct) > 20 ? C.red : C.orange}>{fmt(r.zero_results)} ({pct(r.zero_result_pct)})</TD>
                        <TD color={C.blue}>{fmt(r.knowledge_deflected)}</TD>
                        <TD color={C.green}>{fmt(r.cache_hits)}</TD>
                        <TD color={Number(r.cache_hit_pct) > 30 ? C.green : C.grey}>{pct(r.cache_hit_pct)}</TD>
                        <TD>{r.avg_search_ms ? `${r.avg_search_ms}ms` : '—'}</TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </div>

          {/* Server Reliability */}
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Server Reliability — the ML training signal</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '12px' }}>Historical success rates per server. High invoke_count + high success_rate = strong training examples.</p>
            {serverReliability.length === 0
              ? <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-3)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>No reliability data yet. This is optional lab telemetry, not part of the lightweight MVP path.</div>
              : (
                <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <thead><tr><TH>Server</TH><TH>Invocations</TH><TH>Success %</TH><TH>Avg Latency</TH><TH>Unique Intents</TH><TH>Last Success</TH></tr></thead>
                  <tbody>
                    {serverReliability.slice(0, tablePageSize).map((r, i) => (
                      <tr key={i}>
                        <TD mono color={C.blue}>{r.server_name}</TD>
                        <TD>{fmt(r.total_invokes)}</TD>
                        <TD color={Number(r.success_rate_pct) > 80 ? C.green : Number(r.success_rate_pct) > 50 ? C.orange : C.red}>{pct(r.success_rate_pct)}</TD>
                        <TD>{r.avg_latency_ms ? `${r.avg_latency_ms}ms` : '—'}</TD>
                        <TD>{r.unique_intents_served}</TD>
                        <TD>{r.last_success ? ago(r.last_success) : '—'}</TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </div>
        </div>
      )}

      {/* ── RELEASE ────────────────────────────────────────────────────────── */}
      {tab === 'release' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {!releaseReport ? (
            <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-3)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>
              Release report not available yet.
            </div>
          ) : (
            <>
              <Callout title="How to use this tab">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    Export the release packet for sprint review, then paste the Markdown into your notes doc (or download it as a file).
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        const json = JSON.stringify(releaseReport, null, 2);
                        downloadTextFile(`release-report-${releaseReport.generated_at.slice(0, 10)}.json`, json, 'application/json;charset=utf-8');
                      }}
                      style={{ fontFamily: 'var(--mono)' }}
                    >
                      Download JSON
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        const ok = await copyToClipboard(releaseMarkdown);
                        if (!ok) setAdminError('Copy failed (clipboard not available). Use Download Markdown instead.');
                      }}
                      disabled={!releaseMarkdown}
                    >
                      Copy Markdown
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => downloadTextFile(`release-notes-${releaseReport.generated_at.slice(0, 10)}.md`, releaseMarkdown, 'text/markdown;charset=utf-8')}
                      disabled={!releaseMarkdown}
                    >
                      Download Markdown
                    </button>
                    <span style={{ fontSize: '11px', color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
                      Generated: {formatIsoDate(releaseReport.generated_at)}
                    </span>
                  </div>
                </div>
              </Callout>

              <div style={{ padding: '14px 16px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--surface)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px' }}>
                  Release Decision
                </div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: releaseReport.release === 'go' ? C.green : C.red, fontFamily: 'var(--mono)' }}>
                  {releaseReport.release.toUpperCase()}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '4px' }}>
                  Generated {ago(releaseReport.generated_at)}
                </div>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                <thead><tr><TH>Gate</TH><TH>Status</TH><TH>Value</TH><TH>Rule</TH><TH>Notes</TH></tr></thead>
                <tbody>
                  {releaseReport.gates.map((g) => (
                    <tr key={g.name}>
                      <TD>{g.name}</TD>
                      <TD color={g.state === 'pass' ? C.green : g.state === 'fail' ? C.red : C.orange}>
                        {g.state}
                      </TD>
                      <TD mono>{g.value}</TD>
                      <TD mono>{g.rule}</TD>
                      <TD>{g.notes ?? '—'}</TD>
                    </tr>
                  ))}
                </tbody>
              </table>

              {releaseMarkdown && (
                <div style={{ border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: '12px', overflow: 'hidden' }}>
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                      Markdown preview
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-3)' }}>
                      Copy or download above (preview is read-only)
                    </div>
                  </div>
                  <pre style={{ margin: 0, padding: '12px 14px', maxHeight: '340px', overflow: 'auto', fontSize: '12px', lineHeight: 1.55, fontFamily: 'var(--mono)', color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
                    {releaseMarkdown}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── CONFIG ─────────────────────────────────────────────────────────── */}
      {tab === 'config' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
          <div style={{ padding: '12px 14px', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: '10px', fontSize: '12px', color: 'var(--text-3)' }}>
            Rate limit changes take effect within 5 minutes (cache TTL). Changes are logged with your user ID.
            Window is always in milliseconds (60000 = 1 minute).
          </div>

          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Rate Limits</h3>
            {rateLimits.length === 0
              ? <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-3)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>No config found. Run migration 023 to create rate_limit_config table.</div>
              : (
                <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <thead><tr><TH>Context</TH><TH>Limit</TH><TH>Window (ms)</TH><TH>Note</TH><TH>Updated</TH><TH>Action</TH></tr></thead>
                  <tbody>
                    {rateLimits.map((r: any) => (
                      <RateLimitRow
                        key={r.context}
                        row={r}
                        saving={rlSaving === r.context}
                        onSave={saveRateLimit}
                      />
                    ))}
                  </tbody>
                </table>
              )
            }
          </div>
        </div>
      )}
    </div>
  );
}
