import { afterEach, describe, expect, it, vi } from 'vitest';
import * as observability from './observability';
import * as places from 'universal-parcel-scraper/places';
vi.mock('universal-parcel-scraper/places', { spy: true });
import { withEventPlaces, withoutEventSources } from './eventPlaces';

it('keeps addition-only query context out of client package data', () => {
  const row = { carrier_data: { add_recognition_pending: true, lookup_country_hint: 'CH' } };
  expect(withEventPlaces(row)).toEqual({ carrier_data: { lookup_country_hint: 'CH' } });
  expect(row.carrier_data.add_recognition_pending).toBe(true);
});

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

  it('opens the timeline with Peek\'s own row only until the carrier\'s scans reach back to it', () => {
    const added = { ...event('added', null, '2026-09-27T10:00:00+00:00'), stage: 'pending', description: 'Tracking added', provider_event_id: 'app:pending' };
    const scan = (id: string, occurredAt: string) => ({ ...event(id, null, occurredAt), provider_event_id: `swiss-post:${id}` });
    const served = (events: Record<string, unknown>[]) => (withEventPlaces({ id: 'parcel', carrier: 'swiss-post', tracking_events: events }) as {
      tracking_events: Record<string, unknown>[];
    }).tracking_events;

    // Only the row, or only later scans: it starts the journey.
    expect(served([added]).map((row) => row.id)).toEqual(['added']);
    expect(served([scan('later', '2026-09-27T12:00:00+00:00'), added]).map((row) => row.id)).toEqual(['later', 'added']);
    // Added mid-journey or after the delivery: the carrier's scans tell the story alone.
    const delivered = { ...scan('delivered', '2026-09-26T15:00:00+00:00'), stage: 'delivered' };
    expect(served([added, delivered, scan('earlier', '2026-09-25T08:00:00+00:00')]).map((row) => row.id)).toEqual(['delivered', 'earlier']);
    expect(served([added, scan('same', '2026-09-27T10:00:00+00:00')]).map((row) => row.id)).toEqual(['same']);
    // A carrier change waiting for its first answer is Peek's row too.
    expect(served([{ ...added, description: 'Carrier changed; waiting for tracking' }, scan('earlier', '2026-09-25T08:00:00+00:00')])
      .map((row) => row.id)).toEqual(['earlier']);
    // Without a source, as from a link read before its database said it, every row stays.
    const unsourced = { ...added, provider_event_id: undefined };
    expect(served([unsourced, scan('earlier', '2026-09-25T08:00:00+00:00')]).map((row) => row.id)).toEqual(['added', 'earlier']);
    // The source is never served.
    expect(served([added, scan('later', '2026-09-27T12:00:00+00:00')]).every((row) => !('provider_event_id' in row))).toBe(true);
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

describe('withoutEventSources', () => {
  it('keeps every stored row, Peek\'s own included, without its source', () => {
    const row = { id: 'parcel', tracking_events: [
      { ...event('added', null, '2026-09-27T10:00:00+00:00'), provider_event_id: 'app:pending' },
      { ...event('scan', null, '2026-09-25T08:00:00+00:00'), provider_event_id: 'swiss-post:scan' },
    ] };
    expect(withoutEventSources(row)).toEqual({ id: 'parcel', tracking_events: [
      event('added', null, '2026-09-27T10:00:00+00:00'),
      event('scan', null, '2026-09-25T08:00:00+00:00'),
    ] });
    expect(row.tracking_events[0]).toHaveProperty('provider_event_id');
    expect(withoutEventSources({ id: 'parcel' })).toEqual({ id: 'parcel' });
  });
});
