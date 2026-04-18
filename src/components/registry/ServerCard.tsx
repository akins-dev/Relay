import Link            from 'next/link';
import { cn }          from '@/lib/cn';
import { Badge }       from '@/components/ui/badge';
import { highlight }   from '@/lib/highlight';
import { Shield, Star, Zap, Clock } from 'lucide-react';

interface ServerCardProps {
  server: {
    name:         string;
    display_name: string;
    description:  string;
    trust_score:  number;
    verified:     boolean;
    stars:        number;
    calls_today:  number;
    latency_ms:   number | null;
    uptime_pct:   number;
    scan_status:  string;
    tags:         string[];
    source?:      string;
    is_new?:      boolean;
    github_url?:  string;
    profiles?:    { username: string; avatar_url?: string } | null;
  };
  /** Active search query — passed down to highlight matched text */
  query?: string;
}

function TrustBar({ score }: { score: number }) {
  const color = score >= 85 ? 'bg-green-500' : score >= 70 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${score}%` }} />
      </div>
      <span className={cn('min-w-[28px] font-mono text-xs font-semibold',
        score >= 85 ? 'text-green-700' : score >= 70 ? 'text-amber-600' : 'text-red-500'
      )}>{score}</span>
    </div>
  );
}

export function ServerCard({ server: s, query = '' }: ServerCardProps) {
  return (
    <Link href={`/registry/${s.name}`} className="group block no-underline">
      <div className="h-full rounded-xl border border-border bg-card p-5 transition-all duration-200 hover:border-brand/30 hover:shadow-md">

        {/* Header */}
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate font-mono text-[13px] font-semibold text-brand">
                {highlight(s.name, query)}
              </span>
              {s.verified && (
                <Shield size={12} className="shrink-0 text-green-600" />
              )}
              {s.is_new && (
                <Badge variant="new" className="text-[10px]">NEW</Badge>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
              {s.github_url && s.github_url.includes('github.com/') ? (
                <>
                  <span className="text-muted-foreground hover:text-foreground transition-colors" title={s.github_url}>
                    {s.github_url.replace(/.*github\.com\//i, '').split('/')[0]}
                  </span>
                  <span className="text-muted-foreground/40">/</span>
                </>
              ) : null}
              <span>{highlight(s.display_name, query)}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
            <Star size={12} />
            <span className="text-xs">{s.stars?.toLocaleString() ?? 0}</span>
          </div>
        </div>

        {/* Description */}
        <p className="mb-4 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
          {highlight(s.description, query)}
        </p>

        {/* Trust bar */}
        <div className="mb-3">
          <TrustBar score={s.trust_score} />
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          {s.latency_ms != null && (
            <span className="flex items-center gap-1">
              <Zap size={10} />
              {s.latency_ms}ms
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock size={10} />
            {(s.uptime_pct ?? 100).toFixed(1)}%
          </span>
          {s.calls_today > 0 && (
            <span>{s.calls_today.toLocaleString()} calls today</span>
          )}
        </div>

        {/* Tags — also highlighted when query matches */}
        {s.tags?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {s.tags.slice(0, 4).map(tag => {
              const isMatch = query && tag.toLowerCase().includes(query.toLowerCase());
              return (
                <span
                  key={tag}
                  className={cn(
                    'rounded-md px-2 py-0.5 text-[11px] transition-colors',
                    isMatch
                      ? 'bg-[#22d3ee]/10 text-[#22d3ee] font-medium'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {highlight(tag, query)}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </Link>
  );
}
