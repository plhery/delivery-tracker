import { describe, expect, it } from 'vitest';
import { fetchPostlogistics } from './adapter';

// A validly shaped barcode that was never issued: the endpoint answers
// `Data: null`, which is PostLogistics' "unknown identifier".
const POSTLOGISTICS_WRONG_NUMBER = '000000000000000000';
// A current Swiss Post parcel barcode, supplied outside the repository: the
// endpoint relays Swiss Post's scans for it as `Type: 3`.
const SWISS_POST_TRACKING_NUMBER = process.env.SWISS_POST_TRACKING_NUMBER;

describe('PostLogistics live wrong-number handling', () => {
  it('maps the official null-data result to a clean 404', async () => {
    await expect(fetchPostlogistics(POSTLOGISTICS_WRONG_NUMBER)).rejects.toMatchObject({
      name: 'NotFoundError',
      status: 404,
      message: 'PostLogistics could not locate the shipment',
    });
  });

  it.skipIf(!SWISS_POST_TRACKING_NUMBER)('leaves a relayed Swiss Post parcel to the Swiss Post adapter', async () => {
    await expect(fetchPostlogistics(SWISS_POST_TRACKING_NUMBER!)).rejects.toMatchObject({
      name: 'NotFoundError',
      status: 404,
      message: 'PostLogistics only relays Swiss Post tracking for this barcode',
    });
  });
});
