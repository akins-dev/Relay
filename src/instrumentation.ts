export async function register() {
  // Validate that all required environment variables are set before the app boots.
  // This causes Next.js to crash safely and immediately if misconfigured!
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./lib/env');
    
    // Run network diagnostics in the background on boot
    const { runChecks } = await import('./scripts/pre-ingest-check');
    // Fire and forget — do not block the server boot
    runChecks(false, { strict: false }).catch(err => {
      console.error('Background connection check failed to execute:', err);
    });
  }
}
