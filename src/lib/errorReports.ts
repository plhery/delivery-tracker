/**
 * Error reports from the page (docs/OBSERVABILITY.md). From the start, before
 * the app renders, the page listens for errors thrown through its own scripts
 * and holds the first few. Sentry's SDK lives in a chunk of its own that loads
 * once one happens, and only where the page names a project to report to: most
 * visits never download it.
 */

import { ERROR_REPORTS_META, type ErrorReportsConfig } from './errorReportsConfig';

export interface PendingReport {
  error: unknown;
  kind: 'onerror' | 'onunhandledrejection' | 'error-boundary';
  /** Where an uncaught error was thrown, for one whose stack does not say. */
  message?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
}

const MAX_PENDING = 10;

let pending: PendingReport[] = [];
let send: ((report: PendingReport) => void) | undefined;
let state: 'idle' | 'loading' | 'off' = 'idle';

function pageConfig(): ErrorReportsConfig | null {
  try {
    const meta = document.querySelector<HTMLMetaElement>(`meta[name="${ERROR_REPORTS_META}"]`);
    const value: unknown = JSON.parse(meta?.content || 'null');
    if (!value || typeof value !== 'object') return null;
    const { dsn, release, environment } = value as Record<string, unknown>;
    if (typeof dsn !== 'string' || typeof environment !== 'string') return null;
    return { dsn, environment, ...(typeof release === 'string' ? { release } : {}) };
  } catch {
    return null;
  }
}

function deliver(report: PendingReport): void {
  if (send) {
    send(report);
    return;
  }
  if (state === 'off' || pending.length >= MAX_PENDING) return;
  pending.push(report);
  if (state === 'loading') return;
  const config = pageConfig();
  if (!config) {
    state = 'off';
    pending = [];
    return;
  }
  state = 'loading';
  import('./errorReporter').then(({ startErrorReports }) => {
    send = startErrorReports(config);
    for (const held of pending.splice(0)) send(held);
  }).catch(() => {
    // Error reports must never add an error of their own.
    state = 'off';
    pending = [];
  });
}

/** Whether a script's address, or a stack, is this site's own scripts. */
function ownScripts(text: unknown, start = false): boolean {
  const scripts = `${location.origin}/_next/`;
  return typeof text === 'string' && (start ? text.startsWith(scripts) : text.includes(scripts));
}

/**
 * Listens for uncaught errors and unhandled rejections. An extension's,
 * another site's or an inline script's are left alone, and so is a rejection
 * that is no error, or whose stack never went through the site's scripts.
 */
export function watchBrowserErrors(target: Window = window): void {
  target.addEventListener('error', (event) => {
    if (!ownScripts(event.filename, true)) return;
    const { error, message, filename, lineno, colno } = event;
    deliver({ error: error ?? undefined, kind: 'onerror', message, filename, lineno, colno });
  });
  target.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason;
    if (reason instanceof Error && ownScripts(reason.stack)) deliver({ error: reason, kind: 'onunhandledrejection' });
  });
}

/**
 * An error the app's error screen caught. One rendered on the server reaches
 * the page with a `digest` instead of its message; the server reported it.
 */
export function reportCaughtError(error: Error & { digest?: string }): void {
  if (!error.digest) deliver({ error, kind: 'error-boundary' });
}
