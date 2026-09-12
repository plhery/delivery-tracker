import 'server-only';

import { AdapterRegistry, type AdapterEnvironment } from '@carriers/core/adapter';
import { TrawlClient } from '@carriers/core/transport';
import { REGISTRY } from '@carriers/generated/registry';
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
