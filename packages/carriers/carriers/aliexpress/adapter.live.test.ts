import { describe, expect, it } from 'vitest';
import { fetchCainiao } from './adapter';

// A validly shaped number that was never issued: the endpoint answers with an
// empty external module, which is Cainiao's "unknown shipment".
const CAINIAO_WRONG_NUMBER = 'LP00000000000000';

describe('Cainiao live wrong-number handling', () => {
  it('maps the official empty external result to a clean 404', async () => {
    await expect(fetchCainiao(CAINIAO_WRONG_NUMBER)).rejects.toMatchObject({
      name: 'NotFoundError',
      status: 404,
      message: 'Cainiao could not locate the shipment',
    });
  });
});
