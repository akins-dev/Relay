import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { extractIp, apiError, zodError } from '@/lib/api';
import { resolveApiKey } from '@/lib/auth-server';
import { getLimitConfig, rateLimit } from '@/lib/ratelimit';
import { recordInvokeOutcome } from '@/lib/search-analytics';

const InvokeOutcomeSchema = z.object({
  serverName:    z.string().min(1).max(200),
  toolName:      z.string().min(1).max(200),
  intentHash:    z.string().min(8).max(128),
  intentText:    z.string().min(1).max(500),
  success:       z.boolean(),
  latencyMs:     z.number().int().min(0).max(10 * 60_000),
  statusCode:    z.number().int().min(100).max(599).default(200),
  errorType:     z.enum(['auth', 'policy', 'dlp', 'upstream', 'timeout']).nullable().default(null),
  searchEventId: z.string().uuid().nullable().default(null),
});

export async function POST(req: NextRequest) {
  const auth = await resolveApiKey(req);
  if (!auth.userId) {
    return apiError('API key required for invoke outcome reporting', 401, {
      code: 'API_KEY_REQUIRED',
    });
  }

  const ip = extractIp(req);
  const rlConfig = await getLimitConfig('proxyAuth');
  const rl = await rateLimit(`invoke-outcome:user:${auth.userId}:ip:${ip}`, rlConfig);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))) } },
    );
  }

  let body: z.infer<typeof InvokeOutcomeSchema>;
  try {
    body = InvokeOutcomeSchema.parse(await req.json());
  } catch (e) {
    return zodError(e);
  }

  await recordInvokeOutcome({
    searchEventId: body.searchEventId,
    userId:        auth.userId,
    serverId:      null,
    serverName:    body.serverName,
    toolName:      body.toolName,
    intentHash:    body.intentHash,
    intentText:    body.intentText,
    statusCode:    body.statusCode,
    success:       body.success,
    latencyMs:     body.latencyMs,
    errorType:     body.errorType,
    dlpTriggered:  body.errorType === 'dlp',
    wasRetry:      false,
    retryServer:   null,
  });

  return NextResponse.json({ ok: true });
}
