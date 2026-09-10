import 'server-only';
import { drainBackgroundServices } from './background';
import { captureOperationalError, flushObservability, logOperationalEvent } from './observability';

/** Wrap, then delegate to Next's existing HTTP drain; never replace it with an abrupt exit. */
export function installShutdownHandlers(
  drain: () => Promise<void> = drainBackgroundServices,
  host: Pick<NodeJS.Process, 'listeners' | 'removeListener' | 'on' | 'exit'> = process,
): void {
  let stopping = false;
  const prior = new Map<NodeJS.Signals, NodeJS.SignalsListener[]>();
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    const listeners = host.listeners(signal);
    prior.set(signal, listeners);
    for (const listener of listeners) host.removeListener(signal, listener);
    host.on(signal, () => {
      if (stopping) return;
      stopping = true;
      logOperationalEvent('server_draining', { signal });
      // Production gives containers 30s; leave time for Next's HTTP drain.
      const watchdog = setTimeout(() => {
        logOperationalEvent('server_shutdown_timeout', {}, 'error');
        host.exit(1);
      }, 25_000);
      watchdog.unref();
      void (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([drain(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Background shutdown exceeded its deadline')), 6_500);
          })]);
          logOperationalEvent('background_services_drained');
        } catch (error) {
          captureOperationalError(error, { component: 'server', operation: 'shutdown' });
        } finally {
          clearTimeout(timer);
          await flushObservability(500).catch(() => false);
          const listeners = prior.get(signal)!;
          if (listeners.length) for (const listener of listeners) listener.call(host, signal);
          else host.exit(0);
        }
      })();
    });
  }
}
