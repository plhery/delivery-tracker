import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindArrivalMotion } from './arrivalMotion';

let root: HTMLElement;
let reduced = false;
let hidden = false;
let angle = 0;
let mediaChanged: (() => void) | undefined;
let cleanup: (() => void) | undefined;
let clock = 0;
let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
function settle(count = 110) {
  for (let i = 0; i < count && frames.size; i++) {
    clock += 16;
    const pending = [...frames.values()]; frames.clear();
    pending.forEach((callback) => callback(clock));
  }
}
function pointer(type: string, x = 400, y = 720, pointerType = 'mouse', target = root) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX: x, clientY: y, pointerType });
  target.dispatchEvent(event);
  return event;
}
function orientation(beta: number | null, gamma: number | null) {
  const event = new Event('deviceorientation');
  Object.assign(event, { beta, gamma });
  window.dispatchEvent(event);
}
const pose = (axis: 'x' | 'y') => Number(root.style.getPropertyValue(`--parcel-${axis}`));

beforeEach(() => {
  reduced = hidden = false; angle = clock = nextFrame = 0; frames.clear();
  root = document.createElement('main'); document.body.append(root);
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 400, height: 800, bottom: 800, right: 400, toJSON: () => ({}) });
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.stubGlobal('screen', { orientation: { get angle() { return angle; } } });
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced; },
    addEventListener: (_: string, listener: () => void) => { mediaChanged = listener; },
    removeEventListener: () => { mediaChanged = undefined; },
  }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => { cleanup?.(); cleanup = undefined; root.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('arrival motion', () => {
  it('eases toward a bounded pose, settles completely, and releases listeners on exit', () => {
    cleanup = bindArrivalMotion(root);
    pointer('pointermove', 900, 1500); settle(1);
    expect(pose('x')).toBeGreaterThan(0); expect(pose('x')).toBeLessThan(1);
    settle(); expect(pose('x')).toBe(1); expect(pose('y')).toBe(1); expect(frames.size).toBe(0);
    pointer('pointerleave'); settle(); expect(pose('x')).toBe(0);
    pointer('pointermove'); cleanup();
    expect(frames.size).toBe(0); expect(pose('y')).toBe(0);
    pointer('pointermove'); orientation(0, 0); orientation(20, 20);
    expect(frames.size).toBe(0);
  });
  it('keeps touch scrolling native and returns to rest after touch up or cancellation', () => {
    cleanup = bindArrivalMotion(root);
    expect(pointer('pointermove', 400, 720, 'touch').defaultPrevented).toBe(false);
    settle(); expect(pose('x')).toBe(1);
    pointer('pointerup', 400, 720, 'touch'); settle(); expect(pose('x')).toBe(0);
    pointer('pointermove'); settle(); pointer('pointercancel'); settle(); expect(pose('x')).toBe(0);
    pointer('pointermove'); settle(); pointer('pointerup'); settle(); expect(pose('x')).toBe(1);
    const input = document.createElement('input'); root.append(input);
    pointer('pointermove', 0, 0, 'mouse', input); settle(); expect(pose('x')).toBe(1);
  });
  it('calibrates sensor motion at rest, ignores bad samples, and handles rotation wraparound', () => {
    const requestPermission = vi.fn(); vi.stubGlobal('DeviceOrientationEvent', { requestPermission });
    cleanup = bindArrivalMotion(root);
    orientation(null, 0); orientation(0, NaN); expect(frames.size).toBe(0);
    orientation(179, 0); expect(frames.size).toBe(0);
    orientation(-179, 0); settle(); expect(pose('y')).toBeCloseTo(.08, 3);
    expect(requestPermission).not.toHaveBeenCalled();
    angle = 90; window.dispatchEvent(new Event('orientationchange')); settle(); expect(pose('y')).toBe(0);
    orientation(0, 0); orientation(25, 0); settle(); expect(pose('x')).toBe(1); expect(pose('y')).toBe(0);
  });
  it('stops sensors and animation frames when hidden or reduced motion is enabled', () => {
    reduced = true; cleanup = bindArrivalMotion(root);
    pointer('pointermove'); orientation(0, 0); orientation(15, 15); expect(frames.size).toBe(0);
    expect(root.dataset.motionPaused).toBe('true');
    reduced = false; mediaChanged?.(); pointer('pointermove'); settle(); expect(pose('x')).toBe(1);
    hidden = true; document.dispatchEvent(new Event('visibilitychange'));
    expect(pose('x')).toBe(0); pointer('pointermove'); expect(frames.size).toBe(0);
    hidden = false; document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(root.dataset.motionPaused).toBe('false');
    pointer('pointermove'); settle(); reduced = true; mediaChanged?.();
    expect(pose('x')).toBe(0); expect(frames.size).toBe(0);
  });
  it('leaves the illustration usable when media-query support is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    cleanup = bindArrivalMotion(root);
    pointer('pointermove'); expect(frames.size).toBe(0);
  });
});
