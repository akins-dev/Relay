import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const enabled = process.env.NODE_ENV === 'production' ||
  process.env.NEXT_PUBLIC_SENTRY_ENABLE_DEV === 'true';

if (dsn && enabled) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,

    // Critical: capture all unhandled errors in proxy route and ingest pipeline
    // These are the routes where silent failures hide real bugs
    beforeSend(event, hint) {
      const err = hint?.originalException;
      const message = typeof err === 'object' && err !== null && 'message' in err
        ? String((err as any).message).toLowerCase()
        : '';
      // Always capture security-related errors regardless of sample rate
      if (message.includes('dlp') || message.includes('proxy') ||
          message.includes('vault') || message.includes('oauth')) {
        event.level = 'error';
      }
      return event;
    },
  });
}
