/**
 * Vendor / Partner Server Fetcher
 *
 * Fetches from the github.com/mcp organization — verified vendor implementations.
 * These are first-party integrations from companies like Stripe, GitHub, etc.
 */

import type { IngestServer } from './types';
import { slugify } from './helpers';
import { log } from '@/lib/logger';

const TAG = 'ingest:vendor';

export async function fetchVendorServers(): Promise<IngestServer[]> {
  const servers: IngestServer[] = [];

  let repos: any[];
  try {
    const res = await fetch('https://api.github.com/orgs/mcp/repos?per_page=100', {
      headers: {
        'User-Agent': 'relay-ingest/2.0',
        'Accept': 'application/vnd.github.v3+json',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      log.warn(TAG, `GitHub org API returned ${res.status}`);
      return [];
    }

    repos = await res.json();
  } catch (err) {
    log.error(TAG, 'GitHub org API fetch failed', err);
    return [];
  }

  for (const repo of repos) {
    if (repo.archived || repo.disabled) continue;

    const name = slugify(repo.name);
    if (!name) continue;

    servers.push({
      name,
      display_name:  repo.name,
      description:   repo.description || `Vendor MCP server: ${repo.name}`,
      endpoint:      '',
      version:       '1.0.0',
      github_url:    repo.html_url,
      homepage_url:  repo.homepage || null,
      license:       repo.license?.spdx_id || null,
      tags:          ['partner', 'official'],
      tools:         [],
      tool_schemas:  [],
      source:        'partner',
      source_id:     `mcp/${repo.name}`,
      verified:      true,
      transport:     'stdio',
      upstream_updated_at: repo.updated_at ?? null,
      raw_upstream_json:   repo,
    });
  }

  log.info(TAG, 'Fetch complete', { total: servers.length });
  return servers;
}
