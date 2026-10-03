import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countryPlace, buildRoute, distanceKm, formatKm, type Place, type Route, type Scan } from './route';
import { PIP_FRAME, outlineDistance, pipExtents, pipOutlines, type PipMood, type PipSide } from './Pip';
import { circleOf, targetCamera, WorldMap, type PipPlacing } from './WorldMap';

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

let frame = { width: 400, height: 300 };
class FixedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback([{ contentRect: frame } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  disconnect() {}
}

function reducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches: reduce }));
}

beforeEach(() => {
  calls = [];
  frame = { width: 400, height: 300 };
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

  it('marks a quiet route smaller, as part of a card’s picture', async () => {
    const route = buildRoute([scan(kyoto), scan(leipzig), scan(zurich)]);
    const radius = (container: HTMLElement, kind: string) => Number(container.querySelector(`g[data-kind="${kind}"] circle`)!.getAttribute('r'));
    const full = render(<WorldMap route={route} mode="journey" time={time} live={false} />);
    await waitFor(() => expect(full.container.querySelector('g[data-kind="current"]')).not.toBeNull());
    const quiet = render(<WorldMap route={route} mode="journey" time={time} live={false} labels="none" quiet />);
    await waitFor(() => expect(quiet.container.querySelector('g[data-kind="current"]')).not.toBeNull());
    expect(quiet.container.firstElementChild).toHaveAttribute('data-quiet', 'true');
    expect(full.container.firstElementChild).not.toHaveAttribute('data-quiet');
    for (const kind of ['current', 'origin', 'stop']) expect(radius(quiet.container, kind)).toBeLessThan(radius(full.container, kind));
    // The parcel's own place stays the largest mark.
    expect(radius(quiet.container, 'current')).toBeGreaterThan(radius(quiet.container, 'origin'));
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

  it('keeps a close-up of a country wider than a town', () => {
    const size = { width: 400, height: 300 };
    const spanKm = (route: Route) => size.height / targetCamera(route, 'now', size, { top: 0, right: 0, bottom: 0, left: 0 }, 'rect').scale * 6371;
    // A town-sized window on China's label point would claim to know where in China the parcel is.
    expect(spanKm(buildRoute([scan(kyoto), scan(countryPlace('CN', 'China', [106.34, 32.5]))]))).toBeGreaterThan(1500);
    expect(spanKm(buildRoute([scan(kyoto), scan(zurich)]))).toBeLessThan(500);
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

  it('names the parcel\u2019s place inside the frame', async () => {
    // Where a name is drawn, with the width the recording context measures.
    const box = (name: HTMLElement) => {
      const [left, top] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(name.style.transform)!.slice(1).map(Number);
      return { left, top, right: left + name.textContent!.length * 6 + 14, bottom: top + 22 };
    };
    frame = { width: 350, height: 160 };
    // On a card, the parcel's place lands at the west end and the destination's ring takes the one side with room.
    const card = { top: 40, right: 16, bottom: 28, left: 16 };
    const far = buildRoute([scan(kyoto), scan(city('Paris', 'FR', 2.55, 49.01))], countryPlace('CH', 'Switzerland', [7.46, 46.72]));
    const { unmount } = render(<WorldMap route={far} mode="journey" time={time} labels="ends" context={false} insets={card} />);
    const paris = box(await screen.findByText('Paris'));
    expect(paris.left).toBeGreaterThanOrEqual(card.left);
    expect(paris.right).toBeLessThanOrEqual(frame.width - card.right);
    unmount();
    // In the corner of a small frame no side of the dot has room: the name moves in from the edge.
    const small = { top: 32, right: 125, bottom: 32, left: 125 };
    const corner = buildRoute([scan(city('Bergamo', 'IT', 9.67, 45.7)), scan(city('Mulhouse', 'FR', 7.34, 47.75))]);
    render(<WorldMap route={corner} mode="journey" time={time} labels="ends" context={false} insets={small} />);
    const mulhouse = box(await screen.findByText('Mulhouse'));
    expect(mulhouse.left).toBeGreaterThanOrEqual(small.left);
    expect(mulhouse.right).toBeLessThanOrEqual(frame.width - small.right);
    expect(mulhouse.top).toBeGreaterThanOrEqual(small.top);
    expect(mulhouse.bottom).toBeLessThanOrEqual(frame.height - small.bottom);
  });

  describe('Pip beside the parcel', () => {
    const card = { top: 40, right: 16, bottom: 28, left: 16 };
    const moods: PipMood[] = ['look', 'eager', 'wait', 'worry', 'joy'];
    const hamburg = city('Hamburg', 'DE', 9.99, 53.55);
    const regensdorf = city('Regensdorf', 'CH', 8.47, 47.43);
    // The last flag: the journey ends at the frame's edge with a stop close by, which can leave no clear spot.
    const journeys: [string, Route, 'journey' | 'now', boolean][] = [
      ['a last mile', buildRoute([scan(hamburg), scan(regensdorf), scan(zurich)]), 'now', false],
      ['a journey across a country', buildRoute([scan(city('Berlin', 'DE', 13.4, 52.52)), scan(city('Neuenstein', 'DE', 9.58, 49.2))]), 'journey', false],
      ['a journey with the way still to go', buildRoute([scan(city('Lyon', 'FR', 4.83, 45.76)), scan(basel)], countryPlace('CH', 'Switzerland', [7.46, 46.72])), 'journey', false],
      ['a journey across the world', buildRoute([scan(kyoto), scan(leipzig), scan(zurich)]), 'journey', true],
      ['a journey that ends in the east', buildRoute([scan(zurich), scan(leipzig), scan(kyoto)]), 'journey', true],
      ['a single place', buildRoute([scan(zurich)]), 'journey', false],
    ];
    // Next up, the parcel's page and Next up on a wide screen. A card writes its title over the bottom of the map.
    const frames = [{ width: 350, height: 160, floor: 140 }, { width: 358, height: 176 }, { width: 660, height: 160, floor: 140 }];

    type Box = { left: number; top: number; right: number; bottom: number };
    // Positions are written to a tenth of a pixel, so boxes that only touch may seem to meet by less than that.
    const meets = (a: Box, b: Box) => a.left < b.right - .1 && a.right > b.left + .1 && a.top < b.bottom - .1 && a.bottom > b.top + .1;
    const offset = (element: Element) => /translate\((-?[\d.]+)(?:px,)? (-?[\d.]+)/.exec(element.getAttribute('transform') ?? (element as HTMLElement).style.transform)!
      .slice(1).map(Number) as [number, number];

    /** What the map drew, read back from the page: Pip, the dots, the names and points along every leg. */
    function drawn(container: HTMLElement) {
      const element = container.querySelector<HTMLElement>('[data-pip]');
      const [left, top] = element ? offset(element) : [0, 0];
      const mood = element?.dataset.pip as PipMood;
      const side = Number(element?.dataset.side) as PipSide;
      const unit = parseFloat(element?.style.width ?? '0') / PIP_FRAME.width;
      const extents = element ? pipExtents(mood, side) : { left: 0, top: 0, right: 0, bottom: 0 };
      const route = [...container.querySelectorAll('path[data-kind]')].flatMap((leg) => {
        const points = [...leg.getAttribute('d')!.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(([, x, y]) => [Number(x), Number(y)]);
        const steps = Array.from({ length: 41 }, (_, index) => index / 40);
        // A short hop is one curve; a long leg is a line through many points.
        if (leg.getAttribute('d')!.includes('Q')) {
          const [[x1, y1], [cx, cy], [x2, y2]] = points;
          return steps.map((t) => [(1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t * t * x2, (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t * t * y2]);
        }
        return points.slice(1).flatMap(([x, y], index) => steps.map((t) => [points[index][0] + (x - points[index][0]) * t, points[index][1] + (y - points[index][1]) * t]));
      });
      return {
        pip: element && {
          mood, side, width: parseFloat(element.style.width),
          box: { left: left + extents.left * unit, top: top + extents.top * unit, right: left + extents.right * unit, bottom: top + extents.bottom * unit },
          // How far a point of the map is from the drawing itself.
          away: ([x, y]: number[]) => Math.min(...pipOutlines(mood, side).map((outline) => outlineDistance([(x - left) / unit, (y - top) / unit], outline))) * unit,
        },
        parcel: offset(container.querySelector('g[data-kind="current"]')!),
        dots: [...container.querySelectorAll('g[data-kind]')].map(offset),
        names: [...container.querySelectorAll<HTMLElement>('span[data-kind]')].map((name) => {
          const [x, y] = offset(name);
          return { text: name.textContent!, left: x, top: y, right: x + name.textContent!.length * 6 + 14, bottom: y + 22 };
        }),
        route,
      };
    }

    async function show(size: { width: number; height: number }, route: Route, mode: 'journey' | 'now', pip: PipPlacing, insets = card) {
      frame = size;
      const view = render(<WorldMap route={route} mode={mode} time={time} look="tint" labels="ends" context={false} insets={insets} pip={pip} />);
      await waitFor(() => expect(view.container.querySelector('g[data-kind="current"]')).not.toBeNull());
      return { ...view, ...drawn(view.container) };
    }

    it.each(journeys)('never covers the dot or a name, and keeps off the route where there is room, on %s', async (_, route, mode, edge) => {
      for (const { floor, ...size } of frames) {
        // A delivered parcel is never Next up, so the open box is only drawn on the parcel's page.
        for (const mood of moods.filter((mood) => mood !== 'joy' || !floor)) {
          const { pip, parcel, dots, names, route: legs, unmount } = await show(size, route, mode, { mood, ceiling: 52, floor });
          const where = `${mood} in ${size.width} × ${size.height}`;
          expect(pip, where).not.toBeNull();
          expect(pip!.mood).toBe(mood);
          // Inside the map, below the card's top row and above what the card writes over the map.
          expect(pip!.box.left, where).toBeGreaterThanOrEqual(4);
          expect(pip!.box.right, where).toBeLessThanOrEqual(size.width - 4);
          expect(pip!.box.top, where).toBeGreaterThanOrEqual(52);
          expect(pip!.box.bottom, where).toBeLessThanOrEqual(floor ?? size.height - 4);
          expect(pip!.away(parcel), where).toBeGreaterThanOrEqual(9.9);
          expect(names.map((name) => name.text), where).toContain(route.current!.place.name);
          for (const name of names) expect(meets(name, pip!.box), `${where}: ${name.text}`).toBe(false);
          // He looks toward the dot from the side he stands on.
          expect([0, Math.sign(parcel[0] - (pip!.box.left + pip!.box.right) / 2)], where).toContain(pip!.side);
          // With no clear spot he takes the one with the fewest overlaps: at most the stop beside the dot and the leg between them.
          const covered = dots.filter((dot) => pip!.away(dot) < 5.9).length + (legs.some((point) => pip!.away(point) < 1.4) ? 1 : 0);
          expect(covered, where).toBeLessThanOrEqual(edge ? 2 : 0);
          unmount();
        }
      }
    });

    it('trails an eager Pip\u2019s speed lines away from the dot', async () => {
      const { container, pip, parcel } = await show(frames[1], journeys[0][1], 'now', { mood: 'eager', ceiling: 52 });
      const lines = container.querySelector('[data-pip] path[opacity=".32"]')!;
      const right = parcel[0] < (pip!.box.left + pip!.box.right) / 2;
      // The dot is on his left, so the lines are mirrored to his right.
      expect(lines.hasAttribute('transform')).toBe(right);
      expect(pip!.side).toBe(right ? -1 : 1);
    });

    it('shrinks, then stays away, when the map has no room beside the dot', async () => {
      const world = journeys[3][1];
      // The parcel ends at the frame's edge: only a smaller Pip finds a clear spot.
      const delivered = await show(frames[1], world, 'journey', { mood: 'joy', ceiling: 52 });
      expect(delivered.pip!.width).toBeLessThan(66);
      delivered.unmount();
      const cramped = await show({ width: 120, height: 70 }, world, 'journey', { mood: 'joy' }, { top: 4, right: 4, bottom: 4, left: 4 });
      expect(cramped.pip).toBeNull();
      expect(cramped.names.map((name) => name.text)).toContain('Zürich');
    });

    it('leaves the map as it was without him', async () => {
      frame = { width: 350, height: 160 };
      const { container } = render(<WorldMap route={journeys[0][1]} mode="now" time={time} look="tint" labels="ends" context={false} insets={card} />);
      await waitFor(() => expect(container.querySelector('g[data-kind="current"]')).not.toBeNull());
      expect(container.querySelector('[data-pip]')).toBeNull();
    });

    it('keeps names off the route when a side allows it', async () => {
      const { names, route } = await show(frames[1], journeys[1][1], 'journey', { mood: 'look', ceiling: 52 });
      for (const name of names) {
        expect(route.some(([x, y]) => x > name.left && x < name.right && y > name.top && y < name.bottom), name.text).toBe(false);
      }
    });
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

  it('names a facility by its town on a card, once, and by its own name on the opened map', async () => {
    const centre: Place = { ...city('Zürich', 'CH', 8.4695, 47.3959), id: 'centre', site: 'Zürich-Mülligen' };
    const route = buildRoute([scan(basel), scan(centre), scan(zurich)]);
    const { rerender } = render(<WorldMap route={route} mode="journey" time={time} context={false} />);
    await screen.findByText('Basel');
    // The town and the centre 7 km from it are both "Zürich": the name is written once, at the parcel.
    expect(screen.getByText('Zürich')).toHaveAttribute('data-kind', 'current');
    expect(screen.queryByText('Zürich-Mülligen')).not.toBeInTheDocument();
    rerender(<WorldMap route={route} mode="journey" time={time} context={false} sites />);
    expect(screen.getByText('Zürich-Mülligen')).toHaveAttribute('data-kind', 'stop');
    expect(screen.getByText('Zürich')).toHaveAttribute('data-kind', 'current');
    // Far from the centre, the pointer to it follows the same rule.
    const far = buildRoute([scan(centre), scan(kyoto)]);
    rerender(<WorldMap route={far} mode="now" time={time} context={false} />);
    await waitFor(() => expect(screen.getByText('Zürich').tagName).toBe('STRONG'));
    rerender(<WorldMap route={far} mode="now" time={time} context={false} sites />);
    expect(screen.getByText('Zürich-Mülligen').tagName).toBe('STRONG');
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

  it('keeps the names in view when a new scan frames the map the same way', async () => {
    reducedMotion(false);
    const scans = [scan(kyoto), scan(basel), scan(zurich)];
    const { rerender } = render(<WorldMap route={buildRoute(scans)} mode="now" time={time} />);
    expect((await screen.findByText('Kyoto')).parentElement?.textContent).toContain('km');
    // Another scan at the same place: a new route, the same view, so no flight hides the pointer.
    rerender(<WorldMap route={buildRoute([...scans, scan(zurich)])} mode="now" time={time} />);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(screen.getByText('Kyoto').parentElement?.textContent).toContain('km');
  });

  it('keeps one picture for a journey told scan by scan, and lets the parcel travel across it', async () => {
    const leipzigOnly = buildRoute([scan(leipzig)], zurich);
    const whole = buildRoute([scan(leipzig), scan(basel), scan(zurich)]);
    const dot = (container: HTMLElement) => container.querySelector<SVGGElement>('g[data-kind="current"]')!;
    const { container, rerender } = render(<WorldMap route={leipzigOnly} framing={whole} mode="journey" time={time} glide pip={{ mood: 'look' }} />);
    await waitFor(() => expect(dot(container)).not.toBeNull());
    // The travelling dot is placed by a style, which can be eased; every other dot keeps its attribute.
    const first = dot(container);
    expect(first).toHaveAttribute('data-glide');
    expect(first).not.toHaveAttribute('transform');
    expect(first.style.transform).toMatch(/^translate\(/);
    expect(container.querySelector('g[data-kind="destination"]')).toHaveAttribute('transform');
    expect(container.querySelector('[data-pip]')).toHaveAttribute('data-glide');
    const start = first.style.transform;
    const framed = targetCamera(whole, 'journey', frame, { top: 0, right: 0, bottom: 0, left: 0 }, 'rect');
    const alone = targetCamera(leipzigOnly, 'journey', frame, { top: 0, right: 0, bottom: 0, left: 0 }, 'rect');
    expect(framed.scale).not.toBeCloseTo(alone.scale, 0);

    // The next scan: the same element moves on, the place it left keeps a dot of its own, and the picture stays.
    rerender(<WorldMap route={whole} framing={whole} mode="journey" time={time} glide pip={{ mood: 'eager' }} />);
    await waitFor(() => expect(container.querySelectorAll('path[data-kind="travelled"]')).toHaveLength(2));
    expect(dot(container)).toBe(first);
    expect(first.style.transform).not.toBe(start);
    const origin = container.querySelector('g[data-kind="origin"]')!;
    expect(origin.getAttribute('transform')!.replace(/[^\d.]+/g, ' ').trim().split(' ').map(Number).map(Math.round))
      .toEqual(start.replace(/[^\d.]+/g, ' ').trim().split(' ').map(Number).map(Math.round));
  });

  it('places every dot by its attribute, and frames the route itself, unless told otherwise', async () => {
    const route = buildRoute([scan(leipzig), scan(zurich)]);
    const { container } = render(<WorldMap route={route} mode="journey" time={time} pip={{ mood: 'look' }} />);
    await waitFor(() => expect(container.querySelector('g[data-kind="current"]')).not.toBeNull());
    expect(container.querySelector('g[data-kind="current"]')).toHaveAttribute('transform');
    expect(container.querySelector('[data-glide]')).toBeNull();
  });

  it('waits for a size before drawing', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const route = buildRoute([scan(kyoto), scan(zurich)]);
    const { container } = render(<WorldMap route={route} mode="journey" time={time} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.querySelector('svg')).toBeNull();
  });
});
