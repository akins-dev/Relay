export async function register() {
  // Validate that all required environment variables are set before the app boots.
  // This causes Next.js to crash safely and immediately if misconfigured!
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./lib/env');
  }
}
