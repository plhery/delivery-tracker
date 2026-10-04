import 'server-only';

import type { BrowserRecognition, TrackingContext } from 'universal-parcel-scraper/node';
import { createAdapterRegistry } from './adapterRegistry';

export const BROWSER_RECOGNITION_BUDGET_MS = 20_000;
export const MAX_BROWSER_RECOGNITIONS = 2;
const TTL_MS = 5 * 60_000;
const FAILURE_TTL_MS = 30_000;
const MAX_ENTRIES = 500;
interface BrowserRecognitionState {
  cache: Map<string, { at: number; answer?: BrowserRecognition }>;
  pending: Map<string, { controller: AbortController; users: number; promise: Promise<BrowserRecognition> }>;
}
// Next compiles the API and instrumentation worker into different module instances.
const stateKey = Symbol.for('peek.browserRecognition');
const processScope = globalThis as typeof globalThis & { [stateKey]?: BrowserRecognitionState };
const shared: BrowserRecognitionState = processScope[stateKey] ??= { cache: new Map(), pending: new Map() };
const { cache, pending } = shared;
let registry: ReturnType<typeof createAdapterRegistry> | undefined;

function remember(key: string, answer?: BrowserRecognition) {
  cache.delete(key);
  cache.set(key, { at: Date.now(), answer });
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}

/** Shared by preflight and sync; identical requests share work until their last caller cancels. */
export async function recognizeBrowser(carrier: string, number: string, context: TrackingContext = {}, previousError?: unknown): Promise<BrowserRecognition> {
  context.signal?.throwIfAborted();
  const key = `${carrier}:${number}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < (cached.answer ? TTL_MS : FAILURE_TTL_MS)) {
    if (!cached.answer) throw new Error('Browser recognition is cooling down');
    return structuredClone(cached.answer);
  }
  let job = pending.get(key);
  if (!job) {
    if (pending.size >= MAX_BROWSER_RECOGNITIONS) throw new Error('Browser recognition is busy');
    const controller = new AbortController();
    const adapter = (registry ??= createAdapterRegistry()).for(carrier);
    if (!adapter?.recognizeWithBrowser) throw new RangeError(`${carrier} cannot confirm through a browser`);
    const promise = Promise.resolve().then(() => adapter.recognizeWithBrowser!(number, {
      signal: controller.signal, budgetMs: BROWSER_RECOGNITION_BUDGET_MS,
    }, previousError)).then((answer) => {
      controller.signal.throwIfAborted();
      remember(key, structuredClone(answer));
      return answer;
    }, (error: unknown) => {
      if (!controller.signal.aborted) remember(key);
      throw error;
    }).finally(() => { if (pending.get(key)?.controller === controller) pending.delete(key); });
    job = { controller, users: 0, promise };
    pending.set(key, job);
  }
  const active = job;
  active.users++;
  return new Promise<BrowserRecognition>((resolve, reject) => {
    let finished = false;
    const finish = (answer?: BrowserRecognition, error?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      context.signal?.removeEventListener('abort', abort);
      if (--active.users === 0 && pending.get(key) === active) active.controller.abort();
      if (error !== undefined) reject(error);
      else resolve(structuredClone(answer!));
    };
    const abort = () => finish(undefined, context.signal?.reason ?? new Error('Browser recognition cancelled'));
    context.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => finish(undefined, new Error('Browser recognition budget exceeded')),
      Math.max(1, Math.min(context.budgetMs ?? BROWSER_RECOGNITION_BUDGET_MS, BROWSER_RECOGNITION_BUDGET_MS)));
    active.promise.then((answer) => finish(answer), (error: unknown) => finish(undefined, error));
    if (context.signal?.aborted) abort();
  });
}

/** Consume fresh anonymous history once; recipient credentials never share cached lookups. */
export function takeBrowserHistory(carrier: string, number: string) {
  const entry = cache.get(`${carrier}:${number}`);
  if (!entry?.answer?.result || Date.now() - entry.at >= TTL_MS
    || Date.now() - Date.parse(entry.answer.lastActivityAt ?? '') >= 60 * 24 * 3_600_000) return undefined;
  const result = entry.answer.result;
  delete entry.answer.result;
  return structuredClone(result);
}
