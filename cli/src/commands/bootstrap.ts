/**
 * bootstrap.ts — `relay bootstrap`
 *
 * Outputs a compact agent instruction block.
 * Solves the bootstrap problem: "How does the agent know to call Relay?"
 *
 * Usage:
 *   relay bootstrap          # CLI agent system prompt
 *   relay bootstrap --mcp    # MCP config JSON snippet
 *   relay bootstrap --env    # Show env var documentation
 */

import type { Command } from 'commander';
import { getConfig, RELAY_VERSION } from '../util/config.js';

const CLI_BOOTSTRAP = `You have access to the \`relay\` command for discovering and using MCP tools at runtime.

Commands:
  relay search "<intent>"                    — find servers and tools for a task
  relay info <server>                        — inspect a server's manifest, tools, and env requirements
  relay invoke <server> <tool> --json '{}'   — run a tool locally

Rules:
  1. Before attempting any external action (send email, query database, create issue, call API), run \`relay search\` first.
  2. Use the returned inputSchema exactly. Do not guess tool names or arguments.
  3. For knowledge, reasoning, or calculation tasks, answer directly without searching.
  4. Never put credentials in command arguments. Set them as environment variables.
  5. If invoke fails with missing env vars, tell the user which variables to set.`;

function getMcpConfig(): string {
  return JSON.stringify({
    mcpServers: {
      relay: {
        command: 'relay',
        args: ['serve'],
      },
    },
  }, null, 2);
}

function getEnvDocs(): string {
  const config = getConfig();
  return [
    'Relay CLI Environment Variables',
    '',
    'RELAY_API_URL',
    `  Current: ${config.apiBase}`,
    '  Purpose: Relay Cloud base URL',
    '  Default: https://relay.dev',
    '',
    'RELAY_API_KEY',
    `  Current: ${config.apiKey ? '(set)' : '(not set)'}`,
    '  Purpose: API key for higher rate limits',
    '  Default: none (anonymous access with lower limits)',
    '',
    'All other environment variables (GITHUB_TOKEN, SENDGRID_API_KEY, etc.)',
    'are resolved from your environment by the downstream MCP server subprocess.',
    'Relay does not manage or store these — it passes your environment through.',
  ].join('\n');
}

export function registerBootstrapCommand(program: Command): void {
  program
    .command('bootstrap')
    .description('Output agent configuration instructions')
    .option('--mcp', 'Output MCP server config JSON for agent hosts')
    .option('--env', 'Show environment variable documentation')
    .action((opts: { mcp?: boolean; env?: boolean }) => {
      if (opts.mcp) {
        process.stdout.write(getMcpConfig() + '\n');
      } else if (opts.env) {
        process.stdout.write(getEnvDocs() + '\n');
      } else {
        process.stdout.write(CLI_BOOTSTRAP + '\n');
      }
    });
}
