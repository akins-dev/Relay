import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { runSchemaDrift } from '../lib/cron/schema-drift';
async function main() {
  console.log('[cron] Starting schema-drift...');
  const result = await runSchemaDrift();
  if ((result as any).error) {
    console.error('[cron] Error:', (result as any).error);
    process.exit(1);
  }
  console.log('[cron] Success:', result);
  process.exit(0);
}

main();
