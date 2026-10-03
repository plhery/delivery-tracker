import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { carrierInfo } from '../../lib/carriers';
import { HeroPip, UNBOXING_MS } from './HeroPip';

const onOpening = vi.fn();
const onOpen = vi.fn();
const pip = () => document.querySelector<HTMLElement>('.door-pip')!;
const pass = (milliseconds: number) => act(() => { vi.advanceTimersByTime(milliseconds); });
function motion(reduced: boolean) {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: reduced && query.includes('reduce'), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
}
/** Pip stands in the first screen, which is what he watches. */
const stage = (ui: React.ReactNode) => render(<section className="door-hero">{ui}</section>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  motion(false);
  history.replaceState(null, '', '/');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); history.replaceState(null, '', '/'); });

describe('HeroPip', () => {
  it('is the way to a sample while the field is empty, and says so under him', () => {
    stage(<HeroPip sample happy={false} hop="" onOpening={onOpening} onOpen={onOpen} />);
    const link = screen.getByRole('link', { name: 'Open a sample parcel' });
    expect(link).toHaveAttribute('href', '/sample');
    expect(document.querySelector('.door-hint')).toHaveTextContent('No number handy? Tap Pip to open a sample.');
    expect(document.querySelector('.door-hint strong')).toHaveTextContent('Tap Pip');
    expect(document.querySelector('.door-hint')).toHaveAttribute('data-shown');
    // The drawing itself says nothing to a screen reader.
    expect(pip().querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(pip().style.viewTransitionName).toBe('peek-pip');
  });

  it('opens the box first, then says that the sample parcel can show', () => {
    stage(<HeroPip sample happy={false} hop="" onOpening={onOpening} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('link', { name: 'Open a sample parcel' }));
    expect(pip()).toHaveClass('door-pip--opening');
    expect(document.querySelector('.door-hint')).toHaveTextContent('Opening a sample…');
    expect(onOpening).toHaveBeenCalledOnce();
    // A second tap while the box opens changes nothing.
    fireEvent.click(screen.getByRole('link', { name: 'Open a sample parcel' }));
    expect(onOpening).toHaveBeenCalledOnce();
    pass(UNBOXING_MS - 1);
    expect(onOpen).not.toHaveBeenCalled();
    pass(1);
    expect(onOpen).toHaveBeenCalledOnce();
    // The address is not his to change.
    expect(location.pathname).toBe('/');
  });

  it('opens at once for someone who asked for less motion', () => {
    motion(true);
    stage(<HeroPip sample happy={false} hop="" onOpening={onOpening} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('link', { name: 'Open a sample parcel' }));
    pass(79);
    expect(onOpen).not.toHaveBeenCalled();
    pass(1);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('leaves a modified click to the browser, which opens the sample in a new tab', () => {
    stage(<HeroPip sample happy={false} hop="" onOpening={onOpening} onOpen={onOpen} />);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
    act(() => { screen.getByRole('link', { name: 'Open a sample parcel' }).dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
    expect(onOpening).not.toHaveBeenCalled();
  });

  it('is the parcel being tracked once there is something in the field: no link, no hint, the carrier’s label on the box', () => {
    stage(<HeroPip sample={false} happy={false} hop="" onOpening={onOpening} onOpen={onOpen} label={{ carrier: carrierInfo('ups'), number: '1ZDEMO202600000001' }} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(document.querySelector('.door-hint')).not.toHaveAttribute('data-shown');
    expect(pip().querySelector('.parcel-illustration__label-number')).toHaveTextContent('1ZDEMO202600000001');
    fireEvent.click(pip().querySelector('.door-pip__tap')!);
    pass(UNBOXING_MS);
    expect(onOpen).not.toHaveBeenCalled();
    expect(pip()).not.toHaveClass('door-pip--opening');
  });

  it('smiles while a carrier answers, and hops once for each answer', () => {
    const animate = vi.fn();
    const view = stage(<HeroPip sample happy={false} hop="" onOpening={onOpening} onOpen={onOpen} />);
    document.querySelector<HTMLElement>('.door-pip__hop')!.animate = animate;
    expect(pip()).not.toHaveAttribute('data-mood');
    view.rerender(<section className="door-hero"><HeroPip sample happy hop="sample:0" onOpening={onOpening} onOpen={onOpen} /></section>);
    expect(pip()).toHaveAttribute('data-mood', 'happy');
    expect(animate).toHaveBeenCalledOnce();
    // The same answer again is no new hop; the answer going away is none either.
    view.rerender(<section className="door-hero"><HeroPip sample happy hop="sample:0" onOpening={onOpening} onOpen={onOpen} /></section>);
    view.rerender(<section className="door-hero"><HeroPip sample happy={false} hop="" onOpening={onOpening} onOpen={onOpen} /></section>);
    expect(animate).toHaveBeenCalledOnce();
    view.rerender(<section className="door-hero"><HeroPip sample happy hop="sample:1" onOpening={onOpening} onOpen={onOpen} /></section>);
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it('stands still for someone who asked for less motion', () => {
    motion(true);
    const animate = vi.fn();
    const view = stage(<HeroPip sample happy={false} hop="" onOpening={onOpening} onOpen={onOpen} />);
    document.querySelector<HTMLElement>('.door-pip__hop')!.animate = animate;
    view.rerender(<section className="door-hero"><HeroPip sample happy hop="sample:0" onOpening={onOpening} onOpen={onOpen} /></section>);
    expect(animate).not.toHaveBeenCalled();
    // The first screen is told so, and his float and blink stop with it.
    expect(document.querySelector('.door-hero')).toHaveAttribute('data-motion-paused', 'true');
  });

  it('leans toward the pointer over the first screen, and lets go when he is gone', () => {
    const view = stage(<HeroPip sample happy={false} hop="" onOpening={onOpening} onOpen={onOpen} />);
    const hero = document.querySelector<HTMLElement>('.door-hero')!;
    expect(hero).toHaveAttribute('data-motion-paused', 'false');
    view.unmount();
    expect(hero).not.toHaveAttribute('data-motion-paused');
  });

  it('drops the sample that was about to open when the page goes first', () => {
    const view = stage(<HeroPip sample happy={false} hop="" onOpening={onOpening} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('link', { name: 'Open a sample parcel' }));
    view.unmount();
    pass(UNBOXING_MS);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
