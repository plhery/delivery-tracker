export type Clock = () => number;

interface Allowance {
  requests: number[];
  /** The window the key was last counted with: what decides when its requests expire. */
  window: number;
}

/**
 * In-memory sliding-window limiter for a single self-hosted Next.js process.
 * Its counts are lost when the process restarts. Past `maxKeys` it forgets
 * the keys used least recently, so give each kind of key its own limiter: a
 * flood of one kind then cannot push out another's counts.
 */
export class RateLimiter {
  /** In order of use: the first key is the one used least recently. */
  readonly #allowances = new Map<string, Allowance>();

  constructor(
    readonly maxKeys = 4_096,
    readonly clock: Clock = () => performance.now() / 1_000,
  ) {
    if (!Number.isInteger(maxKeys) || maxKeys < 1) {
      throw new RangeError('maxKeys must be a positive integer');
    }
  }

  retryAfter(key: string, options: { limit: number; window: number }): number {
    const { limit, window } = options;
    if (!Number.isInteger(limit) || limit < 1 || !Number.isFinite(window) || window <= 0) {
      throw new RangeError('Rate limits require a positive count and window');
    }

    const now = this.clock();
    const allowance = this.#allowances.get(key) ?? { requests: [], window };
    allowance.window = window;
    expire(allowance, now);
    this.#allowances.delete(key);
    this.#allowances.set(key, allowance);

    const { requests } = allowance;
    if (requests.length >= limit) {
      return Math.max(1, Math.ceil(requests[0]! + window - now));
    }

    requests.push(now);
    if (this.#allowances.size > this.maxKeys) this.#prune(now, key);
    return 0;
  }

  #prune(now: number, keep: string): void {
    // Keys with nothing left to count go first.
    for (const [key, allowance] of this.#allowances) {
      if (this.#allowances.size <= this.maxKeys) return;
      if (key === keep) continue;
      expire(allowance, now);
      if (allowance.requests.length === 0) this.#allowances.delete(key);
    }

    for (const key of this.#allowances.keys()) {
      if (this.#allowances.size <= this.maxKeys) return;
      if (key !== keep) this.#allowances.delete(key);
    }
  }
}

/** Drops the requests that have left the key's own window. */
function expire(allowance: Allowance, now: number): void {
  const cutoff = now - allowance.window;
  const { requests } = allowance;
  let firstActive = 0;
  while (firstActive < requests.length && requests[firstActive]! <= cutoff) {
    firstActive += 1;
  }
  if (firstActive > 0) requests.splice(0, firstActive);
}
