/**
 * info.ts — `relay info <server>`
 *
 * Fetches and displays the full Relay manifest for a server.
 * This is the "inspect before running" step.
 */

import type { Command } from 'commander';
import { getServerManifest } from '../runtime/relay-client.js';
import { writeResult, writeError } from '../util/output.js';
import { EXIT, RelayError } from '../util/errors.js';

export function registerInfoCommand(program: Command): void {
  program
    .command('info <server>')
    .description('Get the full manifest for an MCP server (tools, env vars, launch plan)')
    .action(async (serverName: string) => {
      try {
        const data = await getServerManifest(serverName);

        writeResult({
          server: data.server,
          manifest: data.manifest,
          tools: data.tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
          hint: data.manifest.run_mode === 'local_stdio'
            ? `Run: relay invoke ${data.server.name} <tool_name> --json '{...}'`
            : data.manifest.run_mode === 'remote_mcp'
              ? `Run: relay invoke ${data.server.name} <tool_name> --json '{...}'`
              : data.manifest.cli.note,
        });
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
