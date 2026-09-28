import sharp from 'sharp';
import { ChallengeError, SchemaError } from '../../core/errors';
import { isRecord } from '../../core/types';

const PROVIDER = 'Yunda Express';
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function pixels(raw: unknown, width: number, height: number) {
  if (typeof raw !== 'string' || raw.length > 700_000 || !/^[A-Za-z\d+/]+={0,2}$/.test(raw)) throw new SchemaError(PROVIDER, 'Yunda returned an invalid challenge image');
  const bytes = Buffer.from(raw, 'base64');
  if (!bytes.subarray(0, 8).equals(PNG)) throw new SchemaError(PROVIDER, 'Yunda returned an unsupported challenge image');
  try {
    const decoder = sharp(bytes, { limitInputPixels: 60_000, failOn: 'warning' });
    const metadata = await decoder.metadata();
    if (metadata.format !== 'png' || metadata.width !== width || metadata.height !== height || (width === 40 && !metadata.hasAlpha)) {
      throw new ChallengeError(PROVIDER, 'Yunda changed its slider image layout');
    }
    return await decoder.toColourspace('srgb').ensureAlpha().raw().toBuffer();
  } catch (error) {
    if (error instanceof ChallengeError) throw error;
    throw new SchemaError(PROVIDER, 'Yunda returned an undecodable challenge image', { cause: error });
  }
}

/** The current client's native PNG geometry, not rendered browser coordinates. */
export async function solveYundaSlider(value: unknown, signal?: AbortSignal): Promise<{ x: number; y: number }> {
  signal?.throwIfAborted();
  if (!isRecord(value) || !Number.isInteger(value.y) || Number(value.y) < 0 || Number(value.y) > 112) throw new SchemaError(PROVIDER, 'Yunda returned an invalid slider row');
  const [big, small] = await Promise.all([pixels(value.big, 344, 152), pixels(value.small, 40, 40)]);
  signal?.throwIfAborted();
  let maskSize = 0;
  for (let i = 3; i < small.length; i += 4) if (small[i] > 127) maskSize++;
  if (maskSize < 200 || maskSize > 1400) throw new ChallengeError(PROVIDER, 'Yunda returned an unsupported slider outline');
  const y = Number(value.y);
  const scores: { x: number; score: number }[] = [];
  // The deployed challenge removes the piece with white fill. Texture cannot
  // match missing pixels; compare the transparent piece outline to that gap.
  // The official moveX/sliderUp handler rejects coordinates above 300 even
  // though the image has four additional pixels at the right edge.
  for (let x = 0; x <= 300; x++) {
    let overlap = 0; let white = 0;
    for (let row = 0; row < 40; row++) for (let col = 0; col < 40; col++) {
      const source = ((row + y) * 344 + x + col) * 4;
      const hole = big[source] >= 250 && big[source + 1] >= 250 && big[source + 2] >= 250;
      if (hole) { white++; if (small[(row * 40 + col) * 4 + 3] > 127) overlap++; }
    }
    scores.push({ x, score: 2 * overlap / (maskSize + white) });
  }
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const other = scores.find(candidate => Math.abs(candidate.x - best.x) > 3)!;
  if (best.score < 0.98 || best.score - other.score < 0.1) throw new ChallengeError(PROVIDER, 'Yunda slider match is uncertain');
  signal?.throwIfAborted();
  return { x: best.x, y };
}
