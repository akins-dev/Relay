jest.mock('dns/promises', () => ({
  lookup: jest.fn().mockResolvedValue([{ address: '185.199.108.133', family: 4 }]),
}));

import { parseGitHubUrl, resolveSafeRedirectUrl } from '../lib/utils';
import {
  buildSandboxCommand,
  detectTransport,
  parseReadmeDescription,
  resolveSmitheryTransport,
  upsertServers,
} from '../lib/ingest';

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

  test('buildSandboxCommand derives commands for supported stdio package sources', () => {
    expect(buildSandboxCommand({ smithery_id: 'agenttrust/mcp-server' })).toEqual({
      command: 'npx',
      args: ['-y', '@smithery/cli@latest', 'run', 'agenttrust/mcp-server'],
    });

    expect(buildSandboxCommand({
      package_info: [{ registryType: 'npm', identifier: '@modelcontextprotocol/server-filesystem', transport: 'stdio' }],
    })).toEqual({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
    });

    expect(buildSandboxCommand({
      package_info: [{ registryType: 'pypi', identifier: 'mcp-server-demo', version: '1.2.3', transport: 'stdio' }],
    })).toEqual({
      command: 'uvx',
      args: ['mcp-server-demo==1.2.3'],
    });

    expect(buildSandboxCommand({
      github_url: 'https://github.com/agenttrust/mcp-server',
    })).toBeNull();
  });

  test('resolveSmitheryTransport prefers a remote HTTP connection over a leading stdio connection', () => {
    expect(resolveSmitheryTransport([
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

  test('upsertServers skips primary-source rows that still have no tools after extraction', async () => {
    const writes: string[] = [];
    const svc = {
      from(table: string) {
        if (table === 'profiles') {
          return {
            select: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: { id: '00000000-0000-0000-0000-000000000001' }, error: null }),
              }),
            }),
          };
        }

        writes.push(table);
        throw new Error(`unexpected write/read on ${table}`);
      },
    };

    const result = await upsertServers([{
      name: 'empty-primary-server',
      display_name: 'Empty Primary Server',
      description: 'A listing with no tool metadata.',
      transport: 'streamable_http',
      endpoint: 'https://example.com/mcp',
      version: null,
      tools: [],
      tool_schemas: [],
      license: null,
      tags: ['test'],
      source: 'official',
      tool_extraction_source: 'none',
    }], svc, {
      mode: 'catalog',
      existingLookup: {
        byName: new Map(),
        bySmithery: new Map(),
        byOfficial: new Map(),
        byGlama: new Map(),
        byGithub: new Map(),
        byEndpoint: new Map(),
      },
    });

    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(writes).toEqual([]);
  });

  // fetchVendorServers / partner source removed — github.com/mcp org does not expose
  // a stable JSON API. The concept is replaced by the is_canonical DB field which
  // Smithery populates for its own curated servers.
});
