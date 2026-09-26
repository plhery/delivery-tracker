/** A damped spring: `duration` is its perceptual length in seconds, `bounce` its overshoot (0 = none). */
export interface Spring {
  duration: number;
  bounce?: number;
}

export interface SpringState {
  value: number;
  velocity: number;
}

/** Closed-form position and velocity (units per second), so motion can hand over at any moment. */
export function springAt({ duration, bounce = 0 }: Spring, from: number, to: number, velocity: number, seconds: number): SpringState {
  const omega = 2 * Math.PI / duration;
  const damping = 1 - Math.min(Math.max(bounce, 0), 0.9);
  const offset = from - to;
  if (damping < 1) {
    const decay = damping * omega;
    const frequency = omega * Math.sqrt(1 - damping * damping);
    const sine = (velocity + decay * offset) / frequency;
    const fade = Math.exp(-decay * seconds);
    const cos = Math.cos(frequency * seconds);
    const sin = Math.sin(frequency * seconds);
    return {
      value: to + fade * (offset * cos + sine * sin),
      velocity: fade * (velocity * cos - (decay * velocity + omega * omega * offset) / frequency * sin),
    };
  }
  const slope = velocity + omega * offset;
  const fade = Math.exp(-omega * seconds);
  return { value: to + (offset + slope * seconds) * fade, velocity: (velocity - omega * slope * seconds) * fade };
}

/** Seconds until the spring rests within `precision` of its target. */
export function springSettleTime(spring: Spring, from: number, to: number, velocity: number, precision = 0.5): number {
  for (let seconds = 0; seconds < 2; seconds += 1 / 120) {
    const state = springAt(spring, from, to, velocity, seconds);
    if (Math.abs(state.value - to) < precision && Math.abs(state.velocity) < precision * 20) return seconds;
  }
  return 2;
}
