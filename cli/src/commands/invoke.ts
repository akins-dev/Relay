/**
 * invoke.ts — `relay invoke <server> <tool> --json '{...}'`
 *
 * Calls invokeTool() — the shared runtime function.
 * This is the CLI adapter over the same runtime used by `relay serve`.
 */

import type { Command } from 'commander';
import { invokeTool } from '../runtime/invoke-tool.js';
import { writeResult, writeError } from '../util/output.js';
import { EXIT, RelayError } from '../util/errors.js';

export function registerInvokeCommand(program: Command): void {
  program
    .command('invoke <server> <tool>')
    .description('Invoke a tool on an MCP server (local subprocess or remote)')
    .option('--json <args>', 'Tool arguments as JSON string', '{}')
    .option('--timeout <ms>', 'Timeout in milliseconds', '30000')
    .action(async (server: string, tool: string, opts: { json: string; timeout: string }) => {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(opts.json);
      } catch {
        writeError(`Invalid JSON arguments: ${opts.json}`, { hint: 'Use --json \'{"key": "value"}\'' });
        process.exitCode = EXIT.USAGE;
        return;
      }

      const timeoutMs = parseInt(opts.timeout, 10) || 30_000;

      try {
        const result = await invokeTool({
          serverName: server,
          toolName: tool,
          args,
          timeoutMs,
        });

        writeResult(result);
        process.exitCode = result.success ? EXIT.OK : EXIT.ERROR;
      } catch (err: unknown) {
        if (err instanceof RelayError) {
          writeResult(err.toJSON());
          process.exitCode = err.exitCode;
        } else {
          writeError(err instanceof Error ? err.message : String(err));
          process.exitCode = EXIT.ERROR;
        }
      }
    });
}
