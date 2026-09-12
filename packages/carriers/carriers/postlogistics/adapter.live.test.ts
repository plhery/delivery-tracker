import { describe, expect, it } from 'vitest';
import { fetchPostlogistics } from './adapter';

// A validly shaped barcode that was never issued: the endpoint answers
// `Data: null`, which is PostLogistics' "unknown identifier".
const POSTLOGISTICS_WRONG_NUMBER = '000000000000000000';

describe('PostLogistics live wrong-number handling', () => {
  it('maps the official null-data result to a clean 404', async () => {
    await expect(fetchPostlogistics(POSTLOGISTICS_WRONG_NUMBER)).rejects.toMatchObject({
      name: 'NotFoundError',
      status: 404,
      message: 'PostLogistics could not locate the shipment',
    });
  });
});
