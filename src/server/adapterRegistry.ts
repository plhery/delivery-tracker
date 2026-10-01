import 'server-only';

import { AdapterRegistry, TrawlClient, REGISTRY, type AdapterEnvironment } from 'universal-parcel-scraper/node';
import { hostStepRecorder } from './stepRecorder';

/**
 * The environment this server hands to every carrier adapter: the private
 * browser service and local Chromium when configured, the telemetry sinks,
 * and the process environment for provider-specific flags. Adapters never
 * read secrets; the environment carries only what the package documents.
 */
export function hostAdapterEnvironment(env: Record<string, string | undefined> = process.env): AdapterEnvironment {
  return {
    trawl: TrawlClient.fromEnvironment(env),
    browserExecutablePath: env.TRACKING_CHROMIUM_PATH?.trim() || null,
    recorder: hostStepRecorder(),
    env,
  };
}

export function createAdapterRegistry(environment: AdapterEnvironment = hostAdapterEnvironment()): AdapterRegistry {
  return new AdapterRegistry(REGISTRY, environment);
}
