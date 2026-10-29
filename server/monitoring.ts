import * as Sentry from '@sentry/node';

export function initializeErrorMonitoring(): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;

  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    defaultIntegrations: false,
    beforeSend(event) {
      delete event.request;
      delete event.user;
      delete event.contexts;
      delete event.extra;
      delete event.breadcrumbs;
      delete event.logentry;
      if (event.message) event.message = 'Server error';

      for (const exception of event.exception?.values ?? []) {
        exception.value = exception.type || 'Error';
        if (exception.stacktrace?.frames) {
          for (const frame of exception.stacktrace.frames) {
            delete frame.vars;
            delete frame.pre_context;
            delete frame.context_line;
            delete frame.post_context;
          }
        }
      }

      return event;
    },
  });
  return true;
}

export function captureServerError(error: unknown, component: string): void {
  if (!process.env.SENTRY_DSN) return;

  Sentry.withScope((scope) => {
    scope.setTag('component', component);
    Sentry.captureException(error);
  });
}
