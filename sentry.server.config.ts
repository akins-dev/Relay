import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Critical: capture all unhandled errors in proxy route and ingest pipeline
  // These are the routes where silent failures hide real bugs
  beforeSend(event, hint) {
    const err = hint?.originalException as any;
    // Always capture security-related errors regardless of sample rate
    if (err?.message?.includes('DLP') || err?.message?.includes('proxy') ||
        err?.message?.includes('vault') || err?.message?.includes('oauth')) {
      event.level = 'error';
    }
    return event;
  },
});
