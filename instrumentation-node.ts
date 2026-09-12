import { startBackgroundServices } from './src/server/background';
// Registers the Prometheus sink for carrier telemetry alongside the Sentry one.
import './src/server/metrics';
import { installShutdownHandlers } from './src/server/shutdown';

// Invalid server-side credentials are a deployment failure. Let initialization
// fail so an orchestrator cannot mark a process healthy while tracking and
// notification work is silently disabled.
startBackgroundServices();
// Next installs its signal handlers before calling instrumentation. Coordinate
// durable work first, then delegate to those handlers for the HTTP drain.
const globalRuntime = globalThis as typeof globalThis & { __deliveryShutdownInstalled?: boolean };
if (process.env.NODE_ENV === 'production' && !globalRuntime.__deliveryShutdownInstalled) {
  installShutdownHandlers();
  globalRuntime.__deliveryShutdownInstalled = true;
}
