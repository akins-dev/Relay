/**
 * Partner Server Fetcher
 *
 * Source: github.com/mcp organization — verified first-party integrations.
 * These are MCP servers published by companies like Stripe, GitHub, Atlassian, etc.
 *
 * DB source value: 'partner'  (canonical name throughout the codebase)
 * API alias:       'vendor'   (accepted by ingest/route.ts, normalized to 'partner')
 *
 * Note: All partner repos default to transport: 'unknown'. The pipeline's
 * detectTransport() + HTTP probe determines the real transport — some org repos
 * are remote-capable HTTPS servers, not stdio tools.
 */

import type { IngestServer } from './types';
import { slugify } from './helpers';
import { log } from '@/lib/logger';

const TAG = 'ingest:partner';

export async function fetchPartnerServers(): Promise<IngestServer[]> {
  const servers: IngestServer[] = [];

  const perPage = 100;
  let page = 1;

  while (true) {
    let repos: any[];
    try {
      const res = await fetch(`https://api.github.com/orgs/mcp/repos?per_page=${perPage}&page=${page}`, {
        headers: {
          'User-Agent': 'relay-ingest/2.0',
          'Accept': 'application/vnd.github.v3+json',
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        log.warn(TAG, `GitHub org API page ${page} returned ${res.status}`);
        break;
      }

      repos = await res.json();
    } catch (err) {
      log.error(TAG, `GitHub org API page ${page} fetch failed`, err);
      break;
    }

    if (!Array.isArray(repos) || repos.length === 0) break;

    for (const repo of repos) {
      if (repo.archived || repo.disabled) continue;

      const name = slugify(repo.name);
      if (!name) continue;

      servers.push({
        name,
        display_name:  repo.name,
        description:   repo.description || `Partner MCP server: ${repo.name}`,
        endpoint:      null,
        version:       null,
        github_url:    repo.html_url,
        homepage_url:  repo.homepage || null,
        license:       repo.license?.spdx_id || null,
        tags:          ['partner', 'official'],
        tools:         [],
        tool_schemas:  [],
        tool_extraction_source: 'none',
        source:        'partner',
        source_id:     `mcp/${repo.name}`,
        verified:      true,
        // Default 'unknown' — not 'stdio'. Partner orgs include remote-capable servers
        // (Stripe, GitHub, etc.). Let detectTransport() + homepage probe determine the real
        // transport rather than assuming all org repos are CLI-only stdio tools.
        transport:     'unknown',
        upstream_updated_at: repo.updated_at ?? null,
        raw_upstream_json:   repo,
      });
    }

    log.info(TAG, `Page ${page} processed`, {
      itemsOnPage: repos.length,
      totalSoFar: servers.length,
    });

    if (repos.length < perPage) break;
    page++;
  }

  log.info(TAG, 'Fetch complete', { total: servers.length, pages: page });
  return servers;
}
