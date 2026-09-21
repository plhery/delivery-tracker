import { describe, expect, it } from 'vitest';
import { fetchCainiao } from './adapter';
import { normalizeCarrierResult } from '../../core/result';

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

describe('Cainiao live handoff evidence', () => {
  it('retains the independent reference from the public corpus example through normalization', async () => {
    // Public shipment report already recorded with provenance in numbers.json.
    const result = normalizeCarrierResult(await fetchCainiao('CNG00798678939847'));
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.delivery_tracking_number).toMatch(/^[A-Z0-9]{8,30}$/);
    expect(result.destination_country_name).toBeTypeOf('string');
  });
});
