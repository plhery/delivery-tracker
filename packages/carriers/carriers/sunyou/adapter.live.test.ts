import { describe, expect, it } from 'vitest';
import { fetchSunYou } from './adapter';

// A validly shaped number that was never issued: SunYou answers with
// `displayStatus: "0"`, its explicit "no such shipment".
const SUNYOU_WRONG_NUMBER = 'SY00000000000';

describe('SunYou live wrong-number handling', () => {
  it('maps the official not-found result to a clean 404', async () => {
    await expect(fetchSunYou(SUNYOU_WRONG_NUMBER)).rejects.toMatchObject({
      name: 'NotFoundError',
      status: 404,
      message: 'SunYou could not locate the shipment',
    });
  });
});
