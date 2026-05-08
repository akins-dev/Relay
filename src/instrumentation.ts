export async function register() {
  // Validate that all required environment variables are set before the app boots.
  // This causes Next.js to crash safely and immediately if misconfigured!
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./lib/env');
    
    // Keep startup fast by making network diagnostics opt-in during dev.
    // Run `npm run check:connections` for an explicit health check.
    if (process.env.NODE_ENV === 'development' && process.env.RUN_PRE_INGEST_CHECK_ON_BOOT === 'true') {
      const { runChecks } = await import('./scripts/pre-ingest-check');
      // Fire and forget — do not block the server boot
      runChecks(false, { strict: false }).catch(err => {
        console.error('Background connection check failed to execute:', err);
      });
    }
  }
}
