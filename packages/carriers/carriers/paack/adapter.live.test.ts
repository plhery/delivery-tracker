import { describe, expect, it } from 'vitest';
import { PaackTracker } from './adapter';

describe('Paack live anonymous tracking', () => {
  it.each([
    ['EXCHANGE000001D', '08006'],
    ['EXCHANGE000001R', '08021'],
  ])('maps the retired official example %s to the clean redirect result', async (number, postcode) => {
    // Published in Paack's official API examples:
    // https://www.postman.com/paacklogistics/paack-apis/folder/1uuw6iw/orders-api
    await expect(new PaackTracker().fetch(number, postcode)).rejects.toMatchObject({
      name: 'NotFoundError',
      kind: 'not_found',
      provider: 'Paack',
      message: 'Paack could not locate the shipment',
      status: 404,
    });
  });
});
