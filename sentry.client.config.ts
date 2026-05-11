import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const enabled = process.env.NODE_ENV === 'production' ||
  process.env.NEXT_PUBLIC_SENTRY_ENABLE_DEV === 'true';

if (dsn && enabled) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,

    // Capture 10% of production transactions.
    tracesSampleRate: 0.1,

    // Session replay: 1% of sessions, 100% of sessions with errors
    replaysSessionSampleRate: 0.01,
    replaysOnErrorSampleRate: 1.0,

    // Reduce noise from browser extensions and unhandled promise rejections
    // that are not our code
    beforeSend(event) {
      // Drop events from browser extensions
      if (event.exception?.values?.[0]?.stacktrace?.frames?.some(
        f => f.filename?.includes('chrome-extension') || f.filename?.includes('moz-extension')
      )) return null;
      return event;
    },

    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,       // mask PII in session replays
        blockAllMedia: false,
      }),
    ],
  });
}
