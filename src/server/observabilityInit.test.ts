import { afterEach, expect, it, vi } from 'vitest';

// One spy for every copy of the SDK the test loads.
const sentry = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock('@sentry/node', async (importOriginal) => ({
  ...await importOriginal<typeof import('@sentry/node')>(),
  init: sentry.init,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  sentry.init.mockClear();
  Reflect.deleteProperty(globalThis, '__deliveryObservabilityInitialized');
});

it('starts Sentry once for the process, however many copies of the module the build makes', async () => {
  vi.stubEnv('SENTRY_DSN', 'https://public@example.test/1');
  // The instrumentation bundle and the route bundles each load their own copy.
  const instrumentation = await import('./observability');
  vi.resetModules();
  const routes = await import('./observability');
  expect(routes.initObservability).not.toBe(instrumentation.initObservability);

  expect(instrumentation.initObservability()).toBe(true);
  expect(routes.initObservability()).toBe(true);
  expect(instrumentation.initObservability()).toBe(true);
  // A second init would wrap the HTTP server's emit again on every request.
  expect(sentry.init).toHaveBeenCalledTimes(1);
});

it('stays off without a DSN, and can still start once one is set', async () => {
  const { initObservability } = await import('./observability');
  expect(initObservability()).toBe(false);
  expect(sentry.init).not.toHaveBeenCalled();
  vi.stubEnv('SENTRY_DSN', 'https://public@example.test/1');
  expect(initObservability()).toBe(true);
  expect(sentry.init).toHaveBeenCalledTimes(1);
});
