import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '../../i18n';
import { parcelDisplayStatusKey } from '../../lib/parcelStatus';
import { currentStage } from '../../lib/stages';
import { JOURNEY, STILL_SCAN } from './journey';
import JourneyMap from './JourneyMap';
import SampleList from './SampleList';
import { sampleParcels } from './sampleParcels';

// jsdom has no canvas, layout or ResizeObserver: the map gets a fixed size and a 2D context that draws nothing.
const context = new Proxy({} as Record<string | symbol, unknown>, {
  get(target, key) {
    if (key in target) return target[key];
    if (key === 'createRadialGradient') return () => ({ addColorStop: () => undefined });
    if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
    return () => undefined;
  },
  set(target, key, value) { target[key] = value; return true; },
});
class FixedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() { this.callback([{ contentRect: { width: 620, height: 340 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FixedResizeObserver);
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as unknown as CanvasRenderingContext2D);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const t = (key: Parameters<typeof translate>[1], variables?: Record<string, string | number>) => translate('en', key, variables);
const dot = (container: HTMLElement) => container.querySelector<SVGGElement>('g[data-kind="current"]')!;
const place = (element: SVGGElement) => element.style.transform;

describe('JourneyMap', () => {
  it('draws the journey on the app’s own map: the route leg by leg, the parcel’s dot, and Pip in the scan’s mood', async () => {
    const { container, rerender } = render(<JourneyMap scan={0} />);
    await waitFor(() => expect(dot(container)).not.toBeNull());
    // Collected in Hamburg: nothing travelled yet, the way to Zürich still to go, and a calm Pip.
    expect(container.querySelectorAll('path[data-kind="travelled"]')).toHaveLength(0);
    expect(container.querySelector('path[data-kind="remaining"]')).not.toBeNull();
    expect(screen.getByText('Hamburg')).toHaveAttribute('data-kind', 'current');
    expect(container.querySelector('[data-pip]')).toHaveAttribute('data-pip', 'look');
    expect(dot(container).querySelectorAll('circle')).toHaveLength(2);
    const parcel = dot(container);
    const hamburg = place(parcel);

    // Customs in Basel: the first leg is drawn, the same dot has moved, and Pip waits.
    rerender(<JourneyMap scan={1} />);
    await waitFor(() => expect(container.querySelectorAll('path[data-kind="travelled"]')).toHaveLength(1));
    expect(dot(container)).toBe(parcel);
    expect(place(parcel)).not.toBe(hamburg);
    expect(screen.getByText('Basel')).toHaveAttribute('data-kind', 'current');
    expect(container.querySelector('[data-pip]')).toHaveAttribute('data-pip', 'wait');

    // Out for delivery in Zürich: both legs, nothing left to go, an eager Pip.
    rerender(<JourneyMap scan={2} />);
    await waitFor(() => expect(container.querySelectorAll('path[data-kind="travelled"]')).toHaveLength(2));
    expect(container.querySelector('path[data-kind="remaining"]')).toBeNull();
    expect(container.querySelector('[data-pip]')).toHaveAttribute('data-pip', 'eager');
    const zurich = place(parcel);

    // Delivered: the dot stays where it is, its pulse stops, and the box opens.
    rerender(<JourneyMap scan={3} />);
    await waitFor(() => expect(container.querySelector('[data-pip]')).toHaveAttribute('data-pip', 'joy'));
    expect(place(dot(container))).toBe(zurich);
    expect(dot(container).querySelectorAll('circle')).toHaveLength(1);

    // The story starts over with the picture where it was: Hamburg is where it stood at first.
    rerender(<JourneyMap scan={0} />);
    await waitFor(() => expect(container.querySelectorAll('path[data-kind="travelled"]')).toHaveLength(0));
    expect(place(dot(container))).toBe(hamburg);
  });

  it('tells a journey of four scans whose still frame is the last mile', () => {
    expect(JOURNEY.map((scan) => scan.stage)).toEqual(['accepted', 'customs', 'out_for_delivery', 'delivered']);
    expect(JOURNEY[STILL_SCAN].stage).toBe('out_for_delivery');
    expect(JOURNEY.map((scan) => scan.headline(t))).toEqual(['In transit', 'Cleared customs', 'Out for delivery', 'Delivered']);
    expect(JOURNEY.map((scan) => scan.ping(t, 'DHL'))).toEqual(['Collected by DHL', 'Cleared customs', 'Out for delivery', 'Delivered']);
  });
});

describe('SampleList', () => {
  it('shows three sample parcels in the app’s own cards: the next one on its map, then the others', async () => {
    render(<SampleList />);
    const next = screen.getByRole('button', { name: /^Next up: Kind of Blue · vinyl — In transit/ });
    expect(next).toHaveClass('parcel-card--hero', 'parcel-card--map');
    // Its route crosses half the world, so its map is the globe.
    await waitFor(() => expect(next.querySelector('[data-scale]')).toHaveAttribute('data-scale', 'world'));
    await waitFor(() => expect(within(next).getByText('Cologne')).toHaveAttribute('data-kind', 'current'));
    expect(screen.getByRole('button', { name: /^Moon lamp — In transit — expected: tomorrow/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Birthday gift — At customs' })).toBeVisible();
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('times its fictional parcels from now, all still on their way', () => {
    const now = Date.parse('2026-03-10T09:00:00Z');
    const parcels = sampleParcels(now, t);
    expect(parcels.map((parcel) => parcel.label)).toEqual(['Kind of Blue · vinyl', 'Moon lamp', 'Birthday gift']);
    expect(parcels.map((parcel) => currentStage(parcel.events))).toEqual(['in_transit', 'in_transit', 'customs']);
    expect(parcels.map((parcel) => t(parcelDisplayStatusKey(parcel)))).toEqual(['In transit', 'In transit', 'At customs']);
    expect(parcels.map((parcel) => parcel.expectedDelivery)).toEqual(['2026-03-12', '2026-03-11', undefined]);
    for (const parcel of parcels) {
      expect(parcel.events.every((event) => Date.parse(event.occurredAt) <= now)).toBe(true);
      expect(parcel.trackingNumber).toMatch(/DEMO/);
    }
  });
});
