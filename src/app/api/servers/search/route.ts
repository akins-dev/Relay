import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getLimitConfig } from '@/lib/ratelimit';
import { extractIp, apiError } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { resolveApiKey } from '@/lib/auth-server';
import { ensureSearchContracts } from '@/lib/runtime-contracts';
import { runSearch } from '@/lib/search';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') ?? '').trim();
  const limit = Math.min(20, Math.max(1, parseInt(searchParams.get('limit') ?? '5', 10)));

  if (!q) {
    return apiError('Query parameter q is required', 400, { code: 'MISSING_QUERY' });
  }

  const ip = extractIp(req);
  const auth = await resolveApiKey(req);
  const apiKeyUserId = auth.userId;
  const rlKey = apiKeyUserId ? `search:user:${apiKeyUserId}` : `search:ip:${ip}`;
  const rlConfig = apiKeyUserId ? await getLimitConfig('proxyAuth') : await getLimitConfig('search');
  const rl = await rateLimit(rlKey, rlConfig);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', hint: `Create a free API key at ${BRAND.domain} for higher limits` },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))),
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  }

  try {
    await ensureSearchContracts();
    const result = await runSearch({ intent: q, limit, surface: 'rest' });
    return NextResponse.json({
      query: q,
      count: result.results.length,
      results: result.results,
      message: result.results.length === 0 ? 'No servers found. Try broader terms.' : undefined,
    });
  } catch (err: any) {
    console.error('[search] Unexpected error:', err?.message);
    if (String(err?.message ?? '').includes('search_servers')) {
      return apiError('Search failed: search_servers contract mismatch or RPC error', 500, {
        code: 'SEARCH_RPC_CONTRACT_ERROR',
      });
    }
    return apiError('Search failed', 500, { code: 'INTERNAL_ERROR' });
  }
}
