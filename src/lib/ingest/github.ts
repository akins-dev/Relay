/**
 * GitHub MCP Servers Fetcher
 *
 * Source: https://github.com/modelcontextprotocol/servers
 * API: GitHub Contents API — lists subdirectories under /src
 *
 * Each subdirectory is a reference MCP server implementation.
 * These are all stdio servers (local process, not HTTP).
 */

import type { IngestServer } from './types';
import { slugify } from './helpers';
import { log } from '@/lib/logger';

const TAG = 'ingest:github';

export async function fetchGitHubServers(): Promise<IngestServer[]> {
  const servers: IngestServer[] = [];

  let dirs: any[];
  try {
    const res = await fetch(
      'https://api.github.com/repos/modelcontextprotocol/servers/contents/src',
      {
        headers: {
          'User-Agent': 'relay-ingest/2.0',
          'Accept': 'application/vnd.github.v3+json',
        },
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!res.ok) {
      log.warn(TAG, `GitHub API returned ${res.status}`);
      return [];
    }

    dirs = await res.json();
  } catch (err) {
    log.error(TAG, 'GitHub API fetch failed', err);
    return [];
  }

  for (const dir of dirs) {
    if (dir.type !== 'dir') continue;
    const name = slugify(dir.name);
    if (!name) continue;

    // Try to fetch README for description
    let description = `Official MCP reference server: ${dir.name}`;
    try {
      const readmeRes = await fetch(
        `https://raw.githubusercontent.com/modelcontextprotocol/servers/main/src/${dir.name}/README.md`,
        {
          headers: { 'User-Agent': 'relay-ingest/2.0' },
          signal: AbortSignal.timeout(5_000),
        }
      );
      if (readmeRes.ok) {
        const readme = await readmeRes.text();
        // Extract first meaningful paragraph
        const paragraph = readme.split('\n\n')
          .map(p => p.replace(/^#+\s+.*/gm, '').replace(/!\[.*?\]\(.*?\)/g, '').replace(/\[(.+?)\]\(.+?\)/g, '$1').trim())
          .find(p => p.length >= 30 && !p.startsWith('```'));
        if (paragraph) description = paragraph.slice(0, 300);
      }
    } catch (err) {
      log.warn(TAG, `README fetch failed for ${dir.name}`, err instanceof Error ? err : undefined);
    }

    servers.push({
      name:          `mcp-${name}`,
      display_name:  dir.name.charAt(0).toUpperCase() + dir.name.slice(1),
      description,
      endpoint:      '',
      version:       '1.0.0',
      github_url:    `https://github.com/modelcontextprotocol/servers/tree/main/src/${dir.name}`,
      homepage_url:  null,
      license:       'MIT', // The modelcontextprotocol/servers repo is MIT
      tags:          ['official', 'reference'],
      tools:         [],
      tool_schemas:  [],
      source:        'github',
      source_id:     `modelcontextprotocol/servers/src/${dir.name}`,
      verified:      true,
      transport:     'stdio',
      upstream_updated_at: null,
      raw_upstream_json:   dir,
    });
  }

  log.info(TAG, 'Fetch complete', { total: servers.length });
  return servers;
}
