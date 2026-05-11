import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { runResetDailyCalls } from '../lib/cron/reset-calls';
async function main() {
  console.log('[cron] Starting reset-daily-calls...');
  const result = await runResetDailyCalls();
  if (result.error) {
    console.error('[cron] Error:', result.error);
    process.exit(1);
  }
  console.log('[cron] Success:', result);
  process.exit(0);
}

main();
