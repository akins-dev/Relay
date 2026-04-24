import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { runIngest } from '../lib/cron/ingest';
async function main() {
  const args = process.argv.slice(2);
  const allowedSources = ['all', 'official', 'smithery', 'glama', 'pulsemcp', 'github', 'partner', 'claudemcp', 'mcpso', 'mcp_run', 'composio', 'vendor'] as const;
  
  let source: typeof allowedSources[number] = 'all';
  if (args[0] && allowedSources.includes(args[0] as any)) {
    source = args[0] as any;
  }

  console.log(`[cron] Starting ingest for source: ${source}...`);
  const result = await runIngest(source);
  
  if (result.error) {
    console.error('[cron] Ingest Error:', result.error);
    process.exit(1);
  }
  
  console.log('[cron] Ingest Success:', JSON.stringify(result.total, null, 2));
  process.exit(0);
}

main();
