import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scroll, stubIntersections, watching } from '../../test/intersections';
import { useLive, useNear, useReducedMotion, useRise, useTabShown } from './useLive';

function Probe({ share }: { share?: number }) {
  const target = useRef<HTMLDivElement>(null);
  const live = useLive(target, share);
  const near = useNear(target);
  const rise = useRise(target);
  return <div ref={target} data-testid="target" data-live={live} data-near={near} data-rise={rise ?? 'none'}
    data-tab={useTabShown()} data-still={useReducedMotion()} />;
}

const target = () => screen.getByTestId('target');
function showTab(shown: boolean) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(shown ? 'visible' : 'hidden');
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
}
function motion(reduced: boolean) {
  const listeners = new Set<() => void>();
  const query = { matches: reduced, addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) };
  vi.stubGlobal('matchMedia', vi.fn(() => query));
  return (next: boolean) => act(() => { query.matches = next; for (const listener of listeners) listener(); });
}

beforeEach(() => { stubIntersections(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('useLive', () => {
  it('is live only while the element is on screen in a tab someone is looking at', () => {
    render(<Probe />);
    expect(target()).toHaveAttribute('data-live', 'false');
    scroll(target(), .4);
    expect(target()).toHaveAttribute('data-live', 'true');
    showTab(false);
    expect(target()).toHaveAttribute('data-live', 'false');
    expect(target()).toHaveAttribute('data-tab', 'false');
    showTab(true);
    expect(target()).toHaveAttribute('data-live', 'true');
    scroll(target(), 0);
    expect(target()).toHaveAttribute('data-live', 'false');
  });

  it('can wait until a good part of the element shows', () => {
    render(<Probe share={.3} />);
    scroll(target(), .1);
    expect(target()).toHaveAttribute('data-live', 'false');
    scroll(target(), .5);
    expect(target()).toHaveAttribute('data-live', 'true');
  });

  it('is never live on the server, or where nothing can tell what is on screen', () => {
    expect(renderToString(<Probe />)).toContain('data-live="false"');
    vi.unstubAllGlobals();
    render(<Probe />);
    expect(target()).toHaveAttribute('data-live', 'false');
    expect(target()).toHaveAttribute('data-near', 'false');
    expect(target()).toHaveAttribute('data-rise', 'none');
  });

  it('stops watching when the element goes', () => {
    const view = render(<Probe />);
    const element = target();
    expect(watching(element)).toBe(3);
    view.unmount();
    expect(watching(element)).toBe(0);
  });
});

describe('useNear', () => {
  it('turns true once the element comes close, and stays true', () => {
    render(<Probe />);
    const element = target();
    expect(element).toHaveAttribute('data-near', 'false');
    scroll(element, .2);
    expect(element).toHaveAttribute('data-near', 'true');
    // It has stopped looking: what it loaded stays loaded.
    scroll(element, 0);
    expect(element).toHaveAttribute('data-near', 'true');
  });
});

describe('useRise', () => {
  it('waits below the screen, then rises when scrolled to', () => {
    render(<Probe />);
    scroll(target(), 0, 1_400);
    expect(target()).toHaveAttribute('data-rise', 'wait');
    scroll(target(), .3);
    expect(target()).toHaveAttribute('data-rise', 'go');
  });

  it('leaves alone what was in sight from the start', () => {
    render(<Probe />);
    scroll(target(), .6);
    expect(target()).toHaveAttribute('data-rise', 'none');
    scroll(target(), 0, 1_400);
    expect(target()).toHaveAttribute('data-rise', 'none');
  });

  it('never hides something that shows a sliver at the foot of the screen', () => {
    render(<Probe />);
    scroll(target(), 0, 760);
    expect(target()).toHaveAttribute('data-rise', 'none');
  });

  it('stays out of the way of a reader who asked for less motion', () => {
    motion(true);
    render(<Probe />);
    scroll(target(), 0, 1_400);
    expect(target()).toHaveAttribute('data-rise', 'none');
  });
});

describe('useReducedMotion', () => {
  it('follows the reader’s setting as it changes', () => {
    const change = motion(false);
    render(<Probe />);
    expect(target()).toHaveAttribute('data-still', 'false');
    change(true);
    expect(target()).toHaveAttribute('data-still', 'true');
  });
});
