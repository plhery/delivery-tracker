import { parentPort } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as ort from 'onnxruntime-web';
import sharp from 'sharp';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const BLANK = ALPHABET.length;
ort.env.wasm.numThreads = 1;
let session;

export function decodeCorreiosLogits(data, dims) {
  if (dims.length !== 3 || dims[0] !== 53 || dims[1] !== 1 || dims[2] !== 37 || data.length !== 53 * 37) {
    throw new Error('Correios OCR returned an invalid tensor');
  }
  let previous = -1;
  let answer = '';
  for (let step = 0; step < 53; step += 1) {
    let best = 0;
    for (let column = 0; column < 37; column += 1) {
      const value = data[step * 37 + column];
      if (!Number.isFinite(value)) throw new Error('Correios OCR returned an invalid score');
      if (value > data[step * 37 + best]) best = column;
    }
    if (best !== previous && best !== BLANK) answer += ALPHABET[best];
    previous = best;
  }
  return answer;
}

async function solve(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > 100_000) throw new Error('unsupported-image');
  let pixels;
  try {
    const image = sharp(bytes, { limitInputPixels: 215 * 80, pages: 1, failOn: 'warning' });
    const metadata = await image.metadata();
    if (metadata.format !== 'png' || metadata.width !== 215 || metadata.height !== 80 || (metadata.pages ?? 1) !== 1) throw new Error('unsupported-image');
    pixels = await image.flatten({ background: '#ffffff' }).greyscale().resize(215, 80, { kernel: 'linear' }).raw().toBuffer();
    if (pixels.length !== 215 * 80) throw new Error('unsupported-image');
  } catch { throw new Error('unsupported-image'); }
  const input = Float32Array.from(pixels, (pixel) => pixel / 127.5 - 1);
  if (!session) {
    const model = await readFile(resolve(process.cwd(), 'packages/carriers/carriers/correios-br/model/captcha.onnx'));
    session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  }
  const output = (await session.run({ image: new ort.Tensor('float32', input, [1, 1, 80, 215]) })).logits;
  if (!output || output.type !== 'float32') throw new Error('Correios OCR returned an invalid output');
  return decodeCorreiosLogits(output.data, output.dims);
}

parentPort?.on('message', async ({ id, bytes }) => {
  try { parentPort.postMessage({ id, answer: await solve(bytes) }); }
  catch (error) { parentPort.postMessage({ id, error: error?.message === 'unsupported-image' ? 'unsupported-image' : 'inference-failed' }); }
});
