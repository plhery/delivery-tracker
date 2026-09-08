import 'server-only';
import { backgroundState } from './background';
import { serviceClient } from './runtime';

/** Ready means both the database and this process's job worker are usable. */
export async function deliveryServiceReady(): Promise<boolean> {
  try {
    const heartbeat = backgroundState()?.workerHeartbeat;
    if (!heartbeat || Date.now() / 1_000 - heartbeat > 120) return false;
    const client = serviceClient();
    return client ? await client.probeReadiness() : false;
  } catch {
    return false;
  }
}
