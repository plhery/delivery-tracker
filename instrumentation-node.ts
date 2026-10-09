import { startBackgroundServices } from './src/server/background';
import { emailSettings } from './src/server/email/config';
import { warmDpdSession } from 'universal-parcel-scraper/node';
import { preloadPlaces } from 'universal-parcel-scraper/places';
import { hostAdapterEnvironment } from './src/server/adapterRegistry';
import { installShutdownHandlers } from './src/server/shutdown';
import { canonicalOrigin, siteHosts } from './src/server/siteHosts';
import { turnstileSettings } from './src/server/lookupVerification';
import { nativeAttestSettings } from './src/server/nativeVerification';

// A malformed host setting must stop the deployment, not send visitors elsewhere.
siteHosts();
// Nor may incomplete mail settings promise emails the server cannot send.
emailSettings();
turnstileSettings();
nativeAttestSettings();
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
// DPD Germany and DPD Switzerland read through a session that takes tens of seconds to
// open. On a public site it opens now, in the background, and the scraper keeps one open
// from then on. The production servers CI starts have no canonical origin and send DPD nothing.
if (process.env.NODE_ENV === 'production' && canonicalOrigin()) warmDpdSession(hostAdapterEnvironment());
// Half a second of parsing belongs before the first parcel list, not in it.
if (process.env.NODE_ENV === 'production') setTimeout(() => {
  try {
    preloadPlaces();
  } catch {
    // The first request retries, and parcels load without places if it fails again.
  }
}, 1_000).unref();
