import { describe, expect, it } from 'vitest';
import { fetchPostNL } from './adapter';

// A validly shaped Dutch S10 number that was never issued: PostNL answers with
// an item that has no events and says the barcode was not found.
const POSTNL_WRONG_NUMBER = 'LT000000000NL';

describe('PostNL live wrong-number handling', () => {
  it('maps the official barcode-not-found result to a clean 404', async () => {
    await expect(fetchPostNL(POSTNL_WRONG_NUMBER)).rejects.toMatchObject({
      name: 'NotFoundError',
      status: 404,
      message: 'PostNL could not locate the shipment',
    });
  });
});
