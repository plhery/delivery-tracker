import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StepRecord, StepRecorder } from '../../core/telemetry';
import {
  DPDChallengeError,
  DPDTracker,
  DPDTrackingError,
  adapter,
  parseDPDTrackingApi,
} from './adapter';
import { apiStage, apiStatus, scanStage, wordingStatus } from './status';

// Every identifier below is synthetic: a 14-digit number that matches DPD's
// shape but was never issued, and made-up names for the private fields the
// projection has to drop.
const TRACKING_NUMBER = '06080000000001';
const fixture = (name: string) => JSON.parse(
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'),
) as Record<string, unknown>;
const READY_FOR_COLLECTION = fixture('ready-for-collection.json');
const DELIVERED_VERIFIED = fixture('delivered-verified.json');
const DELIVERED_UNVERIFIED = fixture('delivered-unverified.json');
const CAPABILITIES = (JSON.parse(
  readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'),
) as { capabilities: string[] }).capabilities;

function recordingRecorder(): { recorder: StepRecorder; steps: StepRecord[] } {
  const steps: StepRecord[] = [];
  return { steps, recorder: { step: (record) => { steps.push(record); }, lookup() {} } };
}

/** The four guest-API calls a cold tracker makes before it reads the parcel. */
function mockGuestApi(details: Response) {
  return vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ fid: 'unit-test-fid', authToken: { token: 'installation-token', expiresIn: '604800s' } }))
    .mockResolvedValueOnce(Response.json({ entries: { basic_dpd_token: 'dW5pdDp0ZXN0' } }))
    .mockResolvedValueOnce(Response.json({ access_token: 'unit-test-access-token', expires_in: 3600 }))
    .mockResolvedValueOnce(details);
}

afterEach(() => vi.restoreAllMocks());

describe('DPD guest API projection', () => {
  it('returns every declared capability across the fixtures', () => {
    const collection = parseDPDTrackingApi(READY_FOR_COLLECTION, TRACKING_NUMBER, true);
    const delivered = parseDPDTrackingApi(DELIVERED_VERIFIED, TRACKING_NUMBER, true);
    const produced = new Set<string>();
    for (const result of [collection, delivered]) {
      if (result.events?.length) produced.add('history');
      if (result.events?.some((event) => event.location)) produced.add('location');
      if (result.expected_delivery) produced.add('eta');
      if (result.sender_name) produced.add('sender_name');
      if (result.pickup_point) produced.add('pickup_point');
      if (result.weight_kg) produced.add('weight');
      if (result.delivered_at) produced.add('delivered_at');
      if (result.events?.some((event) => event.provider_code)) produced.add('provider_code');
    }

    expect([...produced].sort()).toEqual([...CAPABILITIES].sort());
    expect(collection.expected_delivery).toBe('2026-07-16 09:00–12:00');
    expect(collection.sender_name).toBe('Example Webshop AG');
    expect(collection.pickup_point).toBe('Pickup parcelshop Zürich Wiedikon');
  });

  it('drops recipient identity, address, phone and signature', () => {
    const serialized = JSON.stringify(parseDPDTrackingApi(READY_FOR_COLLECTION, TRACKING_NUMBER));

    for (const privateValue of [
      'Private Recipient', 'Private Street 7', '+41000000000', 'signature image',
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('maps the collection milestone and keeps the delivery window out of the stage', () => {
    const result = parseDPDTrackingApi(READY_FOR_COLLECTION, TRACKING_NUMBER, false);

    expect(result).toMatchObject({
      status: 'out_for_delivery',
      current_stage: 'ready_for_pickup',
      last_status_text: 'Ready for collection at the Pickup parcelshop',
      last_update: '2026-07-16T08:12:00+02:00',
      dpd_postcode_verified: false,
    });
    expect(result.events?.[2]).toMatchObject({
      location: 'Urdorf, CH',
      description: 'Parcel handed to DPD',
    });
  });

  it('summarizes the newest scan when the history is listed oldest first', () => {
    const history = READY_FOR_COLLECTION.parcelEvents as unknown[];
    const result = parseDPDTrackingApi({
      ...READY_FOR_COLLECTION,
      status: { description: 'RETURN_TO_SENDER' },
      parcelEvents: [...history].reverse(),
    }, TRACKING_NUMBER);

    // The first scan must not become the summary: the sync would read its
    // time as an older snapshot and keep the parcel at "handed to DPD".
    expect(result).toMatchObject({
      status: 'exception',
      current_stage: 'returned',
      last_status_text: 'Ready for collection at the Pickup parcelshop',
      last_update: '2026-07-16T08:12:00+02:00',
      // A returned parcel has no delivery to estimate.
      expected_delivery: null,
    });
    expect(result.events?.map((event) => event.description)).toEqual(
      parseDPDTrackingApi(READY_FOR_COLLECTION, TRACKING_NUMBER).events?.map((event) => event.description),
    );
  });
});

/** A one-scan history-only payload, for the time and zone rules. */
function historyAt(eventDateAndTime: string, eventDateAndTimeZoneId: unknown) {
  return parseDPDTrackingApi({
    parcelNumber: TRACKING_NUMBER,
    status: { description: 'IN_TRANSIT' },
    parcelHistory: [{ description: 'IN_TRANSIT', eventDateAndTime, eventDateAndTimeZoneId }],
  }, TRACKING_NUMBER).events?.[0]?.time;
}

/** A one-scan verified payload whose scan has a parcelHistory twin in `zone`. */
function scanWithTwinAt(date: string, time: string, zone: string | null) {
  return parseDPDTrackingApi({
    parcelNumber: TRACKING_NUMBER,
    status: { description: 'AT_DELIVERY_CENTER' },
    parcelEvents: [{
      date, time, city: 'Urdorf', country: 'CH', eventType: 'DLI',
      translation: 'Your parcel arrived at our delivery depot',
    }],
    parcelHistory: zone === null ? [] : [{
      description: 'AT_DELIVERY_CENTER', eventDateAndTime: `${date}T${time}`, eventDateAndTimeZoneId: zone,
    }],
  }, TRACKING_NUMBER).events?.[0]?.time;
}

describe('DPD verified guest payload', () => {
  it('names the webshop from the sender object, company first, and never the receiver', () => {
    const sender = DELIVERED_VERIFIED.sender as Record<string, unknown>;
    expect(parseDPDTrackingApi(DELIVERED_VERIFIED, TRACKING_NUMBER, true).sender_name)
      .toBe('Example Webshop AG');
    expect(parseDPDTrackingApi({
      ...DELIVERED_VERIFIED, sender: { ...sender, companyName: 'Example Webshop AG', name: 'Warehouse Contact' },
    }, TRACKING_NUMBER).sender_name).toBe('Example Webshop AG');
    // A sender without a name is not replaced by its address, its id or the receiver.
    const nameless = parseDPDTrackingApi({
      ...DELIVERED_VERIFIED, sender: { ...sender, name: null, companyName: 'UNDEFINED' },
    }, TRACKING_NUMBER);
    expect(nameless.sender_name).toBeUndefined();
  });

  it('keeps the delivery scan as the summary and drops the proof-of-delivery paperwork', () => {
    const result = parseDPDTrackingApi(DELIVERED_VERIFIED, TRACKING_NUMBER, true);

    expect(result).toMatchObject({
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: 'Your parcel has been delivered successfully',
      last_update: '2026-07-16T10:12:00+02:00',
      delivered_at: '2026-07-16T10:12:00+02:00',
      expected_delivery: null,
      weight_kg: 1.4,
    });
    expect(result.events?.map((event) => [event.provider_code, event.stage])).toEqual([
      ['DEY', 'delivered'],
      ['DLO', 'out_for_delivery'],
      ['DLI', 'in_transit'],
      // Unmapped like its PARCEL_HANDED twin, so its wording decides.
      ['ORI', undefined],
      ['CCO', 'in_transit'],
    ]);
  });

  it('keeps the exact time, place and wording of every scan it stored before', () => {
    // The sync keys stored events on these three strings, so a change to any
    // of them duplicates the row. Only the proof-of-delivery row and the
    // "UNDEFINED" placeholder place changed on purpose.
    expect(parseDPDTrackingApi(DELIVERED_VERIFIED, TRACKING_NUMBER, true).events
      ?.map(({ time, location, description }) => [time, location, description])).toEqual([
      ['2026-07-16T10:12:00+02:00', 'Urdorf, CH', 'Your parcel has been delivered successfully'],
      ['2026-07-16T06:10:45+02:00', 'Urdorf, CH', 'Your parcel is out for delivery'],
      ['2026-07-16T03:48:00+02:00', 'Urdorf, CH', 'Your parcel arrived at our delivery depot'],
      ['2026-07-15T18:05:12+02:00', 'Urdorf, CH', 'Your parcel arrived at our depot'],
      ['2026-07-15T16:30:00+02:00', '', 'Your parcel cleared customs successfully'],
    ]);
    expect(parseDPDTrackingApi(READY_FOR_COLLECTION, TRACKING_NUMBER).events
      ?.map(({ time, location, description }) => [time, location, description])).toEqual([
      ['2026-07-16T08:12:00+02:00', 'Zürich, CH', 'Ready for collection at the Pickup parcelshop'],
      ['2026-07-15T19:04:00+02:00', 'Buchs, CH', 'Your parcel is on its way'],
      ['2026-07-14T17:31:00+02:00', 'Urdorf, CH', 'Parcel handed to DPD'],
    ]);
  });

  it('never turns a placeholder into a location, nor the depot country past a scan country', () => {
    const events = DELIVERED_VERIFIED.parcelEvents as Array<Record<string, unknown>>;
    const result = parseDPDTrackingApi({
      ...DELIVERED_VERIFIED,
      parcelEvents: [
        ...events,
        ...['UNKNOWN', 'NULL', 'NONE', 'N/A', '-'].map((country, index) => ({
          ...events[3], time: `03:0${index}:00`, city: index % 2 ? 'undefined' : null, country,
        })),
      ],
    }, TRACKING_NUMBER, true);

    // Every added scan has depotCountry "CH"; its own placeholder country wins.
    expect(result.events?.map((event) => event.location).filter(Boolean))
      .toEqual(['Urdorf, CH', 'Urdorf, CH', 'Urdorf, CH', 'Urdorf, CH']);
    expect(JSON.stringify(result.events)).not.toMatch(/undefined|unknown|null|none|n\/a/i);
  });

  it('keeps the strings it produced before for scans that are missing a field', () => {
    // Stored events are keyed on time, place and wording, so the fallbacks for
    // an empty translation, an absent country and an unfamiliar enumeration
    // value stay what they were.
    const verified = parseDPDTrackingApi({
      parcelNumber: TRACKING_NUMBER,
      status: { description: 'AT_DELIVERY_CENTER' },
      parcelEvents: [
        {
          date: '2026-07-16', time: '03:48:00', city: 'Urdorf', country: null, depotCountry: 'CH',
          translation: '', eventTypeText: 'Destination depot - Inbound', eventType: 'DLI',
        },
        {
          date: '2026-07-16', time: '03:00:00', city: null, country: null, depotCountry: 'CH',
          translation: null, eventTypeText: 'Destination depot - Inbound', eventType: 'DLI',
        },
      ],
    }, TRACKING_NUMBER, true);
    expect(verified.events?.map(({ location, description }) => [location, description])).toEqual([
      ['Urdorf, CH', 'Tracking update'],
      ['CH', 'Destination depot - Inbound'],
    ]);

    const unverified = parseDPDTrackingApi({
      parcelNumber: TRACKING_NUMBER,
      status: { description: 'IN_TRANSIT' },
      parcelHistory: [{ description: 'UNKNOWN', eventDateAndTime: '2026-07-16T03:48:00', countryCode: 'CH' }],
    }, TRACKING_NUMBER);
    expect(unverified.events).toEqual([
      { time: '2026-07-16T03:48:00+02:00', location: 'CH', description: 'Unknown' },
    ]);
  });

  it('still reports delivery when the proof-of-delivery scan is the only evidence', () => {
    const events = DELIVERED_VERIFIED.parcelEvents as Array<Record<string, unknown>>;
    const result = parseDPDTrackingApi({
      ...DELIVERED_VERIFIED,
      parcelHistory: [],
      parcelEvents: events.filter((event) => event.eventType !== 'DEY'),
    }, TRACKING_NUMBER, true);

    expect(result.events?.[0]).toEqual({
      time: '2026-07-16T10:41:30+02:00',
      location: '',
      description: 'We received the proof of delivery',
      stage: 'delivered',
      provider_code: 'DEYY',
    });
    expect(result).toMatchObject({
      last_status_text: 'We received the proof of delivery',
      delivered_at: '2026-07-16T10:41:30+02:00',
    });
  });

  it('drops a lone proof-of-delivery scan when the parcel is not delivered', () => {
    const events = DELIVERED_VERIFIED.parcelEvents as Array<Record<string, unknown>>;
    const pod = events.find((event) => event.eventType === 'DEYY')!;
    const result = parseDPDTrackingApi({
      ...DELIVERED_VERIFIED,
      status: { ...(DELIVERED_VERIFIED.status as Record<string, unknown>), description: 'RETURN_TO_SENDER' },
      parcelHistory: [{
        description: 'RETURN_TO_SENDER', eventDateAndTime: '2026-07-16T10:12:00', eventDateAndTimeZoneId: '+02:00',
      }],
      parcelEvents: [pod, {
        date: '2026-07-16', time: '10:12:00', city: 'Urdorf', country: 'CH',
        translation: 'Your parcel is on its way back to the sender', eventType: 'ZZZ',
      }],
    }, TRACKING_NUMBER, true);

    expect(result).toMatchObject({ status: 'exception', current_stage: 'returned' });
    expect(result.delivered_at).toBeUndefined();
    expect(result.events?.map((event) => [event.provider_code, event.stage])).toEqual([['ZZZ', 'returned']]);
  });

  it('leaves unknown scan codes to the wording rules', () => {
    const result = parseDPDTrackingApi({
      parcelNumber: TRACKING_NUMBER,
      status: { description: 'IN_TRANSIT' },
      parcelEvents: [
        { date: '2026-07-15', time: '09:00:00', country: 'CH', eventType: 'XYZ', translation: 'Something new' },
        { date: '2026-07-15', time: '08:00:00', country: 'CH', eventType: 'not a code!', translation: 'Odd code' },
      ],
    }, TRACKING_NUMBER);

    expect(result.events).toEqual([
      { time: '2026-07-15T09:00:00+02:00', location: 'CH', description: 'Something new', provider_code: 'XYZ' },
      { time: '2026-07-15T08:00:00+02:00', location: 'CH', description: 'Odd code' },
    ]);
  });

  it('drops the receiver, sender address, references, product and proof-of-delivery link', () => {
    const serialized = JSON.stringify(parseDPDTrackingApi(DELIVERED_VERIFIED, TRACKING_NUMBER, true));

    for (const privateValue of [
      'Private Recipient', 'recipient@example.invalid', '+41000000000', 'Private Street', 'Private Town',
      '9999', '46.000001', '8.000001', 'geoPosition', 'Sender Street', 'Sender City', '00000',
      'SENDER0000000001', 'PRIVATE-REFERENCE', 'delivery preference', 'pod.example.invalid',
      'parcelNumber', TRACKING_NUMBER, 'DPD-CH', '[object Object]',
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });
});

describe('DPD unverified guest payload', () => {
  it('reads each scan with its own offset, code and enumeration stage', () => {
    const result = parseDPDTrackingApi(DELIVERED_UNVERIFIED, TRACKING_NUMBER, false);

    expect(result).toMatchObject({
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: 'Delivered',
      last_update: '2026-07-16T10:12:00+02:00',
      delivered_at: '2026-07-16T10:12:00+02:00',
      expected_delivery: null,
      dpd_postcode_verified: false,
    });
    expect(result.sender_name).toBeUndefined();
    expect(result.weight_kg).toBeUndefined();
    // Exact strings: stored events are keyed on them.
    expect(result.events).toEqual([
      {
        time: '2026-07-16T10:12:00+02:00', location: '', description: 'Delivered',
        stage: 'delivered', provider_code: 'DELIVERED',
      },
      {
        time: '2026-07-16T06:10:45+02:00', location: '', description: 'Parcel out for delivery',
        stage: 'out_for_delivery', provider_code: 'PARCEL_OUT_FOR_DELIVERY',
      },
      {
        time: '2026-07-16T03:48:00+02:00', location: '', description: 'At delivery center',
        provider_code: 'AT_DELIVERY_CENTER',
      },
      {
        time: '2026-07-15T18:05:12+02:00', location: '', description: 'Parcel handed to DPD',
        provider_code: 'PARCEL_HANDED',
      },
    ]);
  });
});

describe('DPD scan times', () => {
  it('takes each scan offset from its parcelHistory twin', () => {
    // 02:30 happens twice in Zurich on 2026-10-25; only the twin says which.
    expect(scanWithTwinAt('2026-10-25', '02:30:00', '+01:00')).toBe('2026-10-25T02:30:00+01:00');
    expect(scanWithTwinAt('2026-10-25', '02:30:00', '+02:00')).toBe('2026-10-25T02:30:00+02:00');
    expect(scanWithTwinAt('2026-10-25', '02:30:00', null)).toBe('2026-10-25T02:30:00+02:00');
    expect(scanWithTwinAt('2026-07-15', '10:00:00', '+01:00')).toBe('2026-07-15T10:00:00+01:00');
    expect(scanWithTwinAt('2026-07-15', '10:00:00', 'not a zone')).toBe('2026-07-15T10:00:00+02:00');
  });

  it('pairs a scan with a twin only when neither shares its wall clock', () => {
    const scansAt = (history: Array<[string, string]>, codes: string[]) => parseDPDTrackingApi({
      parcelNumber: TRACKING_NUMBER,
      status: { description: 'DELIVERED' },
      parcelHistory: history.map(([description, zone]) => ({
        description, eventDateAndTime: '2026-10-25T02:30:00', eventDateAndTimeZoneId: zone,
      })),
      parcelEvents: codes.map((code) => ({
        date: '2026-10-25', time: '02:30:00', city: 'Urdorf', country: 'CH', eventType: code, translation: code,
      })),
    }, TRACKING_NUMBER).events?.map((event) => [event.provider_code, event.time, event.stage ?? null]);

    // One history entry, two scans: the unknown code borrows no stage.
    expect(scansAt([['DELIVERED', '+01:00']], ['DEY', 'ZZZ'])).toEqual([
      ['DEY', '2026-10-25T02:30:00+01:00', 'delivered'],
      ['ZZZ', '2026-10-25T02:30:00+01:00', null],
    ]);
    // Two entries that disagree on the repeated hour: neither offset is guessed.
    expect(scansAt([['OTHER', '+01:00'], ['DELIVERED', '+02:00']], ['ZZY', 'ZZZ'])).toEqual([
      ['ZZY', '2026-10-25T02:30:00+02:00', null],
      ['ZZZ', '2026-10-25T02:30:00+02:00', null],
    ]);
    expect(scansAt([['OTHER', '+01:00'], ['DELIVERED', '+01:00']], ['ZZZ'])).toEqual([
      ['ZZZ', '2026-10-25T02:30:00+01:00', null],
    ]);
  });

  it('keeps the stored spelling when a zone id names the instant already stored', () => {
    // 02:30 does not exist in Zurich on 2026-03-29, so Swiss time read it as
    // 03:30+02:00; a +01:00 twin names that same instant.
    expect(scanWithTwinAt('2026-03-29', '02:30:00', null)).toBe('2026-03-29T03:30:00+02:00');
    expect(scanWithTwinAt('2026-03-29', '02:30:00', '+01:00')).toBe('2026-03-29T03:30:00+02:00');
    expect(historyAt('2026-03-29T02:30:00', 'GMT+1')).toBe('2026-03-29T03:30:00+02:00');
  });

  it('accepts the zone spellings DPD could plausibly send', () => {
    for (const zone of ['+01:00', '+0100', '+01', 'UTC+1', 'GMT+01:00', 'Europe/Zurich', null, '', 'not a zone', {}]) {
      expect(historyAt('2026-01-15T10:00:00', zone)).toBe('2026-01-15T10:00:00+01:00');
    }
    for (const zone of ['Z', 'UTC', 'utc', 'GMT', '+00:00']) {
      expect(historyAt('2026-01-15T10:00:00', zone)).toBe('2026-01-15T10:00:00Z');
    }
    expect(historyAt('2026-07-15T10:00:00', '+0200')).toBe('2026-07-15T10:00:00+02:00');
    expect(historyAt('2026-07-15T10:00:00', 'Europe/London')).toBe('2026-07-15T10:00:00+01:00');
    // An offset no zone has is ignored rather than stamped on the scan.
    expect(historyAt('2026-07-15T10:00:00', '+25:00')).toBe('2026-07-15T10:00:00+02:00');
    expect(historyAt('2026-07-15T10:00:00+03:00', 'Europe/Zurich')).toBe('2026-07-15T10:00:00+03:00');
  });
});

describe('DPD field hygiene', () => {
  it('never stringifies an object, array or boolean into the projection', () => {
    const odd = { name: 'Example Webshop AG' };
    const result = parseDPDTrackingApi({
      parcelNumber: TRACKING_NUMBER,
      status: { description: { code: 'DELIVERED' }, eventDateAndTime: odd },
      senderName: odd,
      sender: ['Example Webshop AG'],
      deliveryDate: odd,
      deliveryTimeFrom: true,
      weight: odd,
      parcelEvents: [{
        date: '2026-07-16', time: '10:12:00', city: odd, country: 'CH',
        translation: { en: 'Delivered' }, eventTypeText: 'Delivery - Delivered', eventType: 'DEY',
      }, {
        date: '2026-07-16', time: '09:00:00', city: 'Urdorf', country: ['CH'],
        translation: false, eventType: odd,
      }],
    }, TRACKING_NUMBER);

    expect(JSON.stringify(result)).not.toContain('[object Object]');
    expect(JSON.stringify(result)).not.toContain('true');
    expect(result.sender_name).toBeUndefined();
    expect(result.weight_kg).toBeUndefined();
    expect(result.events).toEqual([
      {
        time: '2026-07-16T10:12:00+02:00', location: 'CH', description: 'Delivery - Delivered',
        stage: 'delivered', provider_code: 'DEY',
      },
      { time: '2026-07-16T09:00:00+02:00', location: 'Urdorf', description: 'Tracking update' },
    ]);
  });

  it('reads the weight in kilograms and drops implausible values', () => {
    const weight = (value: unknown) => parseDPDTrackingApi({ ...DELIVERED_UNVERIFIED, weight: value }, TRACKING_NUMBER).weight_kg;

    expect(weight(1.4)).toBe(1.4);
    expect(weight('2,5')).toBe(2.5);
    expect(weight(12)).toBe(12);
    for (const value of [0, -1, 10_000, Number.NaN, '', 'heavy', '1e3', null, {}]) {
      expect(weight(value)).toBeUndefined();
    }
  });
});

describe('DPD status vocabulary', () => {
  it('maps the enumeration values that are unambiguous and leaves the rest unmapped', () => {
    expect(apiStage('DELIVERED')).toBe('delivered');
    expect(apiStage('RETURN_TO_SENDER')).toBe('returned');
    expect(apiStage('UNSUCCESSFUL_DELIVERY_ATTEMPT')).toBe('failed_attempt');
    // Movement through the network has no milestone of its own.
    for (const key of ['PARCEL_HANDED', 'IN_TRANSIT', 'AT_DELIVERY_CENTER', 'OTHER', { key: 'DELIVERED' }]) {
      expect(apiStage(key)).toBeNull();
    }
  });

  it('maps only the scan codes a live lookup paired with an enumeration value', () => {
    expect(['CCO', 'DLI', 'DLO', 'DEY'].map(scanStage))
      .toEqual(['in_transit', 'in_transit', 'out_for_delivery', 'delivered']);
    // ORI is left to its wording, like its PARCEL_HANDED twin.
    for (const code of ['ORI', 'DEYY', 'XYZ', '', 'CONSTRUCTOR', '__proto__']) {
      expect(scanStage(code)).toBeNull();
    }
  });

  it('documents every mapped code in statuses.json', () => {
    const { entries } = JSON.parse(
      readFileSync(new URL('./statuses.json', import.meta.url), 'utf8'),
    ) as { entries: Array<{ code: string; stage?: string }> };

    for (const { code, stage } of entries) {
      // The proof-of-delivery scan is staged by the parser, not by a map.
      if (code === 'DEYY') continue;
      expect([code, scanStage(code) ?? apiStage(code)]).toEqual([code, stage ?? null]);
    }
  });

  it('treats a failed attempt as a retry and a return as an exception', () => {
    expect(apiStatus('UNSUCCESSFUL_DELIVERY_ATTEMPT', '', true)).toBe('in_transit');
    expect(apiStatus('RETURN_TO_SENDER', '', true)).toBe('exception');
    expect(apiStatus('UNKNOWN_KEY', 'Zugestellt', true)).toBe('delivered');
  });

  it('classifies the rendered page in the four portal languages', () => {
    expect(wordingStatus('Consegnato', false)).toBe('delivered');
    expect(wordingStatus('En cours de livraison', false)).toBe('out_for_delivery');
    expect(wordingStatus('Data received', false)).toBe('pending');
    expect(wordingStatus('Something we do not know', false)).toBe('unknown');
  });
});

describe('DPDTracker steps', () => {
  it('serves the lookup from the direct guest protocol and records one step', async () => {
    const fetcher = mockGuestApi(Response.json(READY_FOR_COLLECTION));
    const { recorder, steps } = recordingRecorder();

    const result = await new DPDTracker({ timeoutMs: 1_000, trawl: null, recorder })
      .fetch(TRACKING_NUMBER, '8000');

    expect(result).toMatchObject({ status: 'out_for_delivery' });
    expect(result.tracking_url).toContain(TRACKING_NUMBER);
    expect(steps.map((step) => [step.step, step.outcome])).toEqual([['direct', 'ok']]);
    expect(String(fetcher.mock.calls[3]?.[0])).toContain('dataForVerification=8000');
  });

  it('retries without verification when DPD rejects the postcode, and says so', async () => {
    const fetcher = mockGuestApi(new Response('', { status: 400 }))
      .mockResolvedValueOnce(Response.json(READY_FOR_COLLECTION));

    const result = await new DPDTracker({ timeoutMs: 1_000, trawl: null })
      .fetch(TRACKING_NUMBER, '9999');

    expect(result.dpd_postcode_verified).toBe(false);
    expect(String(fetcher.mock.calls[4]?.[0])).toContain('continueWithoutVerification=true');
    expect(String(fetcher.mock.calls[4]?.[0])).not.toContain('9999');
  });

  it('falls back to the rendered page and records the recovery as the page step', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('<html>maintenance</html>'))
      .mockResolvedValueOnce(new Response(`
        <html><body>
          <div>${TRACKING_NUMBER}</div>
          <li class="content-item-track">
            <span class="entry-date">15.07.2026</span>
            <span class="entry-time">11:28</span>
            <span class="entry-body">Parcel handed to DPD</span>
          </li>
        </body></html>
      `));
    const { recorder, steps } = recordingRecorder();

    await expect(new DPDTracker({ timeoutMs: 1_000, trawl: null, recorder }).fetch(TRACKING_NUMBER))
      .resolves.toMatchObject({ status: 'in_transit' });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(steps.map((step) => step.step)).toEqual(['direct', 'page']);
    expect(steps[1]).toMatchObject({ fallbackFrom: 'direct', fallbackReason: 'indeterminate' });
  });

  it('keeps a positive unknown parcel out of the page fallback', async () => {
    const fetcher = mockGuestApi(new Response('', { status: 404 }));
    const { recorder, steps } = recordingRecorder();

    await expect(new DPDTracker({ timeoutMs: 1_000, trawl: null, recorder }).fetch(TRACKING_NUMBER))
      .rejects.toBeInstanceOf(DPDTrackingError);

    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(steps.map((step) => [step.step, step.outcome])).toEqual([['direct', 'not_found']]);
  });

  it('asks for a browser solver when the page itself is challenged', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('<html>maintenance</html>'))
      .mockResolvedValueOnce(new Response('<title>Just a moment...</title>', {
        status: 403, headers: { 'CF-Mitigated': 'challenge' },
      }));

    await expect(new DPDTracker({ timeoutMs: 1_000, trawl: null }).fetch(TRACKING_NUMBER))
      .rejects.toThrow('configure FLARESOLVERR_URL');
  });

  it('solves the page through the browser service when one is configured', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('<html>maintenance</html>'))
      .mockResolvedValueOnce(Response.json({
        status: 'ok',
        solution: {
          status: 200,
          response: `<html><body><div>${TRACKING_NUMBER}</div>
            <li class="content-item-track"><span class="entry-date">15.07.2026</span>
            <span class="entry-body">Parcel handed to DPD</span></li></body></html>`,
        },
      }));

    await expect(new DPDTracker({ timeoutMs: 1_000, flaresolverrUrl: 'http://trawl.internal:8191' })
      .fetch(TRACKING_NUMBER)).resolves.toMatchObject({ status: 'in_transit' });

    expect(String(fetcher.mock.calls[1]?.[0])).toBe('http://trawl.internal:8191/v1');
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({
      cmd: 'request.get',
      maxTimeout: 1_000,
    });
  });

  it('reports a Cloudflare challenge with the shared challenge status', () => {
    expect(new DPDChallengeError()).toMatchObject({ kind: 'challenge', status: 403, provider: 'DPD' });
  });
});

describe('DPD adapter factory', () => {
  it('declares both tiers and forwards the postcode as the tracking credential', async () => {
    const fetcher = mockGuestApi(Response.json(READY_FOR_COLLECTION));
    const { recorder } = recordingRecorder();
    const instance = adapter({
      trawl: null, browserExecutablePath: null, recorder, env: {},
    });

    expect(instance.id).toBe('dpd');
    expect(instance.steps).toEqual(['direct', 'page']);
    await expect(instance.track({ number: TRACKING_NUMBER, postcode: '8000' }))
      .resolves.toMatchObject({ status: 'out_for_delivery' });
    expect(String(fetcher.mock.calls[3]?.[0])).toContain('dataForVerification=8000');
  });
});

describe('DPD transient read retry', () => {
  it('retries a parcel-details 503 once without repeating authentication', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetcher = mockGuestApi(new Response('', { status: 503 }))
      .mockResolvedValueOnce(Response.json(READY_FOR_COLLECTION));
    await expect(new DPDTracker({ timeoutMs: 5_000, trawl: null }).fetch(TRACKING_NUMBER))
      .resolves.toMatchObject({ status: 'out_for_delivery' });
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(String(fetcher.mock.calls[3]![0])).toEqual(String(fetcher.mock.calls[4]![0]));
  });
  it('does not spend the retry delay when the request budget is nearly exhausted', async () => {
    const fetcher = mockGuestApi(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(`<div>${TRACKING_NUMBER}</div>`));
    await new DPDTracker({ timeoutMs: 1_000, trawl: null }).fetch(TRACKING_NUMBER).catch(() => undefined);
    expect(String(fetcher.mock.calls[4]![0])).not.toEqual(String(fetcher.mock.calls[3]![0]));
  });
});
