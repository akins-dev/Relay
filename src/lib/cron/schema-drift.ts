import { isSafeUrl }          from '@/lib/utils';
import { createServiceClient } from '@/lib/supabase/server';
import { createHash }          from 'crypto';
import { probeMCPServer }      from '@/lib/mcp-probe';
import { indirectInjectionScan, shellInjectionScan } from '@/lib/security';

export async function runSchemaDrift() {
  const svc = createServiceClient();
  const results = { checked: 0, drifted: 0, suspended: 0, errors: 0 };

  // Track cron job run for admin dashboard
  const { data: cronRun } = await svc.from('cron_job_runs').insert({
    job_name: 'schema_drift', status: 'running',
  }).select('id').single().catch(() => ({ data: null }));

  const { data: servers } = await svc
    .from('servers')
    .select('id, name, endpoint, tools, schema_hash, version, github_url, transport')
    .eq('status', 'active')
    .not('schema_hash', 'is', null);

  for (const server of servers ?? []) {
    results.checked++;
    try {
      // Skip stdio servers — they have no HTTP endpoint to probe
      if (server.transport === 'stdio' || !server.endpoint || !isSafeUrl(server.endpoint)) {
        continue;
      }

      // FIX: Use proper MCP initialize handshake instead of raw GET /tools.
      // The MCP spec requires initialize → initialized → tools/list.
      // Calling GET /tools directly violates the spec and fails on compliant servers.
      const probe = await probeMCPServer(server.endpoint, 10_000);

      // If probe failed entirely, count as error but don't suspend
      // (server might be temporarily down — uptime-check handles that)
      if (!probe.alive) {
        results.errors++;
        continue;
      }

      // Extract current tools from probe result
      const currentTools: string[] = probe.tools.map((t: any) => t.name).sort();

      // Compute hash using the SAME inputs as the ingest pipeline
      // (tools + version + endpoint + github_url) to avoid false drifts
      const currentHash = createHash('sha256')
        .update([
          JSON.stringify(currentTools),
          server.version ?? '',
          server.endpoint ?? '',
          server.github_url ?? '',
        ].join('|'))
        .digest('hex');

      if (currentHash !== server.schema_hash) {
        results.drifted++;

        // Re-run injection scan on the new tool descriptions — ATK-1 mitigation.
        // A server could register clean, get approved, then swap in malicious descriptions.
        const allDescriptions = probe.tools.map((t: any) => `${t.name}: ${t.description ?? ''}`).join('\n');
        const injectionIssues = [
          ...indirectInjectionScan(allDescriptions),
          ...shellInjectionScan(allDescriptions),
        ];
        const hasInjection = injectionIssues.length > 0;

        const suspendReason = hasInjection
          ? `Schema drift with injection detected. Issues: ${injectionIssues.slice(0, 3).join(', ')}`
          : `Schema changed after approval. Old hash: ${server.schema_hash?.slice(0, 8)} New: ${currentHash.slice(0, 8)}. Old tools: [${server.tools.join(', ')}] New tools: [${currentTools.join(', ')}]`;

        // Suspend immediately — schema mutated post-approval (rug-pull or injection)
        await svc.from('servers').update({
          status:      'suspended',
          scan_status: 'failed',
          scan_issues: [{ severity: 'critical', type: hasInjection ? 'injection_on_drift' : 'schema_drift', description: suspendReason }] as any,
        }).eq('id', server.id);

        await svc.from('scan_results').insert({
          server_id: server.id, scan_type: 'drift', passed: false, score: 0,
          issues: [{
            severity: 'critical',
            type: hasInjection ? 'injection_on_drift' : 'schema_drift',
            description: suspendReason,
          }] as any,
          details: hasInjection
            ? `Injection patterns found after schema drift. Server suspended pending re-review.`
            : 'Schema drift detected. Server suspended pending re-review.',
        });
        results.suspended++;
      } else {
        await svc.from('servers')
          .update({ last_scanned_at: new Date().toISOString() })
          .eq('id', server.id);
      }
    } catch { results.errors++; }
  }

  // Record completion in cron_job_runs
  if (cronRun?.id) {
    await svc.from('cron_job_runs').update({
      finished_at: new Date().toISOString(), status: 'success', result: results,
    }).eq('id', cronRun.id).catch(() => {});
  }

  return { ...results, timestamp: new Date().toISOString() };
}