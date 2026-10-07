import 'server-only';

import { readFileSync, statSync } from 'node:fs';
import { CARRIER_IDS, recognitionNumberShape } from 'universal-parcel-scraper';

const RELOAD_MS = 5 * 60_000;
const MAX_BYTES = 256 * 1024;
const carriers = new Set<string>(CARRIER_IDS);
type Priorities = Readonly<Record<string, number>>;
let cached: { path: string; at: number; cohorts: Readonly<Record<string, Priorities>> } | undefined;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validShape(shape: string): boolean {
  if (!/^(?:[AD][1-9]\d?)+$/.test(shape)) return false;
  const runs = shape.match(/[AD]\d+/g)!;
  const length = runs.reduce((total, run) => total + Number(run.slice(1)), 0);
  return length >= 4 && length <= 40 && runs.every((run, index) => index === 0 || run[0] !== runs[index - 1]![0]);
}

function load(path: string): Readonly<Record<string, Priorities>> {
  try {
    if (statSync(path).size > MAX_BYTES) return {};
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!object(raw) || raw.version !== 1 || !object(raw.cohorts)) return {};
    const cohorts: Record<string, Priorities> = Object.create(null) as Record<string, Priorities>;
    for (const [shape, scores] of Object.entries(raw.cohorts)) {
      if (!validShape(shape) || !object(scores)) continue;
      const valid = Object.entries(scores).filter(([carrier, score]) => carriers.has(carrier)
        && typeof score === 'number' && Number.isFinite(score) && score >= 0);
      if (valid.length) cohorts[shape] = Object.fromEntries(valid) as Record<string, number>;
    }
    return cohorts;
  } catch {
    // Missing or malformed private evidence leaves catalog ordering intact.
    return {};
  }
}

/** Optional coarse aggregate scores, loaded from a private caller-owned file. */
export function getRecognitionPriorities(number: string): Priorities | undefined {
  const path = process.env.CARRIER_RECOGNITION_PRIORITIES_PATH;
  if (!path) return undefined;
  const now = Date.now();
  if (!cached || cached.path !== path || now - cached.at >= RELOAD_MS) {
    cached = { path, at: now, cohorts: load(path) };
  }
  const shape = recognitionNumberShape(number);
  return shape ? cached.cohorts[shape] : undefined;
}
