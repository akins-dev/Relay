import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const enabled = process.env.NODE_ENV === 'production' ||
  process.env.NEXT_PUBLIC_SENTRY_ENABLE_DEV === 'true';

if (dsn && enabled) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
  });
}
