// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { installShutdownHandlers } from './shutdown';
import * as monitoring from './observability';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
function host() {
  const events = new EventEmitter();
  const exit = vi.fn();
  const target = Object.assign(events, { exit }) as unknown as Parameters<typeof installShutdownHandlers>[1];
  return { events, exit, target };
}
it('hands off work before delegating to Next HTTP cleanup, once across repeated signals', async () => {
  vi.useFakeTimers();
  const { events, target } = host();
  const cleanup = vi.fn();
  events.on('SIGTERM', cleanup);
  let complete!: () => void;
  const drain = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
  installShutdownHandlers(drain, target);
  events.emit('SIGTERM', 'SIGTERM');
  events.emit('SIGINT', 'SIGINT');
  expect(drain).toHaveBeenCalledOnce();
  expect(cleanup).not.toHaveBeenCalled();
  complete();
  await vi.advanceTimersByTimeAsync(1);
  expect(cleanup).toHaveBeenCalledExactlyOnceWith('SIGTERM');
});
it('bounds a hung handoff, reports it, and still invokes HTTP cleanup', async () => {
  vi.useFakeTimers();
  const { events, target, exit } = host();
  const cleanup = vi.fn();
  const report = vi.spyOn(monitoring, 'captureOperationalError').mockReturnValue(null);
  events.on('SIGTERM', cleanup);
  installShutdownHandlers(() => new Promise(() => {}), target);
  events.emit('SIGTERM');
  await vi.advanceTimersByTimeAsync(6500);
  expect(cleanup).toHaveBeenCalledOnce();
  expect(report).toHaveBeenCalledWith(expect.any(Error), { component: 'server', operation: 'shutdown' });
  await vi.advanceTimersByTimeAsync(18500);
  expect(exit).toHaveBeenCalledWith(1);
});
