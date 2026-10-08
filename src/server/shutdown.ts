import 'server-only';
import { drainBackgroundServices } from './background';
import { captureOperationalError, flushObservability, logOperationalEvent } from './observability';

// The platform stops the container 30 s after the signal (docs/DEPLOYMENT.md). The sync
// worker's handoff takes 17 s at most: 10 s for a check to end, 4 s for an aborted one
// to stop, 3 s to return its job. HTTP requests then drain until the 25 s watchdog.
const BACKGROUND_DRAIN_MS = 18_000;
const SHUTDOWN_DEADLINE_MS = 25_000;

/** Wrap, then delegate to Next's existing HTTP drain; never replace it with an abrupt exit. */
export function installShutdownHandlers(
  drain: () => Promise<void> = drainBackgroundServices,
  host: Pick<NodeJS.Process, 'listeners' | 'removeListener' | 'on' | 'exit'> = process,
): void {
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    const listeners = host.listeners(signal);
    for (const listener of listeners) host.removeListener(signal, listener);
    host.on(signal, () => {
      if (stopping) return;
      stopping = true;
      logOperationalEvent('server_draining', { signal });
      const watchdog = setTimeout(() => {
        logOperationalEvent('server_shutdown_timeout', {}, 'error');
        host.exit(1);
      }, SHUTDOWN_DEADLINE_MS);
      watchdog.unref();
      void (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([drain(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Background shutdown exceeded its deadline')), BACKGROUND_DRAIN_MS);
          })]);
          logOperationalEvent('background_services_drained');
        } catch (error) {
          captureOperationalError(error, { component: 'server', operation: 'shutdown' });
        } finally {
          clearTimeout(timer);
          await flushObservability(500).catch(() => false);
          if (listeners.length) for (const listener of listeners) listener.call(host, signal);
          else host.exit(0);
        }
      })();
    });
  }
}
