import { describe, expect, it } from 'vitest';
import { CiblexTracker } from './adapter';

describe('Ciblex live anonymous tracking', () => {
  it('recognizes the official empty-table response without mislabeling an empty 200', async () => {
    let error: unknown;
    try {
      await new CiblexTracker().fetch('12345678901234');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    if (error instanceof Error && error.name === 'NotFoundError') {
      expect(error).toMatchObject({
        kind: 'not_found',
        status: 404,
        provider: 'Ciblex',
        message: 'Ciblex could not locate the shipment',
      });
    } else {
      expect(error).toMatchObject({
        name: 'IndeterminateError',
        kind: 'indeterminate',
        status: 502,
        message: 'Ciblex returned an empty tracking response',
      });
    }
  });
});
