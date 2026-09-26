import { describe, expect, it } from 'vitest';
import { springAt, springSettleTime } from './spring';

describe('springAt', () => {
  it('starts from the released position and speed', () => {
    expect(springAt({ duration: 0.3 }, 40, 100, 800, 0)).toEqual({ value: 40, velocity: 800 });
    const bouncy = springAt({ duration: 0.4, bounce: 0.2 }, 40, 100, -300, 0);
    expect(bouncy.value).toBeCloseTo(40);
    expect(bouncy.velocity).toBeCloseTo(-300);
  });

  it('comes to rest on its target', () => {
    const state = springAt({ duration: 0.3 }, 0, 88, 1200, 1.5);
    expect(state.value).toBeCloseTo(88, 3);
    expect(state.velocity).toBeCloseTo(0, 2);
  });

  it('only overshoots with bounce', () => {
    const samples = (bounce: number) => Array.from({ length: 120 }, (_, step) => springAt({ duration: 0.4, bounce }, 0, 100, 0, step / 120).value);
    expect(Math.max(...samples(0))).toBeLessThanOrEqual(100);
    expect(Math.max(...samples(0.3))).toBeGreaterThan(100);
  });

  it('reports a velocity that matches its motion', () => {
    const spring = { duration: 0.35, bounce: 0.15 };
    const now = springAt(spring, 10, 200, 500, 0.1);
    const later = springAt(spring, 10, 200, 500, 0.1 + 1e-5);
    expect((later.value - now.value) / 1e-5).toBeCloseTo(now.velocity, 0);
  });
});

describe('springSettleTime', () => {
  it('ends once the spring is still within the precision', () => {
    const seconds = springSettleTime({ duration: 0.3 }, 0, 100, 0);
    expect(seconds).toBeGreaterThan(0.25);
    expect(seconds).toBeLessThan(0.6);
    expect(Math.abs(springAt({ duration: 0.3 }, 0, 100, 0, seconds).value - 100)).toBeLessThan(0.5);
    expect(springSettleTime({ duration: 0.3 }, 100, 100, 0)).toBe(0);
  });
});
