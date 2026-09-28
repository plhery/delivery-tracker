import sharp from 'sharp';
import { once } from 'node:events';
import type { Worker } from 'node:worker_threads';
import { describe, expect, it, vi } from 'vitest';
import { CorreiosOcr } from './ocr';
import { decodeCorreiosLogits } from './ocr-worker.mjs';

function logits(indices: number[]) {
  const values = new Float32Array(53 * 37).fill(-1);
  for (let step = 0; step < 53; step += 1) values[step * 37 + (indices[step] ?? 36)] = 1;
  return values;
}

describe('Correios local OCR', () => {
  it('decodes CTC repeats, blanks and consecutive same characters and rejects malformed scores', () => {
    expect(decodeCorreiosLogits(logits([10, 10, 36, 10, 1, 1, 11, 2]), [53, 1, 37])).toBe('aa1b2');
    expect(decodeCorreiosLogits(logits([]), [53, 1, 37])).toBe('');
    expect(() => decodeCorreiosLogits(logits([]), [52, 1, 37])).toThrow();
    const values = logits([]); values[0] = NaN;
    expect(() => decodeCorreiosLogits(values, [53, 1, 37])).toThrow();
  });

  it('loads real WASM inference once for bounded synthetic PNGs and rejects changed dimensions', async () => {
    const ocr = new CorreiosOcr();
    const png = await sharp({ create: { width: 215, height: 80, channels: 3, background: 'white' } }).png().toBuffer();
    try {
      expect(await ocr.solve(png, AbortSignal.timeout(5000))).toBeTypeOf('string');
      expect(await ocr.solve(png, AbortSignal.timeout(5000))).toBeTypeOf('string');
      const oversized = await sharp({ create: { width: 430, height: 160, channels: 3, background: 'white' } }).png().toBuffer();
      await expect(ocr.solve(oversized, AbortSignal.timeout(5000))).rejects.toMatchObject({ kind: 'challenge' });
      await expect(ocr.solve(new Uint8Array(100_001), AbortSignal.timeout(5000))).rejects.toMatchObject({ kind: 'challenge' });
      await expect(ocr.solve(new Uint8Array(), AbortSignal.timeout(5000))).rejects.toMatchObject({ kind: 'challenge' });
    } finally { await ocr.close(); }
  });

  it('aborts queued and active inference and recovers with a fresh worker', async () => {
    const ocr = new CorreiosOcr();
    const png = await sharp({ create: { width: 215, height: 80, channels: 3, background: 'white' } }).png().toBuffer();
    try {
      const first = ocr.solve(png, AbortSignal.timeout(10));
      const controller = new AbortController();
      const second = ocr.solve(png, controller.signal);
      controller.abort();
      await expect(second).rejects.toBeInstanceOf(Error);
      await expect(first).rejects.toBeInstanceOf(Error);
      expect(await ocr.solve(png, AbortSignal.timeout(5000))).toBeTypeOf('string');
    } finally { await ocr.close(); }
  });

  it('caps pending OCR jobs without discarding admitted work', async () => {
    const ocr = new CorreiosOcr();
    const png = await sharp({ create: { width: 215, height: 80, channels: 3, background: 'white' } }).png().toBuffer();
    try {
      const pending = Array.from({ length: 8 }, () => ocr.solve(png, AbortSignal.timeout(5000)));
      await expect(ocr.solve(png, AbortSignal.timeout(5000))).rejects.toMatchObject({ kind: 'transport' });
      expect((await Promise.all(pending)).every((answer) => typeof answer === 'string')).toBe(true);
    } finally { await ocr.close(); }
  });

  it('releases an idle worker and can lazily recreate it', async () => {
    const ocr = new CorreiosOcr();
    const png = await sharp({ create: { width: 215, height: 80, channels: 3, background: 'white' } }).png().toBuffer();
    vi.useFakeTimers();
    try {
      await ocr.solve(png, AbortSignal.timeout(5000));
      const worker = (ocr as unknown as { worker: Worker }).worker;
      const exited = once(worker, 'exit');
      vi.advanceTimersByTime(30_001);
      await exited;
      expect(await ocr.solve(png, AbortSignal.timeout(5000))).toBeTypeOf('string');
      expect((ocr as unknown as { worker: Worker }).worker).not.toBe(worker);
    } finally { vi.useRealTimers(); await ocr.close(); }
  });
});
