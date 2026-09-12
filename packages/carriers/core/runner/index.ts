/**
 * Tiered execution for adapters that have more than one way to reach a
 * provider (for example a direct HTTP request, then a browser service when the
 * direct path is challenged).
 *
 * `runSteps()` runs the declared steps in order, decides from the error kind
 * whether the next step may recover, enforces one time budget across all
 * steps, and reports every attempt plus the final outcome through the
 * `StepRecorder`. Adapters describe their tiers; they do not time or count
 * them.
 */
import { BudgetExceededError, carrierErrorKind } from '../errors';
import { NOOP_RECORDER, errorTypeOf, outcomeOf, safeRecorder, type StepOutcome, type StepRecorder } from '../telemetry';

export interface StepContext {
  /** Aborts when the lookup budget or the caller's signal expires. */
  signal: AbortSignal;
  /** Milliseconds left in the lookup budget when the step started. */
  remainingMs: number;
  attempt: number;
  /** The error that made the previous step fail, when this step is a recovery. */
  previousError: unknown;
}

export interface StepSpec<T> {
  id: string;
  run: (context: StepContext) => Promise<T>;
  /** Skipped when false, for example when the browser service is not configured. */
  enabled?: boolean;
  /** Whether this step may run after the previous one failed with `error`. Defaults to `recoverableByDefault`. */
  recovers?: (error: unknown) => boolean;
}

export interface RunOptions {
  carrier: string;
  budgetMs: number;
  recorder?: StepRecorder;
  signal?: AbortSignal;
  now?: () => number;
}

const RECOVERABLE: ReadonlySet<StepOutcome> = new Set<StepOutcome>(['challenge', 'transport', 'indeterminate', 'error']);

/** A later tier may retry after a challenge, a transport failure, an inconclusive answer or an unclassified error; never after a definite answer. */
export function recoverableByDefault(error: unknown): boolean {
  return RECOVERABLE.has(outcomeOf(error));
}

function combinedSignal(external: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs)));
  if (!external) return timeout;
  const any = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  return typeof any === 'function' ? any.call(AbortSignal, [external, timeout]) : timeout;
}

export async function runSteps<T>(options: RunOptions, steps: readonly StepSpec<T>[]): Promise<T> {
  const recorder = safeRecorder(options.recorder ?? NOOP_RECORDER);
  const now = options.now ?? (() => performance.now());
  const started = now();
  const enabled = steps.filter((step) => step.enabled !== false);
  let attempt = 0;
  let previousError: unknown;
  let previousStep: string | null = null;
  let lastStep: string | null = null;

  const finish = (outcome: StepOutcome, error?: unknown): void => {
    recorder.lookup({
      carrier: options.carrier, finalStep: lastStep, outcome, errorType: error === undefined ? null : errorTypeOf(error),
      durationMs: Math.max(0, now() - started), attempts: attempt, ...(error === undefined ? {} : { error }),
    });
  };

  const fallback = () => (previousStep === null
    ? { fallbackFrom: null, fallbackReason: null, fallbackErrorType: null }
    : { fallbackFrom: previousStep, fallbackReason: outcomeOf(previousError), fallbackErrorType: errorTypeOf(previousError), fallbackError: previousError });

  for (const step of enabled) {
    if (previousStep !== null && !(step.recovers ?? recoverableByDefault)(previousError)) continue;
    const remainingMs = options.budgetMs - (now() - started);
    if (remainingMs <= 0) {
      const error = new BudgetExceededError(options.carrier, options.budgetMs, { cause: previousError });
      finish('budget', error);
      throw error;
    }
    attempt += 1;
    lastStep = step.id;
    const stepStarted = now();
    try {
      const value = await step.run({
        signal: combinedSignal(options.signal, remainingMs), remainingMs, attempt, previousError,
      });
      recorder.step({
        carrier: options.carrier, step: step.id, attempt, outcome: 'ok', errorType: null,
        durationMs: Math.max(0, now() - stepStarted), ...fallback(),
      });
      finish('ok');
      return value;
    } catch (error) {
      recorder.step({
        carrier: options.carrier, step: step.id, attempt, outcome: outcomeOf(error), errorType: errorTypeOf(error),
        durationMs: Math.max(0, now() - stepStarted), ...fallback(), error,
      });
      previousError = error;
      previousStep = step.id;
      // A definite answer (not found, rate limited, schema...) ends the lookup here.
      if (carrierErrorKind(error) !== null && !recoverableByDefault(error)
        && !enabled.slice(enabled.indexOf(step) + 1).some((next) => next.recovers?.(error))) {
        finish(outcomeOf(error), error);
        throw error;
      }
    }
  }
  if (attempt === 0) {
    const error = new BudgetExceededError(options.carrier, options.budgetMs);
    finish('budget', error);
    throw error;
  }
  finish(outcomeOf(previousError), previousError);
  throw previousError;
}

/**
 * Serialize calls through one adapter instance so a shared session (cookies,
 * CSRF tokens, version handles) is never refreshed by two lookups at once.
 */
export function singleFlight(): <T>(operation: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve();
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };
}
