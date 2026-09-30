import { describe, expect, it } from 'vitest';
import { referenceConsignment } from './reference';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-09-01T12:00:00Z');

interface Barcode { id: string; scans: number[] }

const bind = (barcodes: Barcode[], now = NOW) => referenceConsignment(
  barcodes, (barcode) => barcode.scans, 'eos', now,
).map((barcode) => barcode.id);

describe('eos reference consignments', () => {
  it('keeps the barcodes first scanned within a day of the newest one', () => {
    expect(bind([
      { id: 'first', scans: [NOW - 3 * DAY, NOW - 2 * DAY] },
      { id: 'second', scans: [NOW - 3 * DAY + 23 * HOUR, NOW - 2 * DAY] },
    ])).toEqual(['first', 'second']);
  });

  it('drops older shipments that share the reference', () => {
    expect(bind([
      { id: 'older', scans: [NOW - 400 * DAY, NOW - 399 * DAY] },
      { id: 'current', scans: [NOW - 3 * DAY, NOW - 2 * DAY] },
    ])).toEqual(['current']);
  });

  it('refuses a reference that names two current consignments', () => {
    expect(() => bind([
      { id: 'first', scans: [NOW - 3 * DAY - 25 * HOUR, NOW - 3 * DAY] },
      { id: 'second', scans: [NOW - 3 * DAY, NOW - 2 * DAY] },
    ])).toThrow(expect.objectContaining({
      name: 'NotFoundError',
      kind: 'not_found',
      message: 'eos has several shipments for this reference',
    }));
  });

  it('refuses a reference whose newest consignment is quiet for 60 days', () => {
    const barcodes = [{ id: 'only', scans: [NOW - 70 * DAY, NOW - 60 * DAY + HOUR] }];
    expect(bind(barcodes)).toEqual(['only']);
    expect(() => bind(barcodes, NOW + HOUR)).toThrow(expect.objectContaining({
      name: 'NotFoundError',
      message: 'eos only has older shipments for this reference',
    }));
  });

  it('places barcodes by their dated scans only', () => {
    expect(bind([
      { id: 'undated', scans: [Number.NaN] },
      { id: 'dated', scans: [Number.NaN, NOW - DAY] },
    ])).toEqual(['dated']);
    expect(() => bind([{ id: 'empty', scans: [] }])).toThrow(expect.objectContaining({
      name: 'NotFoundError',
      message: 'eos has no scans for this reference yet',
    }));
    expect(() => bind([{ id: 'unreadable', scans: [Number.NaN] }, { id: 'empty', scans: [] }]))
      .toThrow(expect.objectContaining({ name: 'SchemaError' }));
  });
});
