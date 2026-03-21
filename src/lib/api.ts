/**
 * openMCP — API utilities
 *
 * Centralised patterns for route handlers:
 *   - Typed error responses
 *   - withRoute() wrapper — catches unhandled throws, strips stack traces in prod
 *   - extractIp() — safe IP extraction from Vercel/edge headers
 */

import { NextRequest, NextResponse } from 'next/server';

// ── Error response shape ──────────────────────────────────────────────────────
export interface ApiError {
  error:   string;
  code?:   string;
  hint?:   string;
  status:  number;
}

export function apiError(
  message: string,
  status  = 500,
  opts: { code?: string; hint?: string } = {}
): NextResponse {
  const body: Omit<ApiError, 'status'> = { error: message, ...opts };
  return NextResponse.json(body, { status });
}

export function apiOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

// ── Route wrapper — catches all unhandled errors ──────────────────────────────
type RouteHandler = (req: NextRequest, ctx?: any) => Promise<NextResponse>;

export function withRoute(handler: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err: any) {
      // Never expose stack traces in production
      const isProd = process.env.NODE_ENV === 'production';
      const message = isProd ? 'Internal server error' : (err?.message ?? 'Unknown error');
      if (!isProd) console.error('[openMCP] Unhandled route error:', err);
      return apiError(message, 500, { code: 'INTERNAL_ERROR' });
    }
  };
}

// ── Zod error formatter ───────────────────────────────────────────────────────
export function zodError(err: any): NextResponse {
  const first = err?.errors?.[0];
  const message = first ? `${first.path.join('.')}: ${first.message}` : 'Validation error';
  return apiError(message, 400, { code: 'VALIDATION_ERROR' });
}

// ── IP extraction ─────────────────────────────────────────────────────────────
// Vercel sets x-forwarded-for correctly at the edge — the first IP is the client.
// This is safe on Vercel. Self-hosted: validate before trusting.
export function extractIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0].trim();
    if (first && first !== 'unknown') return first;
  }
  // Fallback for local dev
  return '127.0.0.1';
}

// ── Method guard ──────────────────────────────────────────────────────────────
export function requireMethod(
  req: NextRequest,
  methods: string[]
): NextResponse | null {
  if (!methods.includes(req.method)) {
    return apiError(
      `Method ${req.method} not allowed`,
      405,
      { code: 'METHOD_NOT_ALLOWED' }
    );
  }
  return null;
}
