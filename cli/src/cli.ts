/**
 * cli.ts — Main entry point for the Relay CLI.
 *
 * @relay/cli — Runtime tool discovery for AI agents.
 *
 * Two adapters, one runtime:
 *   relay search / info / invoke  →  CLI adapter (for CLI-capable agents)
 *   relay serve                   →  MCP adapter (for MCP-native agents)
 *
 * Both call the same invokeTool() runtime function.
 */

import { Command } from 'commander';
import { RELAY_VERSION } from './util/config.js';
import { registerSearchCommand } from './commands/search.js';
import { registerInfoCommand } from './commands/info.js';
import { registerInvokeCommand } from './commands/invoke.js';
import { registerServeCommand } from './commands/serve.js';
import { registerBootstrapCommand } from './commands/bootstrap.js';

const program = new Command();

program
  .name('relay')
  .version(RELAY_VERSION)
  .description(
    'Runtime tool discovery for AI agents.\n\n' +
    'Relay discovers MCP servers by intent and invokes their tools locally.\n' +
    'Configure once, access the entire MCP ecosystem.\n\n' +
    'For MCP-native agents:  relay serve\n' +
    'For CLI-capable agents: relay search / relay invoke\n' +
    'For agent setup help:   relay bootstrap'
  );

registerSearchCommand(program);
registerInfoCommand(program);
registerInvokeCommand(program);
registerServeCommand(program);
registerBootstrapCommand(program);

program.parse(process.argv);
