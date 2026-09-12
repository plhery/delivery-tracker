import { describe, expect, it } from 'vitest';
import { ParcelsAppTracker } from './adapter';

// Reference identifiers and any recipient data are supplied locally, never
// committed. This file runs only with vitest.carriers-live.config.ts.
describe('ParcelsApp direct lookup', () => {
  it.runIf(Boolean(process.env.PARCELSAPP_LIVE_NUMBER))('retrieves the configured reference without TRAWL', async () => {
    let states: unknown[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      const response = await fetch(url, init);
      states = (await response.clone().json()).states;
      return response;
    };
    const result = await new ParcelsAppTracker({ trawl: null, fetcher }).fetch(
      process.env.PARCELSAPP_LIVE_NUMBER!, 30_000, process.env.PARCELSAPP_LIVE_POSTCODE,
    );
    expect(result).toMatchObject({ tracking_provider: 'ParcelsApp', tracking_source: 'structured-web-response' });
    expect(result.events!.length).toBeGreaterThan(0);
    if (process.env.PARCELSAPP_LIVE_EXPECTED_STATES) expect(states).toHaveLength(Number(process.env.PARCELSAPP_LIVE_EXPECTED_STATES));
    // The shared projection may normalize and deduplicate upstream states.
    if (process.env.PARCELSAPP_LIVE_EXPECTED_EVENTS) expect(result.events).toHaveLength(Number(process.env.PARCELSAPP_LIVE_EXPECTED_EVENTS));
    expect(JSON.stringify(result)).not.toMatch(/PIN:|House Number:|Door NO:/);
  });
});
