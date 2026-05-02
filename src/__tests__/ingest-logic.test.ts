jest.mock('dns/promises', () => ({
  lookup: jest.fn().mockResolvedValue([{ address: '185.199.108.133', family: 4 }]),
}));

import { parseGitHubUrl, resolveSafeRedirectUrl } from '../lib/utils';
import { buildSandboxCommand, detectTransport, fetchVendorServers, parseReadmeDescription, resolveSmitheryConnection } from '../lib/ingest';

describe('ingest hardening logic', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  test('parseGitHubUrl handles subdirectory tree URLs', () => {
    expect(parseGitHubUrl('https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem')).toEqual({
      owner: 'modelcontextprotocol',
      repo: 'servers',
      branch: 'main',
      subpath: 'src/filesystem',
    });
  });

  test('detectTransport avoids forcing generic HTTP endpoints into SSE', () => {
    expect(detectTransport('https://example.com')).toBe('unknown');
    expect(detectTransport('https://example.com/sse')).toBe('sse');
    expect(detectTransport('https://example.com/mcp')).toBe('streamable_http');
  });

  test('parseReadmeDescription prefers subdirectory README for monorepo GitHub URLs', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/src/filesystem/README.md')) {
        return {
          ok: true,
          text: async () => '# Filesystem\n\nRead and write files safely from MCP.',
        } as any;
      }
      return { ok: false } as any;
    }) as any;

    const result = await parseReadmeDescription(
      'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem'
    );

    expect(result?.description).toContain('Read and write files safely');
    expect(result?.readme_url).toContain('/src/filesystem/README.md');
  });

  test('buildSandboxCommand only derives commands for smithery-backed stdio servers', () => {
    expect(buildSandboxCommand({ smithery_id: 'agenttrust/mcp-server' })).toEqual({
      command: 'npx',
      args: ['-y', '@smithery/cli@latest', 'run', 'agenttrust/mcp-server'],
    });

    expect(buildSandboxCommand({
      github_url: 'https://github.com/agenttrust/mcp-server',
    })).toBeNull();
  });

  test('resolveSmitheryConnection prefers a remote HTTP connection over a leading stdio connection', () => {
    expect(resolveSmitheryConnection([
      { type: 'stdio' },
      { type: 'streamable-http', url: 'https://contextstudios.example.com/mcp' },
    ])).toEqual({
      endpoint: 'https://contextstudios.example.com/mcp',
      transport: 'streamable_http',
    });
  });

  test('resolveSafeRedirectUrl allows safe relative redirects against the upstream base', async () => {
    await expect(
      resolveSafeRedirectUrl('/messages?session=abc', 'https://example.com/sse')
    ).resolves.toBe('https://example.com/messages?session=abc');
  });

  test('fetchVendorServers paginates through multiple GitHub org repo pages', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('page=1')) {
        return {
          ok: true,
          json: async () => Array.from({ length: 100 }, (_, i) => ({
            name: `repo-${i + 1}`,
            description: `Repo ${i + 1}`,
            html_url: `https://github.com/mcp/repo-${i + 1}`,
            homepage: null,
            license: { spdx_id: 'MIT' },
            updated_at: '2026-05-01T00:00:00Z',
          })),
        } as any;
      }
      if (url.includes('page=2')) {
        return {
          ok: true,
          json: async () => ([
            {
              name: 'repo-101',
              description: 'Repo 101',
              html_url: 'https://github.com/mcp/repo-101',
              homepage: null,
              license: { spdx_id: 'Apache-2.0' },
              updated_at: '2026-05-01T00:00:00Z',
            },
          ]),
        } as any;
      }
      return { ok: true, json: async () => [] } as any;
    }) as any;

    const result = await fetchVendorServers();

    expect(result).toHaveLength(101);
    expect(result[0]?.source).toBe('partner');
    expect(result[100]?.name).toBe('repo-101');
  });
});
