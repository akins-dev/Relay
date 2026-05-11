/**
 * serve.ts — `relay serve`
 *
 * Starts the local stdio MCP server.
 * Agent hosts configure this as:
 *   { "command": "relay", "args": ["serve"] }
 */

import type { Command } from 'commander';
import { startMcpServer } from '../serve/mcp-server.js';

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start Relay as a local MCP server (stdio). Agent hosts connect here.')
    .action(() => {
      startMcpServer();
    });
}
