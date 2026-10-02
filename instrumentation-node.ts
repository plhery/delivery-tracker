import { startBackgroundServices } from './src/server/background';
import { preloadPlaces } from 'universal-parcel-scraper/places';
import { installShutdownHandlers } from './src/server/shutdown';
import { siteHosts } from './src/server/siteHosts';

// A malformed host setting must stop the deployment, not send visitors elsewhere.
siteHosts();
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
// Half a second of parsing belongs before the first parcel list, not in it.
if (process.env.NODE_ENV === 'production') setTimeout(() => {
  try {
    preloadPlaces();
  } catch {
    // The first request retries, and parcels load without places if it fails again.
  }
}, 1_000).unref();
