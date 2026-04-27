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

export function buildSandboxCommand(s: Pick<IngestServer, 'smithery_id' | 'github_url'>): {
  command: string;
  args: string[];
} | null {
  if (s.smithery_id) {
    return {
      command: 'npx',
      args: ['-y', '@smithery/cli@latest', 'run', s.smithery_id],
    };
  }
  return null;
}
