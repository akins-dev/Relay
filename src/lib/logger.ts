/**
 * Relay — Structured Logger
 *
 * Centralised logging with levels, tags, and structured context.
 * Replaces ad-hoc console.log/warn/error and DEBUG-TRACE patterns.
 *
 * Usage:
 *   import { log } from '@/lib/logger';
 *   log.info('ingest:official', 'Fetched 42 servers', { count: 42, elapsed: '1.2s' });
 *   log.warn('proxy', 'Upstream returned 401', { server: 'sendgrid', status: 401 });
 *   log.error('ingest:smithery', 'API fetch failed', error);
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info:  1,
  warn:  2,
  error: 3,
};

// Default to 'info' in production, 'debug' in development
const CURRENT_LEVEL: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) ??
  (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[CURRENT_LEVEL];
}

function formatTag(tag: string): string {
  return `[${tag}]`;
}

function formatContext(ctx?: Record<string, unknown>): string {
  if (!ctx || Object.keys(ctx).length === 0) return '';
  // Compact key=value for structured but human-readable logs
  const parts = Object.entries(ctx)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      if (typeof v === 'string' && v.length > 200) return `${k}="${v.slice(0, 200)}…"`;
      if (typeof v === 'object') return `${k}=${JSON.stringify(v)}`;
      return `${k}=${v}`;
    });
  return parts.length > 0 ? ` — ${parts.join(' ')}` : '';
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return ` — ${err.message}${err.stack ? `\n${err.stack}` : ''}`;
  }
  if (typeof err === 'string') return ` — ${err}`;
  return ` — ${String(err)}`;
}

function write(level: LogLevel, tag: string, message: string, extra?: Record<string, unknown> | Error | unknown) {
  if (!shouldLog(level)) return;

  const prefix = `${formatTag(tag)}`;
  let suffix = '';

  if (extra instanceof Error) {
    suffix = formatError(extra);
  } else if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    suffix = formatContext(extra as Record<string, unknown>);
  } else if (extra !== undefined) {
    suffix = formatError(extra);
  }

  const line = `${prefix} ${message}${suffix}`;

  switch (level) {
    case 'debug': console.debug(line); break;
    case 'info':  console.log(line);   break;
    case 'warn':  console.warn(line);  break;
    case 'error': console.error(line); break;
  }
}

export const log = {
  debug: (tag: string, message: string, ctx?: Record<string, unknown>) => write('debug', tag, message, ctx),
  info:  (tag: string, message: string, ctx?: Record<string, unknown>) => write('info',  tag, message, ctx),
  warn:  (tag: string, message: string, ctx?: Record<string, unknown> | Error | unknown) => write('warn',  tag, message, ctx),
  error: (tag: string, message: string, err?: Error | unknown) => write('error', tag, message, err),

  /** Log a section separator for ingest source boundaries */
  section: (title: string) => {
    if (!shouldLog('info')) return;
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`[ingest] ▶ ${title}`);
    console.log('═'.repeat(50));
  },

  /** Log progress for batch operations: [42/500] server-name — details */
  progress: (tag: string, idx: number, total: number, name: string, message: string, ctx?: Record<string, unknown>) => {
    write('info', tag, `[${idx + 1}/${total}] ${name} — ${message}`, ctx);
  },
};
