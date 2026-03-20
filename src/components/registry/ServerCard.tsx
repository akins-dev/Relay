import Link from 'next/link';
import type { Server } from '@/types';

const TAG_PALETTE: Record<string, string> = {
  security: 'red', credentials: 'red', proxy: 'red', zk: 'red',
  payments: 'green', finance: 'green', billing: 'green', stripe: 'green',
  database: 'blue', sql: 'blue', postgres: 'blue', data: 'blue',
  git: 'orange', devops: 'orange', code: 'orange', 'ci-cd': 'orange',
  email: 'purple', marketing: 'purple', notifications: 'purple',
  browser: 'orange', automation: 'orange', scraping: 'orange',
  messaging: 'blue', slack: 'blue', storage: 'blue',
};

const SOURCE_BADGE: Record<string, { label: string; color: string; bg: string; border: string }> = {
  official: { label: '⬡ official',  color: '#22c55e', bg: '#0d2b1a', border: '#166534' },
  github:   { label: '◆ github',    color: '#a855f7', bg: '#1a0b2b', border: '#581c87' },
  smithery: { label: '◈ smithery',  color: '#3b82f6', bg: '#0d1a2b', border: '#1e3a5f' },
  direct:   { label: '◉ direct',    color: '#6b7280', bg: '#121212', border: '#1f1f1f' },
};

function TrustDot({ score }: { score: number }) {
  const color = score >= 90 ? 'var(--green)' : score >= 70 ? 'var(--yellow)' : 'var(--red)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}` }} />
      <span style={{ fontSize: '11px', fontFamily: 'var(--mono)', color }}>{Math.round(score)}</span>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const s = SOURCE_BADGE[source] ?? SOURCE_BADGE.direct;
  return (
    <span style={{
      fontSize: '9px', fontFamily: 'var(--mono)', padding: '1px 6px',
      borderRadius: '3px', border: `1px solid ${s.border}`,
      background: s.bg, color: s.color, letterSpacing: '0.04em',
    }}>
      {s.label}
    </span>
  );
}

// Security coverage indicator — shows how many layers the server passed
function SecurityBar({ scanStatus, cveIssues }: { scanStatus: string; cveIssues?: any[] }) {
  const hasCve    = (cveIssues?.length ?? 0) > 0;
  const passed    = scanStatus === 'passed' && !hasCve;
  const partial   = scanStatus === 'passed' && hasCve;

  if (passed)  return <span style={{ fontSize: '10px', color: 'var(--green)',  fontFamily: 'var(--mono)' }}>✓ scanned</span>;
  if (partial) return <span style={{ fontSize: '10px', color: 'var(--yellow)', fontFamily: 'var(--mono)' }}>⚠ cve</span>;
  return         <span style={{ fontSize: '10px', color: 'var(--red)',    fontFamily: 'var(--mono)' }}>✕ issues</span>;
}

interface Props { server: Server & { author_name?: string; profiles?: any }; compact?: boolean; }

export function ServerCard({ server, compact = false }: Props) {
  const authorName = (server as any).profiles?.username ?? (server as any).author_name ?? 'unknown';
  const source     = (server as any).source ?? 'direct';
  const cveIssues  = (server as any).cve_issues ?? [];

  return (
    <Link href={`/registry/${server.name}`} style={{ textDecoration: 'none' }}>
      <div className="card" style={{ padding: compact ? '14px 16px' : '18px 20px', cursor: 'pointer', position: 'relative', overflow: 'hidden' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-2)'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-2)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-1)'; }}>

        {/* Top row: name + badges + trust */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--mono)', fontWeight: 500, fontSize: '14px' }}>{server.name}</span>
            {server.verified && <span className="badge badge-green">✓ verified</span>}
            {server.scan_status === 'failed' && <span className="badge badge-red">⚠ issues</span>}
            <SourceBadge source={source} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
            <SecurityBar scanStatus={server.scan_status} cveIssues={cveIssues} />
            <TrustDot score={server.trust_score} />
            <span style={{ fontSize: '12px', color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>★ {server.stars?.toLocaleString()}</span>
          </div>
        </div>

        {/* Author + version */}
        <div style={{ fontSize: '11px', color: 'var(--text-3)', fontFamily: 'var(--mono)', marginBottom: '8px' }}>
          {authorName} · v{server.version}
        </div>

        {!compact && (
          <p style={{ fontSize: '13px', color: 'var(--text-2)', lineHeight: 1.5, marginBottom: '12px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {server.description}
          </p>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: compact ? 0 : '12px' }}>
          {server.tags.slice(0, 4).map(tag => (
            <span key={tag} className={`tag tag-${TAG_PALETTE[tag] ?? 'default'}`}>{tag}</span>
          ))}
        </div>

        {!compact && (
          <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
            {server.latency_ms && <span>⚡ {server.latency_ms}ms</span>}
            <span>↑ {Number(server.uptime_pct)?.toFixed(1)}%</span>
            <span>{((server.calls_today ?? 0) / 1000).toFixed(1)}K calls/day</span>
          </div>
        )}
      </div>
    </Link>
  );
}
