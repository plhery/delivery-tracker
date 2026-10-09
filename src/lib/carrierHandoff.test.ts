import { afterEach, describe, expect, it, vi } from 'vitest';
import { CARRIER_HANDOFF_STORAGE_KEY as KEY, takeCarrierHandoff, writeCarrierHandoff } from './carrierHandoff';

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('the text a carrier’s page hands to the tracker', () => {
  it('is taken once, as it was typed', () => {
    writeCarrierHandoff('JJD000390012345678', 1_000);
    expect(takeCarrierHandoff(2_000)).toBe('JJD000390012345678');
    // The landing opened again later starts empty.
    expect(takeCarrierHandoff(3_000)).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('is dropped unread when it is ten minutes old, or dated after now', () => {
    writeCarrierHandoff('JJD000390012345678', 0);
    expect(takeCarrierHandoff(10 * 60_000)).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    writeCarrierHandoff('JJD000390012345678', 5_000);
    expect(takeCarrierHandoff(4_000)).toBeNull();
    writeCarrierHandoff('JJD000390012345678', 0);
    expect(takeCarrierHandoff(10 * 60_000 - 1)).toBe('JJD000390012345678');
  });

  it('is nothing when the note is blank, not a note, or not readable', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ text: '   ', at: Date.now() }));
    expect(takeCarrierHandoff()).toBeNull();
    sessionStorage.setItem(KEY, JSON.stringify({ text: 12, at: Date.now() }));
    expect(takeCarrierHandoff()).toBeNull();
    sessionStorage.setItem(KEY, JSON.stringify({ text: 'JJD000390012345678' }));
    expect(takeCarrierHandoff()).toBeNull();
    sessionStorage.setItem(KEY, 'null');
    expect(takeCarrierHandoff()).toBeNull();
    sessionStorage.setItem(KEY, '{');
    expect(takeCarrierHandoff()).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(takeCarrierHandoff()).toBeNull();
  });

  it('keeps a long pasted message to what the landing’s field is handed', () => {
    writeCarrierHandoff(`  ${'x'.repeat(20_000)}`, 0);
    expect(takeCarrierHandoff(1)).toHaveLength(10_000);
  });

  it('leaves the landing to open without it when session storage is out of reach', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    expect(() => writeCarrierHandoff('JJD000390012345678')).not.toThrow();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    expect(takeCarrierHandoff()).toBeNull();
  });
});
