import { safeCompare, isSafeUrl } from '@/lib/utils';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { createHash } from 'crypto';

function isAuthorized(req: NextRequest) {
  return safeCompare(req.headers.get('authorization') ?? '', `Bearer ${process.env.CRON_SECRET ?? ''}`);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const svc = createServiceClient();
  const results = { checked: 0, drifted: 0, suspended: 0, errors: 0 };

  const { data: servers } = await svc
    .from('servers')
    .select('id, name, endpoint, tools, schema_hash, version')
    .eq('status', 'active')
    .not('schema_hash', 'is', null);

  for (const server of servers ?? []) {
    results.checked++;
    try {
      if (!isSafeUrl(server.endpoint)) { results.errors++; continue; }
      const res = await fetch(`${server.endpoint}/tools`, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'X-Registry-Probe': 'schema-drift' },
      });
      if (!res.ok) { results.errors++; continue; }

      const currentTools: string[] = await res.json()
        .then((d: any) => (Array.isArray(d) ? d : d.tools ?? server.tools))
        .catch(() => server.tools);

      const currentHash = createHash('sha256')
        .update(JSON.stringify(currentTools.slice().sort()) + server.version)
        .digest('hex');

      if (currentHash !== server.schema_hash) {
        results.drifted++;
        // L3: Suspend immediately — schema mutated post-approval (rug-pull)
        await svc.from('servers').update({
          status:      'suspended',
          scan_status: 'failed',
          scan_issues: [{ severity: 'critical', type: 'schema_drift',
            description: `Schema changed after approval. Old hash: ${server.schema_hash?.slice(0, 8)} New: ${currentHash.slice(0, 8)}` }] as any,
        }).eq('id', server.id);

        await svc.from('scan_results').insert({
          server_id: server.id, scan_type: 'drift', passed: false, score: 0,
          issues: [{ severity: 'critical', type: 'schema_drift',
            description: `Tools changed. Previous: [${server.tools.join(', ')}]` }] as any,
          details: 'Schema drift detected. Server suspended pending re-review.',
        });
        results.suspended++;
      } else {
        await svc.from('servers')
          .update({ last_scanned_at: new Date().toISOString() })
          .eq('id', server.id);
      }
    } catch { results.errors++; }
  }

  return NextResponse.json({ ...results, timestamp: new Date().toISOString() });
}
