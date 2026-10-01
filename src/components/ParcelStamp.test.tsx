import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { EventPlace, ParcelWithEvents, Stage, TrackingEvent } from '../types';
import { dieCutOutline, ParcelStamp, stampOrigin } from './ParcelStamp';

const kyoto: EventPlace = { latitude: 35.01, longitude: 135.77, precision: 'city', country: 'JP', name: 'Kyoto' };
const zurich: EventPlace = { latitude: 47.37, longitude: 8.54, precision: 'city', country: 'CH', name: 'Zürich' };
const event = (day: number, stage: Stage, place?: EventPlace): TrackingEvent => ({
  id: `event-${day}`, parcelId: 'parcel', stage, description: 'Scan', occurredAt: `2026-09-${String(day).padStart(2, '0')}T08:00:00Z`, place,
});
const parcel = (events: TrackingEvent[]): ParcelWithEvents => ({
  id: 'parcel', carrier: 'dhl', trackingNumber: '12345678', label: 'Tea', createdAt: '2026-09-10T12:00:00Z', syncStatus: 'ok', events,
});

describe('parcel stamp', () => {
  it('names the country of the first placed scan, whatever order the scans arrive in', () => {
    const scans = [event(10, 'registered'), event(11, 'accepted', kyoto), event(20, 'out_for_delivery', zurich)];
    expect(stampOrigin(parcel(scans))).toBe('JP');
    expect(stampOrigin(parcel([...scans].reverse()))).toBe('JP');
    const { container } = render(<ParcelStamp parcel={parcel(scans)} />);
    expect(container.querySelector('.parcel-stamp__code')).toHaveTextContent('JP');
  });

  it('stays clean until the parcel is delivered, then carries the delivery date', () => {
    const travelling = render(<ParcelStamp parcel={parcel([event(11, 'accepted', kyoto), event(20, 'out_for_delivery', zurich)])} />);
    expect(travelling.container.querySelector('.parcel-stamp__postmark')).toBeNull();
    const arrived = render(<ParcelStamp parcel={parcel([event(11, 'accepted', kyoto), event(21, 'delivered', zurich)])} />);
    expect(arrived.container.querySelector('.parcel-stamp__postmark')).toHaveTextContent('21.09');
  });

  it('shows the globe alone before any scan has a place', () => {
    const { container } = render(<ParcelStamp parcel={parcel([event(10, 'registered')])} />);
    expect(stampOrigin(parcel([]))).toBeNull();
    expect(container.querySelector('.parcel-stamp__globe')).toBeInTheDocument();
    expect(container.querySelector('.parcel-stamp__code')).toBeNull();
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('cuts every edge in whole waves that close at the corners', () => {
    const outline = dieCutOutline(44, 56, 3.6, 1.1);
    const points = outline.slice(1, -1).split('L').map((point) => point.split(' ').map(Number));
    expect(points[0]).toEqual([0, 0]);
    expect(points.at(-1)).toEqual([0, 0]);
    for (const corner of [[44, 0], [44, 56], [0, 56]]) expect(points).toContainEqual(corner);
    // Nothing leaves the paper, and the top edge's twelve waves dip to the asked depth.
    expect(Math.min(...points.map(([x]) => x))).toBe(0);
    expect(Math.max(...points.map(([x]) => x))).toBe(44);
    const top = points.slice(0, points.findIndex(([x, y]) => x === 44 && y === 0) + 1);
    expect(top).toHaveLength(121);
    expect(Math.max(...top.map(([, y]) => y))).toBe(1.1);
  });
});
