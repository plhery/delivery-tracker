import { describe, expect, it } from 'vitest';
import { SwissPostCargoTracker } from './adapter';

// A current Swiss Post Cargo barcode or customer reference, supplied outside
// the repository.
const SWISS_POST_CARGO_TRACKING_NUMBER = process.env.SWISS_POST_CARGO_TRACKING_NUMBER;
// A current Swiss Post parcel barcode, supplied outside the repository: the
// endpoint relays Swiss Post's scans for it as `Type: 3`.
const SWISS_POST_TRACKING_NUMBER = process.env.SWISS_POST_TRACKING_NUMBER;

describe('Swiss Post Cargo live anonymous tracking', () => {
  it('maps the official null-data response for a wrong number to a clean 404', async () => {
    await expect(new SwissPostCargoTracker().fetch('CODEXINVALID20260831')).rejects.toMatchObject({
      name: 'NotFoundError',
      status: 404,
      message: 'Swiss Post Cargo could not locate the shipment',
    });
  });

  it.skipIf(!SWISS_POST_CARGO_TRACKING_NUMBER)('resolves a private barcode or reference without putting it in repository fixtures', async () => {
    await expect(new SwissPostCargoTracker().fetch(SWISS_POST_CARGO_TRACKING_NUMBER!)).resolves.toMatchObject({
      timezone: 'Europe/Zurich',
      events: expect.arrayContaining([
        expect.objectContaining({ time: expect.any(String), description: expect.any(String) }),
      ]),
    });
  });

  it.skipIf(!SWISS_POST_TRACKING_NUMBER)('leaves a relayed Swiss Post parcel to the Swiss Post adapter', async () => {
    await expect(new SwissPostCargoTracker().fetch(SWISS_POST_TRACKING_NUMBER!)).rejects.toMatchObject({
      name: 'NotFoundError',
      status: 404,
      message: 'Swiss Post Cargo only relays Swiss Post tracking for this barcode',
    });
  });
});
