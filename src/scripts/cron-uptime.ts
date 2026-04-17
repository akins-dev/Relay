import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { runUptimeCheck } from '../lib/cron/uptime';
async function main() {
  console.log('[cron] Starting uptime check...');
  const result = await runUptimeCheck();
  if ((result as any).error) {
    console.error('[cron] Error:', (result as any).error);
    process.exit(1);
  }
  console.log('[cron] Success:', result);
  process.exit(0);
}

main();
