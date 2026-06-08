/**
 * search.ts — `relay search "<intent>"`
 *
 * Searches Relay Cloud for MCP servers matching an agent's intent.
 * Returns structured JSON with ranked results, tools, and manifests.
 */

import type { Command } from 'commander';
import { searchServers } from '../runtime/relay-client.js';
import { writeResult, writeError } from '../util/output.js';
import { EXIT, RelayError } from '../util/errors.js';

export function registerSearchCommand(program: Command): void {
  program
    .command('search <intent>')
    .description('Search for MCP servers and tools matching an intent')
    .option('-l, --limit <n>', 'Max results to return', '5')
    .option('--raw', 'Output raw API response without formatting')
    .action(async (intent: string, opts: { limit: string; raw: boolean }) => {
      try {
        const limit = Math.min(20, Math.max(1, parseInt(opts.limit, 10) || 5));
        const response = await searchServers(intent, limit);

        if (opts.raw) {
          writeResult(response);
          return;
        }

        // Format for agent consumption: compact, actionable results
        const formatted = {
          intent,
          intent_hash: response.intent_hash,
          result_count: response.results?.length ?? 0,
          results: (response.results ?? []).map((s) => ({
            name: s.name,
            description: s.description,
            confidence: s.confidence,
            run_mode: s.manifest?.run_mode ?? 'unknown',
            transport: s.transport,
            tools: s.tools?.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })) ?? [],
            total_tools: s.total_tools,
            env: s.manifest?.env?.filter((e) => e.required).map((e) => e.name) ?? [],
            next: s.manifest?.run_mode === 'discovery_only'
              ? s.manifest.cli.note
              : `relay invoke ${s.name} <tool_name> --json '{...}'`,
          })),
        };

        writeResult(formatted);
      } catch (err: unknown) {
        if (err instanceof RelayError) {
          writeError(err.message, err.details);
          process.exitCode = err.exitCode;
        } else {
          writeError(err instanceof Error ? err.message : String(err));
          process.exitCode = EXIT.ERROR;
        }
      }
    });
}
