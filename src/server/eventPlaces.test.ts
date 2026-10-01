import { afterEach, describe, expect, it, vi } from 'vitest';
import * as observability from './observability';
import * as places from './places';
import { withEventPlaces } from './eventPlaces';

const event = (id: string, location: string | null, occurredAt: string) => ({
  id, package_id: 'parcel', stage: 'in_transit', description: 'Scan', location, occurred_at: occurredAt,
});

afterEach(() => vi.restoreAllMocks());

describe('withEventPlaces', () => {
  it('locates each scan, in its own order, with the carrier and neighbouring scans as hints', () => {
    const row = {
      id: 'parcel',
      carrier: 'swiss-post',
      carrier_data: { destination_country: 'CH' },
      // Newest first, as the database may return them.
      tracking_events: [
        event('3', 'Dintikon', '2026-09-28T07:00:00+00:00'),
        event('2', null, '2026-09-27T12:00:00+00:00'),
        event('1', 'KOELN, DE', '2026-09-26T09:00:00+00:00'),
      ],
    };
    const located = withEventPlaces(row) as { tracking_events: { id: string; place: places.EventPlace | null }[] };
    expect(located.tracking_events.map((scan) => scan.id)).toEqual(['3', '2', '1']);
    expect(located.tracking_events[0].place).toMatchObject({ country: 'CH', name: 'Dintikon', precision: 'city' });
    expect(located.tracking_events[1].place).toBeNull();
    expect(located.tracking_events[2].place).toMatchObject({ country: 'DE', name: 'Köln' });
  });

  it('moves a scan to the carrier\'s own point near its town, and never returns the point', () => {
    const row = {
      id: 'parcel',
      carrier: 'dpd-fr',
      tracking_events: [
        // A depot 6 km from Strasbourg's centre.
        { ...event('1', 'Agence DPD de Strasbourg (67)', '2026-09-18T05:40:00+00:00'), point: { latitude: 48.6305, longitude: 7.7682 } },
        // A point that disagrees with the town is ignored.
        { ...event('2', 'Agence DPD de Strasbourg (67)', '2026-09-18T05:42:00+00:00'), point: { latitude: 43.1512, longitude: 6.0712 } },
      ],
    };
    const [depot, elsewhere] = (withEventPlaces(row) as { tracking_events: Record<string, unknown>[] }).tracking_events;
    expect(depot.place).toMatchObject({ name: 'Strasbourg', latitude: 48.6305, longitude: 7.7682 });
    expect(elsewhere.place).toMatchObject({ name: 'Strasbourg', latitude: expect.closeTo(48.58, 1) });
    expect(depot).not.toHaveProperty('point');
    expect(elsewhere).not.toHaveProperty('point');
  });

  it('leaves packages without scans untouched', () => {
    const row = { id: 'parcel', carrier: 'swiss-post', tracking_events: [] };
    expect(withEventPlaces(row)).toBe(row);
    expect(withEventPlaces({ id: 'parcel' })).toEqual({ id: 'parcel' });
  });

  it('serves the parcel without places when the gazetteer fails, and reports it once', () => {
    vi.spyOn(places, 'placesForEvents').mockImplementation(() => {
      throw new Error('missing gazetteer');
    });
    const capture = vi.spyOn(observability, 'captureOperationalError').mockReturnValue(null);
    const row = { id: 'parcel', carrier: 'not-a-carrier', tracking_events: [event('1', 'Zürich', '2026-09-26T09:00:00+00:00')] };
    expect(withEventPlaces(row)).toEqual(row);
    expect(withEventPlaces(row)).toEqual(row);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(expect.any(Error), { component: 'api', operation: 'locate_event_places' });
  });
});
