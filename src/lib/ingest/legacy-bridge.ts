/**
 * Legacy Bridge
 *
 * Bridges the new ingest/ modules to functions in the old ingest.ts
 * that still have production value (MCP probe, sandbox command).
 *
 * This file re-exports from the old module where needed.
 * As we migrate each function to the new modules, we remove it here.
 */

import type { IngestServer } from './types';
import type { ToolSchema } from './types';
import { probeMCPServer } from '@/lib/mcp-probe';
import { isSafeUrl } from '@/lib/utils';
import { parseReadmeSchemas } from './helpers';

// ── fetchMCPPrimitives — spec-compliant MCP probe ───────────────────────────

export async function fetchMCPPrimitives(endpoint: string, githubUrl?: string): Promise<{
  toolSchemas: ToolSchema[];
  resources:   Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
  prompts:     Array<{ name: string; description?: string }>;
  protocolVersion: string | null;
  mcpCompliant: boolean;
  transport: 'stdio' | 'sse' | 'streamable_http' | 'unknown';
}> {
  const empty = {
    toolSchemas: [] as ToolSchema[],
    resources: [] as any[],
    prompts: [] as any[],
    protocolVersion: null,
    mcpCompliant: false,
    transport: 'unknown' as const,
  };

  if (!endpoint || !isSafeUrl(endpoint)) {
    const toolSchemas = githubUrl ? await parseReadmeSchemas(githubUrl) : [];
    return { ...empty, toolSchemas };
  }

  const probe = await probeMCPServer(endpoint, 10_000);

  const toolSchemas: ToolSchema[] = probe.tools.map(t => ({
    name:        t.name,
    description: t.description ?? '',
    inputSchema: t.inputSchema ?? undefined,
  }));

  if (toolSchemas.length === 0 && githubUrl) {
    const readmeTools = await parseReadmeSchemas(githubUrl);
    return {
      toolSchemas:     readmeTools,
      resources:       probe.resources,
      prompts:         probe.prompts,
      protocolVersion: probe.protocolVersion,
      mcpCompliant:    probe.mcpCompliant,
      transport:       probe.transport,
    };
  }

  return {
    toolSchemas,
    resources:       probe.resources,
    prompts:         probe.prompts,
    protocolVersion: probe.protocolVersion,
    mcpCompliant:    probe.mcpCompliant,
    transport:       probe.transport,
  };
}

// ── buildSandboxCommand ─────────────────────────────────────────────────────

/**
 * Build a sandboxable CLI command to spawn an MCP stdio server for schema extraction.
 *
 * Strategy (in priority order):
 *   1. smithery_id present → use @smithery/cli (handles auth + npx internally)
 *   2. package_info npm entry → use npx -y <identifier>[@version]
 *      Only the Official registry provides package_info with npm identifiers.
 *   3. No executable path available → return null (fall back to README parsing)
 *
 * Only 'npx' commands are permitted by the sandbox ALLOWED_COMMANDS whitelist.
 * pypi/uvx packages are not yet supported (uvx not in whitelist).
 */
export function buildSandboxCommand(
  s: Pick<IngestServer, 'smithery_id' | 'github_url' | 'package_info'>
): { command: string; args: string[] } | null {
  // Priority 1: Smithery CLI (covers all smithery-sourced stdio servers)
  if (s.smithery_id) {
    return {
      command: 'npx',
      args: ['-y', '@smithery/cli@latest', 'run', s.smithery_id],
    };
  }

  // Priority 2: Official registry npm package_info
  // Only npm packages can be run via npx — pypi/uvx not yet in sandbox whitelist.
  const npmPkg = s.package_info?.find(
    p => p.registryType === 'npm' && typeof p.identifier === 'string' && p.identifier.length > 0
  );
  if (npmPkg) {
    const pkg = npmPkg.version
      ? `${npmPkg.identifier}@${npmPkg.version}`
      : npmPkg.identifier;
    return {
      command: 'npx',
      args: ['-y', pkg],
    };
  }

  // No executable strategy available
  return null;
}
