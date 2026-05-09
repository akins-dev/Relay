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
import type { IngestMode, IngestServer, IngestResult, EnvVarSpec } from './types';
import {
  isSafeUrl, detectTransport, parseReadmeSchemas,
  parseReadmeDescription, agoStr,
} from './helpers';
import { computeTrustScore, scanNpmDependencies } from '@/lib/security';
import { fetchMCPPrimitives, buildSandboxCommand } from './legacy-bridge';
import { log } from '@/lib/logger';
import { enqueueServerProcessingJobs } from '@/lib/processing-jobs';

const TAG = 'ingest:pipeline';

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

// ── Auth type derivation ──────────────────────────────────────────────────────
/**
 * Derive the auth_type for a server from structured upstream data.
 *
 * Priority:
 *   1. env_var_schema present → 'api_key'  (credentials required, injected by vault)
 *   2. official + HTTP + no creds → 'none'  (public API, no auth needed)
 *   3. official + stdio + no creds → 'none'  (public CLI tool)
 *   4. smithery + no creds → 'managed'  (Smithery auth layer handles it internally)
 *   5. default → 'managed'
 *
 * NOTE: This must NOT be derived from transport alone — a server can be HTTP and
 * still require no credentials (e.g. public weather APIs on the Official registry).
 */
function deriveAuthType(
  source: IngestServer['source'],
  _transport: string,
  envVarSchema: EnvVarSpec[] | null | undefined,
): 'none' | 'managed' | 'api_key' {
  const schema = envVarSchema || [];

  // OPTIMAL TRIGGER: Only require 'api_key' (setup flow) if:
  // 1. A variable is marked as secret (must be vaulted)
  // 2. A variable is marked as required (must be provided)
  // Otherwise, it's just optional config — don't block the user.
  const requiresSetup = schema.some(v => v.isSecret || v.isRequired);

  if (requiresSetup) return 'api_key';

  // Official registry: no credentials/required config = intentionally public
  if (source === 'official') return 'none';

  // Smithery-hosted servers: no configSchema = Smithery handles auth
  if (source === 'smithery') return 'managed';

  return 'managed';
}

export async function upsertServers(
  servers: IngestServer[],
  svc: any,
  options: { mode?: IngestMode } = {}
): Promise<IngestResult> {
  const mode = options.mode ?? 'full';
  const runHeavyChecks = mode === 'full';
  const result: IngestResult = {
    added: 0, updated: 0, rejected: 0, skipped: 0, errors: [],
    extraction_metrics: {
      smithery_detail_fetched:  0,
      smithery_detail_success:  0,
      smithery_rate_limited:    0,
      probe_attempts:           0,
      probe_success:            0,
      sandbox_attempts:         0,
      sandbox_success:          0,
      grade_a_complete:         0,
      grade_b_complete:         0,
    },
  };

  const skipReasons: Record<string, number> = {};
  const sourceStart = Date.now();
  // Collected profile upsert promises — awaited after the main loop (M4 fix).
  const profileUpserts: Promise<any>[] = [];

  // Resolve system author_id
  const { data: systemProfile } = await svc
    .from('profiles').select('id').limit(1).maybeSingle();
  const systemAuthorId: string | null = systemProfile?.id ?? null;

  if (!systemAuthorId) {
    log.warn(TAG, 'No system profile found — new servers will lack author_id');
  }

  // Batch pre-fetch existing servers (eliminates N+1 lookups)
  // NOTE: transport is included so the enrichment-path deriveAuthType call at line ~451
  // receives the real transport value, not undefined.
  const { data: allExisting, error: prefetchErr } = await svc
    .from('servers')
    .select('id, name, source, endpoint, schema_hash, transport, smithery_id, official_id, glama_id, github_url, last_scanned_at, upstream_updated_at');

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
      const detected = detectTransport(s.endpoint ?? '', s.github_url ?? undefined);
      let transport = (s.transport === 'stdio' || detected === 'stdio')
        ? 'stdio'
        : (s.transport && s.transport !== 'unknown' ? s.transport : detected);
      let proxyAvailable = transport !== 'stdio' && Boolean(s.endpoint);

      // Skip enrichment-only sources with no endpoint and no github_url
      // (glama, mcp_directory) — they are indexed for search but not probed
      const isEnrichmentOnly = s.source === 'glama' || s.source === 'mcp_directory';

      // Skip if genuinely nothing to store
      if (!isEnrichmentOnly && !s.endpoint && !s.github_url && transport === 'stdio') {
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

      // ── TIER 2: Hash skip ──────────────────────────────────────────────────────
      // NOTE: 'let' not 'const' — this is recomputed after probe/sandbox updates tools
      // so the stored schema_hash always matches what schema-drift cron will compute.
      let upstreamHash = createHash('sha256')
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

      let toolSchemas = normalizeToolSchemas(s.tool_schemas ?? []);
      let mcpResources: any[] = [];
      let mcpPrompts: any[] = [];
      let protocolVersion: string | null = null;
      let mcpCompliant = false;
      // Determine initial provenance label from upstream data.
      // This will be overwritten if probe/sandbox/readme produces better data.
      let toolExtractionSource: string = s.tool_extraction_source
        ?? (toolSchemas.length > 0
          ? 'upstream_schemas'
          : s.tools.length > 0
            ? 'upstream_names'
            : 'none');
      // Snapshot the upstream tool list separately so we never mutate s.tools
      // (the source object is shared; mutation would corrupt subsequent passes).
      let resolvedTools: string[] = [...s.tools];

      // Only probe HTTP servers that are not from enrichment-only sources
      if (runHeavyChecks && !isEnrichmentOnly && proxyAvailable && s.endpoint) {
        result.extraction_metrics!.probe_attempts++;
        const primitives = await fetchMCPPrimitives(s.endpoint, s.github_url ?? undefined);
        if (primitives.toolSchemas.length > 0) {
          result.extraction_metrics!.probe_success++;
        }
        if (primitives.toolSchemas.length > 0 || toolSchemas.length === 0) {
          toolSchemas = normalizeToolSchemas(primitives.toolSchemas);
        }
        if (primitives.toolSchemas.length > 0) {
          toolExtractionSource = 'mcp_probe';
        }
        mcpResources    = primitives.resources;
        mcpPrompts      = primitives.prompts;
        protocolVersion = primitives.protocolVersion;
        mcpCompliant    = primitives.mcpCompliant;
        if (primitives.transport !== 'unknown') {
          transport = primitives.transport;
          proxyAvailable = transport !== 'stdio' && Boolean(s.endpoint);
        }
      } else if (runHeavyChecks && !isEnrichmentOnly && transport === 'stdio') {
        // Sandbox extraction attempt
        if (process.env.SANDBOX_URL && process.env.SANDBOX_AUTH_TOKEN && (s.github_url || s.smithery_id || s.package_info)) {
          const sandboxCommand = buildSandboxCommand(s);
          if (sandboxCommand) {
            result.extraction_metrics!.sandbox_attempts++;
            let sandboxSucceeded = false;
            try {
              const req = await fetch(`${process.env.SANDBOX_URL}/extract`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${process.env.SANDBOX_AUTH_TOKEN}`,
                },
                body: JSON.stringify(sandboxCommand),
                // Hard cap: sandbox may cold-start on Render plus spend up to 180s
                // connecting while npx/uvx downloads the package on a cold container.
                // Without this, a hung sandbox blocks the entire ingest run indefinitely.
                signal: AbortSignal.timeout(Number(process.env.SANDBOX_EXTRACT_TIMEOUT_MS || 240_000)),
              });
              if (req.ok) {
                const sandboxResult = await req.json();
                if (sandboxResult.success && sandboxResult.data) {
                  result.extraction_metrics!.sandbox_success++;
                  toolSchemas = normalizeToolSchemas(sandboxResult.data.tools || []);
                  mcpResources = normalizeResources(sandboxResult.data.resources || []);
                  mcpPrompts = normalizePrompts(sandboxResult.data.prompts || []);
                  mcpCompliant = true;
                  protocolVersion = '2024-11-05';
                  toolExtractionSource = toolSchemas.length > 0 ? 'sandbox' : toolExtractionSource;
                  sandboxSucceeded = true;
                }
              }
            } catch (err) {
              // Sandbox timed out or network error — do NOT carry forward any partial
              // toolSchemas that may have been set. Reset to empty so README fallback
              // gets a clean slate rather than stale pre-sandbox data.
              toolSchemas = [];
              log.warn(TAG, `Sandbox failed for ${s.name}`, err instanceof Error ? err : undefined);
            }
            // If sandbox ran but returned no tools, clear any upstream placeholder schemas
            // so README parsing gets a fair shot rather than being blocked by empty shells.
            if (!sandboxSucceeded) toolSchemas = [];
          }
        }

        // README fallback — only if sandbox produced nothing
        if (toolSchemas.length === 0 && s.github_url) {
          toolSchemas = normalizeToolSchemas(await parseReadmeSchemas(s.github_url));
          if (toolSchemas.length > 0) {
            toolExtractionSource = 'readme_parsed';
          }
        }
      }

      // C2 fix: if no live source (probe/sandbox/readme) produced schemas AND the upstream
      // only had tool names (no schemas), keep 'upstream_names' as the source label.
      // But if we attempted a live probe and got nothing, downgrade 'upstream_schemas' to
      // 'upstream_names' if toolSchemas is now empty (probe may have cleared them).
      if (toolSchemas.length === 0 && toolExtractionSource === 'upstream_schemas') {
        toolExtractionSource = 'upstream_names';
      }

      // FAULT-02 fix: always sync resolvedTools from toolSchemas — not just when upstream was empty.
      // If probe/sandbox returns different/richer tool names than what upstream declared,
      // the DB must store the live-probed names so invoke_tool's tools.includes() check works.
      // C3 fix: write to resolvedTools (local copy), never mutate the original s.tools.
      if (toolSchemas.length > 0) {
        resolvedTools = toolSchemas.map(t => t.name);
      }

      // FAULT-05 fix: recompute hash AFTER tools are synced from probe/sandbox.
      // The schema-drift cron also hashes live-probed tool names — they must match.
      // If we stored the pre-probe hash, any probe-reordered tool list would trigger
      // a false drift alarm and suspend the server.
      upstreamHash = createHash('sha256')
        .update([
          JSON.stringify(resolvedTools.slice().sort()),
          s.version ?? '', s.endpoint ?? '', s.github_url ?? '',
        ].join('|'))
        .digest('hex');

      // CVE scan (deduplicated by repo)
      const repoKey = s.github_url?.replace(/\.git$/, '').toLowerCase();
      let cveIssues: any[] = [];
      if (runHeavyChecks && repoKey) {
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

      if (runHeavyChecks && needsEnrichment && s.github_url && isSafeUrl(s.github_url)) {
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

      // Trust scoring.
      // At ingest time there is no invoke history yet — invokeCount and successCount
      // are 0. The Bayesian prior in computeTrustScore gives a weak-positive floor
      // (~7.9 pts) rather than 0, which correctly signals "unproven, not bad."
      // The score grows as agents invoke this server via the proxy and
      // intent_server_mappings accumulates real success/failure data.
      const hasHighSeverity   = cveIssues.some(i => i.severity === 'high');
      const ingestScanScore   = hasHighSeverity ? 50 : 100;
      const hasEndpoint       = !!(s.endpoint);
      const hasRichSchemas    = toolSchemas.some((t: any) => t.inputSchema && Object.keys(t.inputSchema).length > 0);
      const deploymentQuality = (hasEndpoint && hasRichSchemas) ? 1 : 0;
      const schemaChangedAt   = existing?.schema_changed_at ?? null;
      const daysSinceChange   = schemaChangedAt
        ? Math.floor((Date.now() - new Date(schemaChangedAt).getTime()) / 86_400_000)
        : 0;

      const trustScore = computeTrustScore({
        verified:          s.verified ? 1 : 0,
        uptimePct:         100,
        invokeCount:       0,   // No invoke history at ingest; grows from intent_server_mappings
        successCount:      0,
        daysSinceChange,
        scanScore:         ingestScanScore,
        deploymentQuality,
      });

      const status = hasHighSeverity ? 'pending_review' : 'active';

      const scanIssues = cveIssues.map((issue: any) => ({
        severity: issue.severity, type: 'cve',
        description: `${issue.name}@${issue.version} flagged ${issue.cve}`,
        cve: issue.cve, url: issue.url,
      }));

      // ── DB write ──────────────────────────────────────────────────────────
      // Compute final env_var_schema (may have been enriched by sandbox/probe)
      const finalEnvVarSchema = s.env_var_schema ?? null;

      const serverData: Record<string, any> = {
        name:              s.name,
        display_name:      s.display_name || s.name,
        description:       finalDescription,
        long_description:  finalLongDesc,
        description_quality: descriptionQuality,
        readme_url:        readmeUrl,
        version:           s.version ?? null,
        endpoint:          s.endpoint ?? null,
        github_url:        s.github_url ?? null,
        homepage_url:      s.homepage_url ?? null,
        icon_url:          s.icon_url ?? null,
        // L3 fix: store null, not the string 'unknown' — let the DB NOT NULL default handle it.
        license:           s.license ?? null,
        tags:              s.tags.length > 0 ? s.tags : ['general'],
        tools:             resolvedTools,
        tool_schemas:      toolSchemas as any,
        tool_extraction_source: toolExtractionSource,
        resources:         (s.resources && s.resources.length > 0 ? s.resources : mcpResources) as any,
        prompts:           (s.prompts && s.prompts.length > 0 ? s.prompts : mcpPrompts) as any,
        env_var_schema:    finalEnvVarSchema,
        package_info:      s.package_info ?? null,
        protocol_version:  protocolVersion,
        mcp_compliant:     mcpCompliant,
        proxy_available:   proxyAvailable,
        transport,
        // Derive auth_type from structured upstream data — never rely on the DB default.
        // env_var_schema is already populated by all three primary sources (official/smithery/glama).
        auth_type:         deriveAuthType(s.source, transport, finalEnvVarSchema),
        source:            s.source,
        smithery_id:       s.smithery_id ?? null,
        official_id:       s.official_id ?? null,
        glama_id:          s.glama_id ?? null,
        mcp_directory_id:  s.mcp_directory_id ?? null,
        verified:          s.verified ?? false,
        status,
        schema_hash:       upstreamHash,
        scan_status:       (runHeavyChecks ? (hasHighSeverity ? 'failed' : 'passed') : 'pending') as any,
        scan_issues:       scanIssues as any,
        cve_issues:        cveIssues as any,
        ...(runHeavyChecks ? { cve_scan_at: new Date().toISOString() } : {}),
        shell_issues:      [] as any,
        trust_score:       trustScore,
        ...(runHeavyChecks ? { last_scanned_at: new Date().toISOString() } : {}),
        upstream_updated_at: s.upstream_updated_at ?? null,
        // is_canonical: true when Smithery itself built and hosts this server.
        // These are Smithery's own curated integrations — the definitive canonical
        // choice for their domain. Drives is_canonical DESC in search ranking.
        is_canonical:      s.by_smithery === true,
        // use_count stored for analytics and future trust score recalculations.
        use_count:         s.use_count ?? null,
      };

      let serverId: string | null = existing?.id ?? null;

      if (existing) {
        if (isEnrichmentOnly) {
          // ── Enrichment pass: Glama / mcp.directory ────────────────────────
          // These sources never have endpoints or tool_schemas.
          // We ONLY update fields they uniquely provide, and only when the
          // existing record has them null. Never overwrite primary source data.
          const enrichmentPatch: Record<string, any> = {};

          // Glama: license (SPDX), env_var_schema (JSON Schema), tags, glama_id
          if (s.source === 'glama') {
            if (s.license && (!existing.license || existing.license === 'unknown'))
              enrichmentPatch.license = s.license;
            if (s.env_var_schema && !existing.env_var_schema) {
              enrichmentPatch.env_var_schema = s.env_var_schema;
              // H1 fix: Only upgrade an existing record to 'api_key' auth_type if the
              // Glama env_var_schema has a variable that is BOTH isSecret AND isRequired.
              // The heuristic isSecret (name contains 'key'/'token') alone is not enough —
              // many servers have optional API keys. We must not block public servers.
              const requiresSetupForEnrichment = s.env_var_schema.some(
                v => (v.isSecret || v.isRequired) && v.isRequired,
              );
              if (requiresSetupForEnrichment) {
                enrichmentPatch.auth_type = deriveAuthType('glama', existing.transport, s.env_var_schema);
              }
            }
            // F10 fix: single-Set filter pass — only check new tags against existing set.
            // Avoids creating 3 intermediate objects (spread, Set, Array.from).
            if (s.tags.length > 0) {
              const existingTagSet = new Set(existing.tags ?? []);
              const addedTags = s.tags.filter((t: string) => !existingTagSet.has(t));
              if (addedTags.length > 0)
                enrichmentPatch.tags = [...(existing.tags ?? []), ...addedTags];
            }
            if (s.glama_id && !existing.glama_id)
              enrichmentPatch.glama_id = s.glama_id;
          }

          // mcp.directory: verified (upgrade only), icon_url (fallback), mcp_directory_id
          if (s.source === 'mcp_directory') {
            if (s.verified && !existing.verified)
              enrichmentPatch.verified = true;
            if (s.icon_url && !existing.icon_url)
              enrichmentPatch.icon_url = s.icon_url;
            if (s.mcp_directory_id && !existing.mcp_directory_id)
              enrichmentPatch.mcp_directory_id = s.mcp_directory_id;
            // F10 fix: same single-Set filter pass for mcp.directory tags
            if (s.tags.length > 0) {
              const existingTagSet = new Set(existing.tags ?? []);
              const addedTags = s.tags.filter((t: string) => !existingTagSet.has(t));
              if (addedTags.length > 0)
                enrichmentPatch.tags = [...(existing.tags ?? []), ...addedTags];
            }
          }

          if (Object.keys(enrichmentPatch).length > 0) {
            const { error: enrichErr } = await svc
              .from('servers').update(enrichmentPatch).eq('id', existing.id);
            if (enrichErr) {
              log.warn(TAG, `Enrichment update failed for ${s.name}`, { error: enrichErr.message });
            } else {
              result.updated++;
              serverId = existing.id;
            }
          } else {
            result.skipped++;
            skipReasons['enrichment_no_new_data'] = (skipReasons['enrichment_no_new_data'] ?? 0) + 1;
          }
          continue;
        }

        // ── Full update for primary sources ───────────────────────────────
        // Protect official/partner records from lower-priority source overwrites
        if (existing.source === 'official' && s.source !== 'official') {
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
      // M4 fix: collect profile upsert promises and await them after the main loop
      // rather than fire-and-forget. Fire-and-forget loses profiles on process exit.
      if (serverId && s.raw_upstream_json) {
        profileUpserts.push(
          svc.from('server_connection_profiles').upsert({
            server_id:         serverId,
            source:            s.source,
            source_id:         s.source_id ?? s.official_id ?? s.smithery_id ?? s.glama_id ?? s.mcp_directory_id ?? null,
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
          })
        );
      }

      if (!runHeavyChecks && serverId) {
        await enqueueServerProcessingJobs(svc, serverId, {
          endpoint: s.endpoint ?? null,
          transport,
          github_url: s.github_url ?? null,
          smithery_id: s.smithery_id ?? null,
          package_info: s.package_info ?? null,
          description: finalDescription,
          tool_extraction_source: toolExtractionSource,
        });
      }

      // CVE audit trail
      if (runHeavyChecks && serverId && cveIssues.length > 0) {
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

  // M4 fix: await all deferred profile upserts now that the main loop is done.
  // allSettled ensures one failed profile write doesn't abort the rest.
  if (profileUpserts.length > 0) {
    await Promise.allSettled(profileUpserts);
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
