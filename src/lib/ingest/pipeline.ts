/**
 * Ingest Pipeline — Upsert + Enrichment
 *
 * The core upsert pipeline that takes IngestServer[] from any source
 * and writes them into the database. Handles:
 *   - Deduplication (by source_id, github_url, endpoint, name)
 *   - Three-tier skip algorithm (timestamp → hash → full pipeline)
 *   - MCP probe for HTTP servers
 *   - README fallback for stdio servers
 *   - CVE scanning
 *   - Trust scoring
 *   - Connection profile writing (Option B side table)
 */

import { createHash } from 'crypto';
import type { IngestServer, IngestResult } from './types';
import {
  isSafeUrl, detectTransport, parseReadmeSchemas,
  parseReadmeDescription, agoStr,
} from './helpers';
import { computeTrustScore, scanNpmDependencies } from '@/lib/security';
import { fetchMCPPrimitives, buildSandboxCommand } from './legacy-bridge';
import { log } from '@/lib/logger';

const TAG = 'ingest:pipeline';

export async function upsertServers(
  servers: IngestServer[],
  svc: any
): Promise<IngestResult> {
  const result: IngestResult = {
    added: 0, updated: 0, rejected: 0, skipped: 0, errors: [],
    extraction_metrics: {
      sandbox_attempts: 0, sandbox_success: 0,
      readme_fallback_attempts: 0, unresolved_stdio_rows: 0,
    },
  };

  const skipReasons: Record<string, number> = {};
  const sourceStart = Date.now();

  // Resolve system author_id
  const { data: systemProfile } = await svc
    .from('profiles').select('id').limit(1).maybeSingle();
  const systemAuthorId: string | null = systemProfile?.id ?? null;

  if (!systemAuthorId) {
    log.warn(TAG, 'No system profile found — new servers will lack author_id');
  }

  // Batch pre-fetch existing servers (eliminates N+1 lookups)
  const { data: allExisting, error: prefetchErr } = await svc
    .from('servers')
    .select('id, name, source, endpoint, schema_hash, smithery_id, official_id, glama_id, github_url, last_scanned_at, upstream_updated_at');

  if (prefetchErr) {
    log.error(TAG, 'Pre-fetch failed — treating all as new', prefetchErr);
  }

  // Build lookup indexes
  const existingByName     = new Map<string, any>();
  const existingBySmithery = new Map<string, any>();
  const existingByOfficial = new Map<string, any>();
  const existingByGlama    = new Map<string, any>();
  const existingByGithub   = new Map<string, any>();
  const existingByEndpoint = new Map<string, any>();

  for (const row of allExisting ?? []) {
    if (row.name)        existingByName.set(row.name, row);
    if (row.smithery_id) existingBySmithery.set(row.smithery_id, row);
    if (row.official_id) existingByOfficial.set(row.official_id, row);
    if (row.glama_id)    existingByGlama.set(row.glama_id, row);
    if (row.github_url)  existingByGithub.set(row.github_url.replace(/\.git$/, '').toLowerCase(), row);
    if (row.endpoint)    existingByEndpoint.set(row.endpoint.replace(/\/$/, '').toLowerCase(), row);
  }

  log.info(TAG, `Pre-fetched ${existingByName.size} existing. Processing ${servers.length} incoming.`);

  const scannedRepos = new Map<string, any[]>();

  for (let idx = 0; idx < servers.length; idx++) {
    const s = servers[idx];
    try {
      // Guard: name required
      if (!s.name || !/^[a-z0-9-]+$/.test(s.name)) {
        result.skipped++;
        skipReasons['invalid_name'] = (skipReasons['invalid_name'] ?? 0) + 1;
        continue;
      }

      // SSRF protection
      if (s.endpoint && !isSafeUrl(s.endpoint)) {
        result.skipped++;
        skipReasons['unsafe_url'] = (skipReasons['unsafe_url'] ?? 0) + 1;
        continue;
      }

      // Transport classification
      const detected = detectTransport(s.endpoint, s.github_url);
      let transport = (s.transport === 'stdio' || detected === 'stdio')
        ? 'stdio'
        : (s.transport && s.transport !== 'unknown' ? s.transport : detected);
      let proxyAvailable = transport !== 'stdio' && Boolean(s.endpoint);

      // Skip if genuinely nothing to store
      if (!s.endpoint && !s.github_url && transport === 'stdio') {
        result.skipped++;
        skipReasons['stdio_no_source'] = (skipReasons['stdio_no_source'] ?? 0) + 1;
        continue;
      }

      // ── Lookup existing record ────────────────────────────────────────────
      let existing: any = null;
      if (s.smithery_id)  existing = existingBySmithery.get(s.smithery_id);
      if (!existing && s.official_id) existing = existingByOfficial.get(s.official_id);
      if (!existing && s.glama_id)    existing = existingByGlama.get(s.glama_id);
      if (!existing && s.github_url)  existing = existingByGithub.get(s.github_url.replace(/\.git$/, '').toLowerCase());
      if (!existing && s.endpoint)    existing = existingByEndpoint.get(s.endpoint.replace(/\/$/, '').toLowerCase());
      if (!existing)                  existing = existingByName.get(s.name);

      // ── TIER 1: Timestamp skip ────────────────────────────────────────────
      if (existing && s.upstream_updated_at && existing.last_scanned_at) {
        const upstreamMs = new Date(s.upstream_updated_at).getTime();
        const scannedMs  = new Date(existing.last_scanned_at).getTime();
        if (upstreamMs <= scannedMs) {
          result.skipped++;
          skipReasons['fresh'] = (skipReasons['fresh'] ?? 0) + 1;
          continue;
        }
      }

      // ── TIER 2: Hash skip ─────────────────────────────────────────────────
      const upstreamHash = createHash('sha256')
        .update([
          JSON.stringify(s.tools.slice().sort()),
          s.version ?? '', s.endpoint ?? '', s.github_url ?? '',
        ].join('|'))
        .digest('hex');

      const hoursSinceScan = existing?.last_scanned_at
        ? (Date.now() - new Date(existing.last_scanned_at).getTime()) / 3_600_000
        : Infinity;

      if (existing && existing.schema_hash === upstreamHash && hoursSinceScan < 24) {
        result.skipped++;
        skipReasons['unchanged'] = (skipReasons['unchanged'] ?? 0) + 1;
        continue;
      }

      // ── TIER 3: Full pipeline ─────────────────────────────────────────────

      let toolSchemas = s.tool_schemas ?? [];
      let mcpResources: any[] = [];
      let mcpPrompts: any[] = [];
      let protocolVersion: string | null = null;
      let mcpCompliant = false;

      if (proxyAvailable && s.endpoint) {
        const primitives = await fetchMCPPrimitives(s.endpoint, s.github_url ?? undefined);
        if (primitives.toolSchemas.length > 0 || toolSchemas.length === 0) {
          toolSchemas = primitives.toolSchemas;
        }
        mcpResources    = primitives.resources;
        mcpPrompts      = primitives.prompts;
        protocolVersion = primitives.protocolVersion;
        mcpCompliant    = primitives.mcpCompliant;
        if (primitives.transport !== 'unknown') {
          transport = primitives.transport;
          proxyAvailable = transport !== 'stdio' && Boolean(s.endpoint);
        }
      } else if (transport === 'stdio') {
        // Sandbox extraction attempt
        if (process.env.SANDBOX_URL && process.env.SANDBOX_AUTH_TOKEN && (s.github_url || s.smithery_id)) {
          const sandboxCommand = buildSandboxCommand(s);
          if (sandboxCommand) {
            result.extraction_metrics!.sandbox_attempts++;
            try {
              const req = await fetch(`${process.env.SANDBOX_URL}/extract`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${process.env.SANDBOX_AUTH_TOKEN}`,
                },
                body: JSON.stringify(sandboxCommand),
              });
              if (req.ok) {
                const sandboxResult = await req.json();
                if (sandboxResult.success && sandboxResult.data) {
                  result.extraction_metrics!.sandbox_success++;
                  toolSchemas = sandboxResult.data.tools || [];
                  mcpResources = sandboxResult.data.resources || [];
                  mcpPrompts = sandboxResult.data.prompts || [];
                  mcpCompliant = true;
                  protocolVersion = '2024-11-05';
                }
              }
            } catch (err) {
              log.warn(TAG, `Sandbox failed for ${s.name}`, err instanceof Error ? err : undefined);
            }
          }
        }

        // README fallback
        if (toolSchemas.length === 0 && s.github_url) {
          result.extraction_metrics!.readme_fallback_attempts++;
          toolSchemas = await parseReadmeSchemas(s.github_url);
        }
        if (toolSchemas.length === 0) {
          result.extraction_metrics!.unresolved_stdio_rows++;
        }
      }

      if (s.tools.length === 0 && toolSchemas.length > 0) {
        s.tools = toolSchemas.map(t => t.name);
      }

      // CVE scan (deduplicated by repo)
      const repoKey = s.github_url?.replace(/\.git$/, '').toLowerCase();
      let cveIssues: any[] = [];
      if (repoKey) {
        if (scannedRepos.has(repoKey)) {
          cveIssues = scannedRepos.get(repoKey)!;
        } else {
          cveIssues = await scanNpmDependencies(s.github_url!);
          scannedRepos.set(repoKey, cveIssues);
        }
      }

      const hasCriticalCve = cveIssues.some(i => i.severity === 'critical');
      if (hasCriticalCve) {
        log.warn(TAG, `Rejected ${s.name} — critical CVE`, {
          cve: cveIssues.find(i => i.severity === 'critical')?.cve,
        });
        result.rejected++;
        continue;
      }

      // Description enrichment
      let descriptionQuality = s.description_quality ?? 'upstream';
      let finalDescription   = s.description || s.display_name || 'No description provided';
      let finalLongDesc      = s.long_description ?? null;
      let readmeUrl          = s.readme_url ?? null;

      const needsEnrichment = !s.description || s.description.length < 20
        || s.description.startsWith('Official MCP reference server:')
        || s.description === 'No description provided';

      if (needsEnrichment && s.github_url && isSafeUrl(s.github_url)) {
        const readme = await parseReadmeDescription(s.github_url);
        if (readme?.description) {
          finalDescription   = readme.description;
          finalLongDesc      = readme.long_description ?? finalLongDesc;
          readmeUrl          = readme.readme_url;
          descriptionQuality = 'readme_parsed';
        } else {
          descriptionQuality = 'auto_generated';
        }
      }

      // Trust scoring
      if (s.source === 'partner' || s.source === 'official') s.verified = true;
      const hasHighSeverity = cveIssues.some(i => i.severity === 'high');
      const ingestScanScore = hasHighSeverity ? 50 : 100;

      const trustScore = computeTrustScore({
        verified:        s.verified ? 1 : 0,
        uptimePct:       100,
        stars:           (s.source === 'official' || s.source === 'partner') ? 50 : 0,
        daysSinceChange: (s.source === 'official' || s.source === 'partner') ? 90 : 0,
        scanScore:       ingestScanScore,
      });

      const status = hasHighSeverity ? 'pending_review' : 'active';

      const scanIssues = cveIssues.map((issue: any) => ({
        severity: issue.severity, type: 'cve',
        description: `${issue.name}@${issue.version} flagged ${issue.cve}`,
        cve: issue.cve, url: issue.url,
      }));

      // ── DB write ──────────────────────────────────────────────────────────
      const serverData: Record<string, any> = {
        name:              s.name,
        display_name:      s.display_name || s.name,
        description:       finalDescription,
        long_description:  finalLongDesc,
        description_quality: descriptionQuality,
        readme_url:        readmeUrl,
        version:           s.version || '0.0.0',
        endpoint:          s.endpoint || null,
        github_url:        s.github_url ?? null,
        homepage_url:      s.homepage_url ?? null,
        license:           s.license || null,
        tags:              s.tags.length > 0 ? s.tags : ['general'],
        tools:             s.tools,
        tool_schemas:      toolSchemas as any,
        resources:         mcpResources as any,
        prompts:           mcpPrompts as any,
        protocol_version:  protocolVersion,
        mcp_compliant:     mcpCompliant,
        proxy_available:   proxyAvailable,
        transport,
        source:            s.source,
        smithery_id:       s.smithery_id ?? null,
        official_id:       s.official_id ?? null,
        glama_id:          s.glama_id ?? null,
        verified:          s.verified ?? false,
        status,
        schema_hash:       upstreamHash,
        scan_status:       (hasHighSeverity ? 'failed' : 'passed') as any,
        scan_issues:       scanIssues as any,
        cve_issues:        cveIssues as any,
        cve_scan_at:       new Date().toISOString(),
        shell_issues:      [] as any,
        trust_score:       trustScore,
        last_scanned_at:   new Date().toISOString(),
        upstream_updated_at: s.upstream_updated_at ?? null,
      };

      let serverId: string | null = existing?.id ?? null;

      if (existing) {
        // Protect official/partner from generic overwrites
        if ((existing.source === 'partner' || existing.source === 'official')
            && s.source !== 'partner' && s.source !== 'official') {
          result.skipped++;
          continue;
        }

        const { error: updateErr } = await svc
          .from('servers').update(serverData).eq('id', existing.id);

        if (updateErr) {
          log.error(TAG, `Update failed for ${s.name}`, updateErr);
          result.errors.push(`${s.name}: update — ${updateErr.message}`);
          continue;
        }
        result.updated++;
      } else {
        const insertData: Record<string, any> = { ...serverData };
        if (systemAuthorId) insertData.author_id = systemAuthorId;

        const { data: upserted, error: upsertErr } = await svc
          .from('servers')
          .upsert(insertData, { onConflict: 'name', ignoreDuplicates: false })
          .select('id').maybeSingle();

        if (upsertErr) {
          const { data: raceWinner } = await svc
            .from('servers').select('id').eq('name', s.name).maybeSingle();
          if (raceWinner?.id) {
            serverId = raceWinner.id;
            result.updated++;
          } else {
            log.error(TAG, `Upsert failed for ${s.name}`, upsertErr);
            result.errors.push(`${s.name}: ${upsertErr.message}`);
            continue;
          }
        } else {
          serverId = upserted?.id ?? null;
          if (!serverId) {
            const { data: fallback } = await svc
              .from('servers').select('id').eq('name', s.name).maybeSingle();
            serverId = fallback?.id ?? null;
          }
          result.added++;
        }
      }

      // ── Write connection profile (Option B side table) ────────────────────
      if (serverId && s.raw_upstream_json) {
        svc.from('server_connection_profiles').upsert({
          server_id:         serverId,
          source:            s.source,
          source_id:         s.source_id ?? s.official_id ?? s.smithery_id ?? s.glama_id ?? null,
          raw_upstream_json: s.raw_upstream_json,
          remotes:           s.remotes ?? null,
          packages:          s.packages ?? null,
          icons:             s.icons ?? null,
          official_meta:     s.official_meta ?? null,
          publisher_meta:    s.publisher_meta ?? null,
          title:             s.title ?? null,
          website_url:       s.homepage_url ?? null,
          synced_at:         new Date().toISOString(),
        }, { onConflict: 'server_id,source' }).then(({ error }: any) => {
          if (error) log.warn(TAG, `Profile upsert failed for ${s.name}`, { error: error.message });
        });
      }

      // CVE audit trail
      if (serverId && cveIssues.length > 0) {
        svc.from('scan_results').insert({
          server_id: serverId, scan_type: 'ingest',
          passed: !hasHighSeverity, score: hasHighSeverity ? 50 : 100,
          issues: cveIssues as any,
          details: `Source:${s.source} cves:${cveIssues.length}`,
        }).then(({ error }: { error: any }) => {
          if (error) log.warn(TAG, `Scan audit failed for ${s.name}`, { error: error.message });
        });
      }

    } catch (err) {
      log.error(TAG, `Exception processing ${s.name ?? '?'}`, err);
      result.errors.push(`${s.name ?? '?'}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const elapsed = ((Date.now() - sourceStart) / 1000).toFixed(1);
  const skipDetail = Object.entries(skipReasons).map(([k, v]) => `${k}:${v}`).join(' ');
  log.info(TAG, `Done in ${elapsed}s`, {
    added: result.added, updated: result.updated,
    skipped: result.skipped, rejected: result.rejected,
    errors: result.errors.length, skipBreakdown: skipDetail || 'none',
  });

  return result;
}
