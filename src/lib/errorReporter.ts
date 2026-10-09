import {
  BrowserClient,
  dedupeIntegration,
  defaultStackParser,
  eventFiltersIntegration,
  eventFromException,
  getCurrentScope,
  httpContextIntegration,
  linkedErrorsIntegration,
  makeFetchTransport,
  type Event,
  type StackFrame,
} from '@sentry/browser';
import type { PendingReport } from './errorReports';
import type { ErrorReportsConfig } from './errorReportsConfig';

/** Past this many reports a page is broken in a way the first ones already tell. */
const MAX_REPORTS = 5;

/** Errors of the network, or of a request the page itself gave up: not the page's. */
export const IGNORED_ERRORS: RegExp[] = [
  /^(?:TypeError: )?(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource|Network request failed|The network connection was lost|The Internet connection appears to be offline)\b/,
  // How Safari says a request was cancelled, as when the page is left, in the languages Peek speaks.
  /^(?:TypeError: )?(?:cancell?ed|annulé|abgebrochen|cancelado|annullato|anulowano)$/i,
  /^(?:AbortError|TimeoutError)\b/,
  /\b(?:The operation was aborted|The user aborted a request|signal is aborted without reason|signal timed out)/i,
  // A script that did not arrive.
  /^ChunkLoadError\b/,
  /Failed to load chunk|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i,
  /^ResizeObserver loop/,
];

/** Where browser extensions' code lives, in each browser. */
const EXTENSION = /^(?:[a-z]+(?:-web)?-extension|webkit-masked-url|extensions?|resource):/i;
const ADDRESS = /\b[a-z][a-z\d+.-]*:\/\/[^\s"'`<>\\)]+/gi;
const PATH = /(^|[\s"'`(=])(\/[^\s"'`<>\\)]*)/g;
const EMAIL = /[^\s@"'`<>()]+@[^\s@"'`<>()]+\.[a-z]{2,}/gi;
const RUN = /[\w-]{8,}/g;

/**
 * An address without its query and fragment, where sign-in codes, email
 * tokens and the names in parcel links travel. Parcel link ids, and any
 * segment of six characters or more with a digit, read `:id`; the site's
 * scripts keep their names, which their source maps are found by.
 */
export function scrubAddress(address: string): string {
  const origin = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i.exec(address)?.[0] ?? '';
  const path = address.slice(origin.length).split(/[?#]/, 1)[0]!;
  if (path.startsWith('/_next/')) return origin + path;
  return origin + path
    .replace(/^\/(p|i)\/[^/]+/, '/$1/:id')
    .replace(/\/parcels\/[^/]+/, '/parcels/:id')
    .split('/')
    .map((segment) => (segment.length >= 6 && /\d/.test(segment) ? ':id' : segment))
    .join('/');
}

/**
 * Text with its addresses scrubbed, and without email addresses or anything
 * shaped like a tracking number or a key: a run of eight characters or more
 * with four digits, of twenty or more with one, or of thirty-two or more.
 */
export function scrubText(text: string): string {
  return text
    .replace(EMAIL, '[Filtered]')
    .replace(ADDRESS, scrubAddress)
    .replace(PATH, (_, before: string, path: string) => before + scrubAddress(path))
    .replace(RUN, (run) => {
      const digits = run.replace(/\D/g, '').length;
      return digits >= 4 || (digits > 0 && run.length >= 20) || run.length >= 32 ? '[Filtered]' : run;
    });
}

function frames(event: Event): StackFrame[] {
  return event.exception?.values?.flatMap((value) => value.stacktrace?.frames ?? []) ?? [];
}

/**
 * Whether an error is the page's own: its stack goes through the site's
 * scripts, and no extension's code is anywhere in it.
 */
export function reportable(event: Event, origin: string): boolean {
  const files = frames(event).map((frame) => frame.filename ?? '');
  return files.some((file) => file.startsWith(`${origin}/_next/`)) && !files.some((file) => EXTENSION.test(file));
}

/** What a report keeps: the error, its stack, the page's address and the browser. */
export function scrubEvent<T extends Event>(event: T): T {
  const userAgent = event.request?.headers?.['User-Agent'];
  return {
    ...event,
    message: event.message && scrubText(event.message),
    logentry: undefined,
    breadcrumbs: undefined,
    user: undefined,
    extra: undefined,
    transaction: undefined,
    request: event.request && {
      url: event.request.url && scrubAddress(event.request.url),
      ...(userAgent ? { headers: { 'User-Agent': userAgent } } : {}),
    },
    exception: event.exception && {
      ...event.exception,
      values: event.exception.values?.map((value) => ({
        ...value,
        value: value.value && scrubText(value.value),
        stacktrace: value.stacktrace && {
          ...value.stacktrace,
          frames: value.stacktrace.frames?.map((frame) => ({
            ...frame,
            filename: frame.filename && scrubAddress(frame.filename),
            abs_path: frame.abs_path && scrubAddress(frame.abs_path),
          })),
        },
      })),
    },
  };
}

/** A stack that names no place, as a script that does not parse: the place the browser named instead. */
function withInitialFrame(event: Event, { filename, lineno, colno }: PendingReport): Event {
  const values = event.exception?.values ?? [{}];
  if (!filename || values[0]?.stacktrace?.frames?.length) return event;
  const [first, ...rest] = values;
  return {
    ...event,
    exception: { values: [{ ...first, stacktrace: { frames: [{ filename, lineno, colno, function: '?', in_app: true }] } }, ...rest] },
  };
}

/** Starts Sentry's client for the page, and returns how to send it a report. */
export function startErrorReports(
  config: ErrorReportsConfig,
  transport = makeFetchTransport,
): (report: PendingReport) => void {
  const origin = location.origin;
  let reports = 0;
  const client = new BrowserClient({
    ...config,
    // Reports go through the site itself (app/api/errors), never to another host.
    tunnel: '/api/errors',
    transport,
    stackParser: defaultStackParser,
    integrations: [eventFiltersIntegration(), linkedErrorsIntegration(), dedupeIntegration(), httpContextIntegration()],
    allowUrls: [new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/_next/`)],
    ignoreErrors: IGNORED_ERRORS,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
      httpHeaders: { request: { allow: ['User-Agent'] }, response: false },
    },
    sendClientReports: false,
    maxBreadcrumbs: 0,
    beforeSend(event) {
      if (reports >= MAX_REPORTS || !reportable(event, origin)) return null;
      reports += 1;
      return scrubEvent(event);
    },
  });
  const scope = getCurrentScope();
  scope.setClient(client);
  client.init();
  return (report) => {
    void eventFromException(defaultStackParser, report.error ?? report.message ?? 'Error', undefined, false).then((event) => {
      scope.captureEvent({ ...withInitialFrame(event, report), level: 'error' }, {
        originalException: report.error,
        mechanism: { type: report.kind, handled: report.kind === 'error-boundary' },
      });
    });
  };
}
