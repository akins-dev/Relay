/**
 * Ingest Helpers
 *
 * Shared utility functions used across all ingest modules.
 */

import { isSafeUrl, isSafeUrlForServerFetch, parseGitHubUrl } from '@/lib/utils';

// Re-export utils that ingest modules need
export { isSafeUrl, isSafeUrlForServerFetch, parseGitHubUrl };

/**
 * Slugify a name into a URL-safe, lowercase, hyphen-separated string.
 * Max 64 characters. Handles reverse-DNS names (org/name → org-name).
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[@/]/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

/**
 * Detect transport from an endpoint URL.
 * Used as a fallback when upstream doesn't declare transport type.
 */
export function detectTransport(
  endpoint: string,
  githubUrl?: string | null
): 'stdio' | 'sse' | 'streamable_http' | 'unknown' {
  if (!endpoint) {
    return githubUrl ? 'stdio' : 'unknown';
  }

  const e = endpoint.toLowerCase().trim();

  if (e.startsWith('https://') || e.startsWith('http://')) {
    // GitHub repo URLs masquerading as endpoints
    if (e.includes('github.com/') && !e.includes('/api/') && !e.includes('/sse')) {
      return 'stdio';
    }
    if (e.includes('/sse') || e.includes('/events')) return 'sse';
    if (e.includes('/mcp') || e.includes('/stream')) return 'streamable_http';
    return 'unknown';
  }

  // Local process indicators
  if (
    e.startsWith('npx ') || e.startsWith('node ') || e.startsWith('python') ||
    e.startsWith('uvx ') || e.startsWith('cargo ') || e.startsWith('/') ||
    e.endsWith('.js') || e.endsWith('.py') || e.endsWith('.ts')
  ) {
    return 'stdio';
  }

  if (e.includes('github.com')) return 'stdio';

  return 'unknown';
}

/**
 * Build candidate raw GitHub URLs for a file across branches and subpaths.
 */
export function buildGitHubRawCandidates(githubUrl: string, filenames: string[]): string[] {
  const parts = parseGitHubUrl(githubUrl);
  if (!parts) return [];

  const branches = parts.branch ? [parts.branch, 'main', 'master'] : ['main', 'master'];
  const subpaths = parts.subpath ? [parts.subpath, null] : [null];
  const urls: string[] = [];

  for (const branch of branches) {
    for (const subpath of subpaths) {
      for (const filename of filenames) {
        const cleanSubpath = subpath?.replace(/^\/+|\/+$/g, '');
        const path = cleanSubpath ? `${cleanSubpath}/${filename}` : filename;
        urls.push(`https://raw.githubusercontent.com/${parts.owner}/${parts.repo}/${branch}/${path}`);
      }
    }
  }

  return [...new Set(urls)];
}

/**
 * Fetch the first available text file from GitHub raw URLs.
 */
export async function fetchFirstGithubText(githubUrl: string, filenames: string[]): Promise<string | null> {
  for (const rawUrl of buildGitHubRawCandidates(githubUrl, filenames)) {
    if (!(await isSafeUrlForServerFetch(rawUrl))) continue;
    try {
      const res = await fetch(rawUrl, {
        headers: { 'User-Agent': 'relay-ingest/2.0' },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) return await res.text();
    } catch {
      // Try next candidate
    }
  }
  return null;
}

/**
 * Parse tool schemas from a GitHub README using regex patterns.
 * Returns partial ToolSchema objects (name + description, no inputSchema).
 *
 * Known limitation: regex-based extraction is heuristic, not authoritative.
 * This is used only as a fallback when live MCP probe fails.
 */
export async function parseReadmeSchemas(githubUrl: string): Promise<Array<{ name: string; description?: string }>> {
  try {
    const text = await fetchFirstGithubText(githubUrl, ['README.md', 'readme.md']);
    if (!text) return [];

    const tools: Array<{ name: string; description?: string }> = [];
    const seen = new Set<string>();

    // Pattern 1: markdown table rows
    const tableRow = /\|\s*`?([a-z][a-z0-9_]{2,40})`?\s*\|\s*([^|\n]+)/g;
    let m;
    while ((m = tableRow.exec(text)) !== null) {
      const name = m[1].trim();
      const desc = m[2].trim();
      if (!seen.has(name) && /^[a-z][a-z0-9_]+$/.test(name)) {
        seen.add(name);
        tools.push({ name, description: desc });
      }
    }

    // Pattern 2: h3/h4 headings with tool-like names
    const heading = /^#{2,4}\s+`?([a-z][a-z0-9_]{2,40})`?/gm;
    while ((m = heading.exec(text)) !== null) {
      const name = m[1].trim();
      if (!seen.has(name) && /^[a-z][a-z0-9_]+$/.test(name)) {
        seen.add(name);
        const afterHeading = text.slice(m.index + m[0].length, m.index + m[0].length + 200);
        const desc = afterHeading.split('\n').find(l => l.trim().length > 10)?.trim() ?? '';
        tools.push({ name, description: desc });
      }
    }

    // Pattern 3: bullet points with tool names
    const bullet = /^-\s+`([a-z][a-z0-9_]{2,40})`[:\s]+(.+)$/gm;
    while ((m = bullet.exec(text)) !== null) {
      const name = m[1].trim();
      if (!seen.has(name)) {
        seen.add(name);
        tools.push({ name, description: m[2].trim() });
      }
    }

    return tools.slice(0, 50);
  } catch {
    return [];
  }
}

/**
 * Parse a README for description text.
 * Returns the first meaningful paragraph as description + a longer excerpt.
 */
export async function parseReadmeDescription(githubUrl: string): Promise<{
  description: string | null;
  long_description: string | null;
  readme_url: string;
} | null> {
  try {
    let text: string | null = null;
    let readmeUrl = '';

    for (const candidate of buildGitHubRawCandidates(githubUrl, ['README.md', 'readme.md'])) {
      readmeUrl = candidate;
      if (!(await isSafeUrlForServerFetch(readmeUrl))) continue;
      try {
        const res = await fetch(readmeUrl, {
          headers: { 'User-Agent': 'relay-ingest/2.0' },
          signal: AbortSignal.timeout(8_000),
        });
        if (res.ok) { text = await res.text(); break; }
      } catch {
        // Try next candidate
      }
    }
    if (!text) return null;

    const paragraphs = text.split('\n\n')
      .map(p => p.replace(/^#+\s+.*/gm, '').replace(/!\[.*?\]\(.*?\)/g, '').replace(/\[(.+?)\]\(.+?\)/g, '$1').trim())
      .filter(p => p.length >= 30 && !p.startsWith('```'));

    const description = paragraphs[0]?.slice(0, 300) ?? null;
    const long_description = paragraphs.slice(0, 5).join('\n\n').slice(0, 2000) ?? null;

    return { description, long_description, readme_url: readmeUrl };
  } catch {
    return null;
  }
}

/**
 * Human-readable relative time for logging.
 */
export function agoStr(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}
