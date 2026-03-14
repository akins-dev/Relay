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

function TrustDot({ score }: { score: number }) {
  const color = score >= 90 ? 'var(--green)' : score >= 70 ? 'var(--yellow)' : 'var(--red)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}` }} />
      <span style={{ fontSize: '11px', fontFamily: 'var(--mono)', color }}>{Math.round(score)}</span>
    </div>
  );
}

interface Props { server: Server; compact?: boolean; }

export function ServerCard({ server, compact = false }: Props) {
  return (
    <Link href={`/registry/${server.name}`} style={{ textDecoration: 'none' }}>
      <div className="card" style={{ padding: compact ? '14px 16px' : '18px 20px', cursor: 'pointer', position: 'relative', overflow: 'hidden' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-2)'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-2)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-1)'; }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--mono)', fontWeight: 500, fontSize: '14px' }}>{server.name}</span>
            {server.verified && <span className="badge badge-green">✓ verified</span>}
            {server.scan_status === 'failed' && <span className="badge badge-red">⚠ issues</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
            <TrustDot score={server.trust_score} />
            <span style={{ fontSize: '12px', color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>★ {server.stars.toLocaleString()}</span>
          </div>
        </div>

        <div style={{ fontSize: '11px', color: 'var(--text-3)', fontFamily: 'var(--mono)', marginBottom: '8px' }}>
          {server.author_name ?? 'unknown'} · v{server.version}
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
            <span>↑ {server.uptime_pct?.toFixed(1)}%</span>
            <span>{((server.calls_today ?? 0) / 1000).toFixed(1)}K calls/day</span>
          </div>
        )}
      </div>
    </Link>
  );
}
