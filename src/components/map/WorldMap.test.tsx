import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countryPlace, buildRoute, distanceKm, formatKm, type Place, type Scan } from './route';
import { circleOf, WorldMap } from './WorldMap';

const city = (name: string, country: string, longitude: number, latitude: number): Place => ({
  id: name, name, country, coordinate: [longitude, latitude], precision: 'city',
});
const kyoto = city('Kyoto', 'JP', 135.77, 35.01);
const leipzig = city('Leipzig', 'DE', 12.37, 51.34);
const basel = city('Basel', 'CH', 7.59, 47.56);
const zurich = city('Zürich', 'CH', 8.54, 47.38);
const mulligen = city('Mülligen', 'CH', 8.46, 47.39);
const scan = (place?: Place): Scan => ({ at: '2026-09-28T10:00:00Z', description: 'Scan', stage: 'in_transit', place });
const time = new Date('2026-09-28T12:00:00Z');

// jsdom has no canvas, layout or ResizeObserver: the map gets a fixed size and a recording 2D context.
let calls: string[] = [];
const context = new Proxy({} as Record<string | symbol, unknown>, {
  get(target, key) {
    if (key in target) return target[key];
    if (key === 'createRadialGradient') return () => {
      calls.push(key);
      return { addColorStop: () => undefined };
    };
    if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
    return () => { calls.push(String(key)); };
  },
  set(target, key, value) {
    target[key] = value;
    return true;
  },
});

class FixedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback([{ contentRect: { width: 400, height: 300 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  disconnect() {}
}

function reducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches: reduce }));
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal('ResizeObserver', FixedResizeObserver);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as unknown as CanvasRenderingContext2D);
  reducedMotion(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WorldMap', () => {
  it('draws a journey across the world with its places named', async () => {
    const route = buildRoute([scan(kyoto), scan(leipzig), scan(zurich)]);
    const { container, rerender } = render(<WorldMap route={route} mode="journey" time={time} night />);
    await waitFor(() => expect(container.querySelectorAll('path[data-kind="travelled"]')).toHaveLength(2));
    expect(screen.getByRole('img', { name: `Map: from Kyoto to Zürich, ${formatKm(route.km)} so far` })).toHaveAttribute('data-scale', 'world');
    expect(screen.getByText('Kyoto')).toBeInTheDocument();
    expect(screen.getByText('Zürich')).toHaveAttribute('data-kind', 'current');
    expect(container.querySelector('[data-kind="origin"]')).not.toBeNull();
    // Zoomed out, the globe gets its shading and rim, and the night side is filled in.
    expect(calls).toEqual(expect.arrayContaining(['fill', 'stroke', 'createRadialGradient']));
    expect(calls.filter((call) => call === 'fill').length).toBeGreaterThan(20);
    // The current position pulses unless the map is told to stay still.
    expect(container.querySelectorAll('g[data-kind="current"] circle')).toHaveLength(2);
    rerender(<WorldMap route={route} mode="journey" time={time} night live={false} />);
    expect(container.querySelectorAll('g[data-kind="current"] circle')).toHaveLength(1);
  });

  it('points to the far ends of the journey from a close-up', async () => {
    const route = buildRoute([scan(kyoto), scan(basel), scan(zurich)]);
    const { container } = render(<WorldMap route={route} mode="now" time={time} languageTag="de-CH" label="Parcel map" />);
    const pointer = await screen.findByText('Kyoto');
    expect(pointer.parentElement).toHaveTextContent(`Kyoto ${formatKm(distanceKm(zurich.coordinate, kyoto.coordinate), 'de-CH')}`);
    expect(screen.getByRole('img', { name: 'Parcel map' })).toHaveAttribute('data-mode', 'now');
    expect(container.querySelectorAll('[data-kind="stop"], [data-kind="current"]').length).toBeGreaterThan(0);
  });

  it('flies to a new view, then settles', async () => {
    reducedMotion(false);
    const route = buildRoute([scan(kyoto), scan(basel), scan(zurich)]);
    const { rerender } = render(<WorldMap route={route} mode="journey" time={time} />);
    await screen.findByText('Kyoto');
    rerender(<WorldMap route={route} mode="now" time={time} />);
    // The edge pointer waits for the camera to land.
    await waitFor(() => expect(screen.getByText('Kyoto').parentElement?.textContent).toContain('km'), { timeout: 4000 });
  });

  it('shows countries as areas and the leg still to go', async () => {
    const china = countryPlace('CN', 'China', [106.34, 32.5]);
    const switzerland = countryPlace('CH', 'Switzerland', [7.46, 46.72]);
    const route = buildRoute([scan(china)], switzerland);
    const { container } = render(<WorldMap route={route} mode="journey" time={time} labels="ends" />);
    await waitFor(() => expect(container.querySelector('path[data-kind="remaining"]')).not.toBeNull());
    expect(screen.getByText('CHINA')).toHaveAttribute('data-kind', 'area');
    expect(screen.getByText('SWITZERLAND')).toHaveAttribute('data-kind', 'area');
    expect(container.querySelector('g[data-kind="destination"]')).not.toBeNull();
    expect(screen.getByRole('img')).toHaveAccessibleName('Map: from China to Switzerland');
  });

  it('marks the last known stop when the newest scan has no place', async () => {
    const route = buildRoute([scan(kyoto), scan(basel), scan()]);
    const { container } = render(<WorldMap route={route} mode="journey" time={time} labels="none" context={false} />);
    await waitFor(() => expect(container.querySelector('g[data-kind="last-known"]')).not.toBeNull());
    expect(screen.queryByText('Basel')).not.toBeInTheDocument();
  });

  it('frames a town, a single place and nothing at all', async () => {
    const town = buildRoute([scan(mulligen), scan(zurich)]);
    const { container, rerender } = render(<WorldMap route={town} mode="journey" time={time} />);
    await waitFor(() => expect(container.querySelector('path[data-kind="travelled"]')).not.toBeNull());
    rerender(<WorldMap route={buildRoute([scan(zurich)])} mode="journey" time={time} />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Map: Zürich');
    rerender(<WorldMap route={buildRoute([])} mode="journey" time={time} />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Map: no places reported yet');
    await waitFor(() => expect(container.querySelector('svg path')).toBeNull());
  });

  it('skips transparent layers and cuts lakes out of a see-through map', async () => {
    const colors: Record<string, string> = { ocean: 'rgba(0, 0, 0, 0)', night: 'transparent', grid: 'rgb(0 0 0 / 0)' };
    const original = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => element instanceof HTMLElement && element.dataset.color
      ? { color: colors[element.dataset.color] ?? 'rgb(10, 20, 30)' } as CSSStyleDeclaration
      : original(element, pseudo));
    const route = buildRoute([scan(mulligen), scan(zurich)]);
    const { container } = render(<WorldMap route={route} mode="journey" time={time} look="tint" night />);
    await waitFor(() => expect(container.querySelector('path[data-kind="travelled"]')).not.toBeNull());
    expect(context.globalCompositeOperation).toBe('source-over');
    expect(calls).toContain('fill');
  });

  it('draws a round window and keeps pointers outside its rim', async () => {
    const route = buildRoute([scan(kyoto), scan(basel), scan(zurich)]);
    const insets = { top: 20, right: 20, bottom: 20, left: 20 };
    const { container } = render(<WorldMap route={route} mode="now" shape="circle" insets={insets} time={time} />);
    await screen.findByText('Kyoto');
    expect(container.querySelector('clipPath circle')).toHaveAttribute('r', String(circleOf({ width: 400, height: 300 }, insets).radius));
    expect(calls).toContain('clip');
  });

  it('shows the whole globe in a round window when the journey spans it', async () => {
    const route = buildRoute([scan(kyoto), scan(leipzig), scan(city('Santiago', 'CL', -70.67, -33.45))]);
    const { container } = render(<WorldMap route={route} mode="journey" shape="circle" time={time} />);
    await waitFor(() => expect(container.querySelectorAll('path[data-kind="travelled"]').length).toBeGreaterThan(0));
  });

  it('lets people pan an interactive globe and brings it back to the parcel', async () => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
    const onFreeChange = vi.fn();
    const route = buildRoute([scan(kyoto), scan(leipzig), scan(zurich)]);
    const { container, rerender } = render(<WorldMap route={route} mode="journey" time={time} interactive onFreeChange={onFreeChange} />);
    await waitFor(() => expect(container.querySelector('path[data-kind="travelled"]')).not.toBeNull());
    const map = screen.getByRole('img');
    fireEvent.pointerDown(map, { pointerId: 1, button: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 180, clientY: 120 });
    expect(onFreeChange).not.toHaveBeenCalledWith(true);
    fireEvent.pointerDown(map, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(map, { pointerId: 2, clientX: 180, clientY: 120 });
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 102, clientY: 101 });
    expect(onFreeChange).not.toHaveBeenCalledWith(true);
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 180, clientY: 120 });
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 190, clientY: 130 });
    expect(onFreeChange).toHaveBeenCalledWith(true);
    expect(onFreeChange).toHaveBeenCalledTimes(2);
    fireEvent.pointerUp(map, { pointerId: 1 });
    onFreeChange.mockClear();
    rerender(<WorldMap route={route} mode="journey" time={time} interactive onFreeChange={onFreeChange} recenter={1} />);
    await waitFor(() => expect(onFreeChange).toHaveBeenCalledWith(false));
    delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
  });

  it('leaves a moved map where it was put when its frame changes, until a view is chosen', async () => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
    const onFreeChange = vi.fn();
    const route = buildRoute([scan(zurich)]);
    const map = (bottom: number, mode: 'journey' | 'now' = 'journey') => <WorldMap route={route} mode={mode} time={time} interactive
      insets={{ top: 0, right: 0, bottom, left: 0 }} onFreeChange={onFreeChange} />;
    const { container, rerender } = render(map(60));
    const dot = () => container.querySelector('g[data-kind="current"]')?.getAttribute('transform');
    await waitFor(() => expect(dot()).toBeTruthy());
    onFreeChange.mockClear();
    const view = screen.getByRole('img');
    fireEvent.pointerDown(view, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(view, { pointerId: 1, clientX: 160, clientY: 120 });
    fireEvent.pointerUp(view, { pointerId: 1 });
    expect(onFreeChange).toHaveBeenLastCalledWith(true);
    const moved = dot();
    // The summary beside the map grows and takes room from its frame.
    rerender(map(120));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(dot()).toBe(moved);
    expect(onFreeChange).not.toHaveBeenCalledWith(false);
    rerender(map(120, 'now'));
    await waitFor(() => expect(onFreeChange).toHaveBeenLastCalledWith(false));
    expect(dot()).not.toBe(moved);
    delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
  });

  it('zooms the full map with a pinch or a wheel', async () => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
    const onFreeChange = vi.fn();
    const route = buildRoute([scan(kyoto), scan(leipzig), scan(zurich)]);
    const { container } = render(<WorldMap route={route} mode="journey" time={time} interactive onFreeChange={onFreeChange} />);
    await waitFor(() => expect(container.querySelector('path[data-kind="travelled"]')).not.toBeNull());
    const map = screen.getByRole('img');
    const leg = () => container.querySelector('path[data-kind="travelled"]')!.getAttribute('d');
    const before = leg();
    fireEvent.pointerDown(map, { pointerId: 1, button: 0, clientX: 150, clientY: 150 });
    fireEvent.pointerDown(map, { pointerId: 2, button: 0, clientX: 250, clientY: 150 });
    fireEvent.pointerMove(map, { pointerId: 2, clientX: 350, clientY: 150 });
    expect(onFreeChange).toHaveBeenCalledWith(true);
    expect(leg()).not.toBe(before);
    fireEvent.pointerUp(map, { pointerId: 2 });
    fireEvent.pointerUp(map, { pointerId: 1 });
    const pinched = leg();
    fireEvent.wheel(map, { deltaY: -120, clientX: 200, clientY: 150 });
    expect(leg()).not.toBe(pinched);
    delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
  });

  it('lets a card peek closer with a pinch, then settles back', async () => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
    const onOpen = vi.fn();
    const route = buildRoute([scan(kyoto), scan(leipzig), scan(zurich)]);
    const { container } = render(<div onClick={onOpen}><WorldMap route={route} mode="journey" time={time} peek /></div>);
    await waitFor(() => expect(container.querySelector('path[data-kind="travelled"]')).not.toBeNull());
    const map = screen.getByRole('img');
    const leg = () => container.querySelector('path[data-kind="travelled"]')!.getAttribute('d');
    const resting = leg();
    // One finger is left to the page: no drag, and a tap opens the map.
    fireEvent.pointerDown(map, { pointerId: 1, button: 0, clientX: 150, clientY: 150 });
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 250, clientY: 150 });
    expect(leg()).toBe(resting);
    fireEvent.pointerUp(map, { pointerId: 1 });
    fireEvent.click(map);
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(map, { pointerId: 1, button: 0, clientX: 150, clientY: 150 });
    fireEvent.pointerDown(map, { pointerId: 2, button: 0, clientX: 250, clientY: 150 });
    fireEvent.pointerMove(map, { pointerId: 2, clientX: 350, clientY: 150 });
    expect(leg()).not.toBe(resting);
    fireEvent.pointerUp(map, { pointerId: 2 });
    // Lifting the fingers is not a tap, and the map settles back.
    fireEvent.click(map);
    expect(onOpen).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(leg()).toBe(resting));
    fireEvent.pointerUp(map, { pointerId: 1 });
    delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
  });

  it('waits for a size before drawing', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const route = buildRoute([scan(kyoto), scan(zurich)]);
    const { container } = render(<WorldMap route={route} mode="journey" time={time} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.querySelector('svg')).toBeNull();
  });
});
