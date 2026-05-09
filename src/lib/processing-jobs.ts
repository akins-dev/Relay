import { createHash } from 'crypto';
import { buildSandboxCommand, fetchMCPPrimitives } from '@/lib/ingest/legacy-bridge';
import { parseReadmeDescription, parseReadmeSchemas } from '@/lib/ingest/helpers';
import { scanNpmDependencies } from '@/lib/security';
import { log } from '@/lib/logger';

export type ProcessingJobType = 'probe' | 'sandbox' | 'readme_enrich' | 'cve_scan';

const TAG = 'processing-jobs';

function normalizeToolSchemas(tools: any[]): Array<{ name: string; description: string; inputSchema?: Record<string, unknown> }> {
  if (!Array.isArray(tools)) return [];
  return tools
    .filter(t => t && typeof t.name === 'string' && t.name.length > 0)
    .map(t => ({
      name: t.name,
      description: typeof t.description === 'string' ? t.description : '',
      ...(t.inputSchema && typeof t.inputSchema === 'object' ? { inputSchema: t.inputSchema } : {}),
    }));
}

function normalizeResources(resources: any[]): Array<{ uri: string; name: string; description?: string; mimeType?: string }> {
  if (!Array.isArray(resources)) return [];
  return resources
    .filter(r => r && typeof r.uri === 'string' && r.uri.length > 0)
    .map(r => ({
      uri: r.uri,
      name: typeof r.name === 'string' && r.name.length > 0 ? r.name : r.uri,
      ...(typeof r.description === 'string' ? { description: r.description } : {}),
      ...(typeof r.mimeType === 'string' ? { mimeType: r.mimeType } : {}),
    }));
}

function normalizePrompts(prompts: any[]): Array<{ name: string; description?: string; arguments?: any[] }> {
  if (!Array.isArray(prompts)) return [];
  return prompts
    .filter(p => p && typeof p.name === 'string' && p.name.length > 0)
    .map(p => ({
      name: p.name,
      ...(typeof p.description === 'string' ? { description: p.description } : {}),
      ...(Array.isArray(p.arguments) ? { arguments: p.arguments } : {}),
    }));
}

function schemaHash(params: {
  tools: string[];
  version?: string | null;
  endpoint?: string | null;
  github_url?: string | null;
}) {
  return createHash('sha256')
    .update([
      JSON.stringify(params.tools.slice().sort()),
      params.version ?? '',
      params.endpoint ?? '',
      params.github_url ?? '',
    ].join('|'))
    .digest('hex');
}

export async function enqueueServerProcessingJobs(
  svc: any,
  serverId: string,
  server: {
    endpoint?: string | null;
    transport?: string | null;
    github_url?: string | null;
    smithery_id?: string | null;
    package_info?: any;
    description?: string | null;
    tool_extraction_source?: string | null;
  }
) {
  const jobs: Array<{ server_id: string; job_type: ProcessingJobType; priority: number }> = [];
  const hasWeakDescription = !server.description || server.description.length < 20 || server.description === 'No description provided';
  const hasLaunchableStdio = server.transport === 'stdio' && (server.package_info || server.smithery_id || server.github_url);

  if (server.endpoint && server.transport !== 'stdio') {
    jobs.push({ server_id: serverId, job_type: 'probe', priority: 20 });
  }
  if (hasLaunchableStdio) {
    jobs.push({ server_id: serverId, job_type: 'sandbox', priority: 30 });
  }
  if (server.github_url && hasWeakDescription) {
    jobs.push({ server_id: serverId, job_type: 'readme_enrich', priority: 60 });
  }
  if (server.github_url) {
    jobs.push({ server_id: serverId, job_type: 'cve_scan', priority: 80 });
  }

  if (jobs.length === 0) return;

  try {
    const { error } = await svc
      .from('server_processing_jobs')
      .upsert(jobs, { onConflict: 'server_id,job_type', ignoreDuplicates: true });
    if (error) log.warn(TAG, 'Failed to enqueue processing jobs', { serverId, error: error.message });
  } catch (err) {
    log.warn(TAG, 'Processing job table unavailable; skipping enqueue', err instanceof Error ? err : undefined);
  }
}

async function markJob(svc: any, jobId: string, patch: Record<string, any>) {
  await svc.from('server_processing_jobs').update({
    ...patch,
    updated_at: new Date().toISOString(),
  }).eq('id', jobId);
}

async function runProbeJob(svc: any, server: any) {
  if (!server.endpoint) return { skipped: true, reason: 'missing_endpoint' };
  const primitives = await fetchMCPPrimitives(server.endpoint, server.github_url ?? undefined);
  const toolSchemas = normalizeToolSchemas(primitives.toolSchemas);
  const tools = toolSchemas.length > 0 ? toolSchemas.map(t => t.name) : (server.tools ?? []);
  const patch: Record<string, any> = {
    resources: normalizeResources(primitives.resources),
    prompts: normalizePrompts(primitives.prompts),
    protocol_version: primitives.protocolVersion,
    mcp_compliant: primitives.mcpCompliant,
    last_scanned_at: new Date().toISOString(),
  };
  if (toolSchemas.length > 0) {
    patch.tools = tools;
    patch.tool_schemas = toolSchemas;
    patch.tool_extraction_source = 'mcp_probe';
    patch.schema_hash = schemaHash({
      tools,
      version: server.version,
      endpoint: server.endpoint,
      github_url: server.github_url,
    });
  }
  if (primitives.transport !== 'unknown') {
    patch.transport = primitives.transport;
    patch.proxy_available = primitives.transport !== 'stdio' && Boolean(server.endpoint);
  }
  await svc.from('servers').update(patch).eq('id', server.id);
  return { tools: tools.length, source: toolSchemas.length > 0 ? 'mcp_probe' : 'probe_no_tools' };
}

async function runSandboxJob(svc: any, server: any) {
  if (!process.env.SANDBOX_URL || !process.env.SANDBOX_AUTH_TOKEN) {
    return { skipped: true, reason: 'sandbox_not_configured' };
  }
  const sandboxCommand = buildSandboxCommand({
    smithery_id: server.smithery_id ?? undefined,
    github_url: server.github_url ?? undefined,
    package_info: server.package_info ?? undefined,
  });
  if (!sandboxCommand) return { skipped: true, reason: 'no_sandbox_command' };

  const req = await fetch(`${process.env.SANDBOX_URL}/extract`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SANDBOX_AUTH_TOKEN}`,
    },
    body: JSON.stringify(sandboxCommand),
    signal: AbortSignal.timeout(Number(process.env.SANDBOX_EXTRACT_TIMEOUT_MS || 120_000)),
  });
  if (!req.ok) throw new Error(`Sandbox returned ${req.status}`);
  const sandboxResult = await req.json();
  if (!sandboxResult.success || !sandboxResult.data) return { skipped: true, reason: 'sandbox_no_data' };

  const toolSchemas = normalizeToolSchemas(sandboxResult.data.tools || []);
  if (toolSchemas.length === 0) return { skipped: true, reason: 'sandbox_no_tools' };
  const tools = toolSchemas.map(t => t.name);
  await svc.from('servers').update({
    tools,
    tool_schemas: toolSchemas,
    resources: normalizeResources(sandboxResult.data.resources || []),
    prompts: normalizePrompts(sandboxResult.data.prompts || []),
    mcp_compliant: true,
    protocol_version: '2024-11-05',
    tool_extraction_source: 'sandbox',
    schema_hash: schemaHash({
      tools,
      version: server.version,
      endpoint: server.endpoint,
      github_url: server.github_url,
    }),
    last_scanned_at: new Date().toISOString(),
  }).eq('id', server.id);
  return { tools: tools.length, source: 'sandbox' };
}

async function runReadmeJob(svc: any, server: any) {
  if (!server.github_url) return { skipped: true, reason: 'missing_github_url' };
  const [description, schemas] = await Promise.all([
    parseReadmeDescription(server.github_url),
    parseReadmeSchemas(server.github_url),
  ]);
  const patch: Record<string, any> = {};
  if (description?.description) {
    patch.description = description.description;
    patch.long_description = description.long_description ?? server.long_description ?? null;
    patch.readme_url = description.readme_url;
    patch.description_quality = 'readme_parsed';
  }
  const toolSchemas = normalizeToolSchemas(schemas);
  if ((server.tool_schemas?.length ?? 0) === 0 && toolSchemas.length > 0) {
    const tools = toolSchemas.map(t => t.name);
    patch.tools = tools;
    patch.tool_schemas = toolSchemas;
    patch.tool_extraction_source = 'readme_parsed';
    patch.schema_hash = schemaHash({
      tools,
      version: server.version,
      endpoint: server.endpoint,
      github_url: server.github_url,
    });
  }
  if (Object.keys(patch).length === 0) return { skipped: true, reason: 'no_readme_data' };
  await svc.from('servers').update(patch).eq('id', server.id);
  return { updated: Object.keys(patch) };
}

async function runCveJob(svc: any, server: any) {
  if (!server.github_url) return { skipped: true, reason: 'missing_github_url' };
  const cveIssues = await scanNpmDependencies(server.github_url);
  const hasCritical = cveIssues.some((i: any) => i.severity === 'critical');
  const hasHigh = cveIssues.some((i: any) => i.severity === 'high');
  const scanIssues = cveIssues.map((issue: any) => ({
    severity: issue.severity,
    type: 'cve',
    description: `${issue.name}@${issue.version} flagged ${issue.cve}`,
    cve: issue.cve,
    url: issue.url,
  }));
  const status = hasCritical || hasHigh ? 'pending_review' : server.status;
  await svc.from('servers').update({
    status,
    scan_status: hasCritical || hasHigh ? 'failed' : 'passed',
    scan_issues: scanIssues,
    cve_issues: cveIssues,
    cve_scan_at: new Date().toISOString(),
  }).eq('id', server.id);
  await svc.from('scan_results').insert({
    server_id: server.id,
    scan_type: 'ingest',
    passed: !(hasCritical || hasHigh),
    score: hasCritical ? 0 : hasHigh ? 50 : 100,
    issues: cveIssues,
    details: `Async CVE scan issues:${cveIssues.length}`,
  });
  return { cves: cveIssues.length, status };
}

async function runOneJob(svc: any, job: any) {
  const { data: server, error } = await svc
    .from('servers')
    .select('id, name, status, endpoint, transport, github_url, smithery_id, package_info, tools, tool_schemas, version, description, long_description')
    .eq('id', job.server_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!server) return { skipped: true, reason: 'server_missing' };
  if (server.status === 'suspended') return { skipped: true, reason: 'server_suspended' };

  if (job.job_type === 'probe') return runProbeJob(svc, server);
  if (job.job_type === 'sandbox') return runSandboxJob(svc, server);
  if (job.job_type === 'readme_enrich') return runReadmeJob(svc, server);
  if (job.job_type === 'cve_scan') return runCveJob(svc, server);
  return { skipped: true, reason: 'unknown_job_type' };
}

export async function processServerJobs(svc: any, limit = 10) {
  const results = { checked: 0, succeeded: 0, failed: 0, skipped: 0 };
  const { data: jobs, error } = await svc
    .from('server_processing_jobs')
    .select('*')
    .eq('status', 'queued')
    .lte('run_after', new Date().toISOString())
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) return { error: error.message };

  for (const job of jobs ?? []) {
    results.checked++;
    await markJob(svc, job.id, {
      status: 'running',
      locked_at: new Date().toISOString(),
      attempts: (job.attempts ?? 0) + 1,
    });
    try {
      const result = await runOneJob(svc, job);
      const skipped = Boolean((result as any).skipped);
      await markJob(svc, job.id, {
        status: skipped ? 'success' : 'success',
        result,
        locked_at: null,
        last_error: null,
      });
      if (skipped) results.skipped++;
      else results.succeeded++;
    } catch (err: any) {
      const attempts = (job.attempts ?? 0) + 1;
      const finalFailure = attempts >= 3;
      await markJob(svc, job.id, {
        status: finalFailure ? 'failed' : 'queued',
        locked_at: null,
        last_error: err?.message ?? String(err),
        run_after: new Date(Date.now() + Math.min(60, attempts * attempts * 10) * 1000).toISOString(),
      });
      results.failed++;
    }
  }

  return { ...results, timestamp: new Date().toISOString() };
}
