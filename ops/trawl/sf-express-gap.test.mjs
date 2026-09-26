import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSfExpressGap } from './sf-express-gap.mjs';

function image(width, height, color = [225, 235, 230, 255]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(color, i);
  return { data, width, height };
}

function fixture({ scale = 1, gray = false, weak = false, translatedX = 141, translatedY = 48 } = {}) {
  const background = image(256 * scale, 144 * scale);
  const piece = image(64 * scale, 64 * scale, [0, 0, 0, 0]);
  const shape = (x, y) => ((x >= 12 && x < 44 && y >= 12 && y < 44)
    || ((x - 43) ** 2 + (y - 29) ** 2 < 49)) && (x - 28) ** 2 + (y - 12) ** 2 >= 25;
  const pixels = [];
  for (let y = 0; y < piece.height; y++) for (let x = 0; x < piece.width; x++) {
    const nativeX = Math.floor(x / scale), nativeY = Math.floor(y / scale);
    if (!shape(nativeX, nativeY)) continue;
    const color = gray ? [190, 190, 190] : (nativeX * 3 + nativeY * 2) % 17 < 8
      ? [225, 125, 65] : [45, 175, 210];
    const source = color.map(channel => Math.round(channel * .75 + 60));
    piece.data.set([...source, 255], (y * piece.width + x) * 4);
    pixels.push({ x, y, color });
  }
  function slot(originX, originY) {
    for (const pixel of pixels) {
      const color = weak ? [222, 232, 227] : pixel.color.map(channel => Math.round(channel * .42));
      background.data.set([...color, 255], ((originY + pixel.y) * background.width + originX + pixel.x) * 4);
    }
  }
  const x = translatedX * scale, y = translatedY * scale;
  slot(x, y);
  return { background, piece, x, y, slot };
}

test('finds the transparent tile origin in a dark slot with independently transformed colors', () => {
  const { background, piece, x, y } = fixture();
  const result = detectSfExpressGap(background, piece, { expectedY: y });
  assert.equal(result.accepted, true);
  assert.equal(result.x, x);
  assert.equal(result.y, y);
  assert.ok(result.score >= 25);
  assert.ok(result.positiveFraction >= .8);
  assert.ok(result.margin >= 10);
  assert.ok(result.chromaScore > .995);
  assert.ok(result.competitor && Math.abs(result.competitor.x - result.x) > 8);
});

test('keeps natural pixel coordinates across image sizes and transparent margins', () => {
  for (const scale of [1, 2]) {
    const { background, piece, x, y } = fixture({ scale, translatedX: 127, translatedY: 35 });
    const result = detectSfExpressGap(background, piece, { expectedY: y + 1 });
    assert.equal(result.accepted, true);
    assert.equal(result.x, x);
    assert.equal(result.y, y);
  }
});

test('ignores a darker rectangular distractor that lacks the tile silhouette', () => {
  const { background, piece, x, y } = fixture();
  for (let row = 58; row < 94; row++) for (let column = 34; column < 70; column++) {
    background.data.set([0, 0, 0, 255], (row * background.width + column) * 4);
  }
  const result = detectSfExpressGap(background, piece, { expectedY: y });
  assert.equal(result.accepted, true);
  assert.equal(result.x, x);
  assert.equal(result.y, y);
});

test('a grayscale tile can rely on a strong contour without invented chroma evidence', () => {
  const { background, piece, x, y } = fixture({ gray: true });
  const result = detectSfExpressGap(background, piece, { expectedY: y });
  assert.equal(result.accepted, true);
  assert.ok(Math.abs(result.x - x) <= 1);
  assert.equal(result.chromaScore, null);
});

test('a partly obscured contour needs independent interior evidence before acceptance', () => {
  const { background, piece, x, y } = fixture();
  for (let row = y + 3; row < y + 12; row++) for (let column = x + 10; column < x + 45; column++) {
    background.data.set([40, 40, 40, 255], (row * background.width + column) * 4);
  }
  for (let row = y + 22; row < y + 30; row++) for (let column = x + 3; column < x + 12; column++) {
    background.data.set([40, 40, 40, 255], (row * background.width + column) * 4);
  }
  const confirmed = detectSfExpressGap(background, piece, { expectedY: y });
  assert.equal(confirmed.accepted, true);
  assert.equal(confirmed.x, x);
  assert.equal(confirmed.y, y);
  assert.ok(confirmed.positiveFraction >= .75 && confirmed.positiveFraction < .8);
  for (let i = 0; i < piece.data.length; i += 4) piece.data.set([190, 190, 190], i);
  const unconfirmed = detectSfExpressGap(background, piece, { expectedY: y });
  assert.equal(unconfirmed.accepted, false);
  assert.match(unconfirmed.reason, /independent confirmation/);
});

test('rejects two equally plausible slots, including when their coordinates differ', () => {
  const { background, piece, y, slot } = fixture();
  slot(36, y);
  const result = detectSfExpressGap(background, piece, { expectedY: y });
  assert.equal(result.accepted, false);
  assert.ok(result.margin < 1);
  assert.match(result.reason, /ambiguous/);
});

test('rejects a weak edge even when the alpha shape is an exact match', () => {
  const { background, piece, y } = fixture({ weak: true });
  const result = detectSfExpressGap(background, piece, { expectedY: y });
  assert.equal(result.accepted, false);
  assert.ok(result.score < 25);
});

test('search stays near the supplied vertical position and needs an independent horizontal rival', () => {
  const { background, piece, x, y } = fixture();
  assert.equal(detectSfExpressGap(background, piece, { expectedY: 0 }).accepted, false);
  assert.equal(detectSfExpressGap(background, piece, { expectedY: y, xMin: x, xMax: x }).accepted, false);
  assert.equal(detectSfExpressGap(background, piece, { expectedY: y, xMin: 250 }).accepted, false);
});

test('accepts serialized byte arrays as well as typed RGBA buffers', () => {
  const { background, piece, x, y } = fixture();
  const result = detectSfExpressGap({ ...background, data: Array.from(background.data) },
    { ...piece, data: new Uint8ClampedArray(piece.data) }, { expectedY: y });
  assert.equal(result.accepted, true);
  assert.equal(result.x, x);
});

test('rejects malformed dimensions, unsafe bytes and unbounded search inputs', () => {
  const { background, piece, y } = fixture();
  const invalidImages = [null, {}, { ...background, width: 3.5 }, { ...background, width: 1025 },
    { ...background, height: -1 }, { ...background, data: background.data.slice(4) },
    { ...background, data: Array(background.data.length).fill(NaN) },
    { ...background, data: new Int32Array(background.data) }];
  for (const invalid of invalidImages) assert.equal(detectSfExpressGap(invalid, piece, { expectedY: y }).accepted, false);
  assert.equal(detectSfExpressGap(background, { ...piece, width: 257 }, { expectedY: y }).accepted, false);
  for (const options of [null, false, {}, { expectedY: NaN }, { expectedY: -1 }, { expectedY: Infinity },
    { expectedY: y, yTolerance: 6 }, { expectedY: y, xMin: -1 }, { expectedY: y, xMax: 1.5 }]) {
    assert.equal(detectSfExpressGap(background, piece, options).accepted, false);
  }
});

test('rejects absent, clipped, fully opaque and overly complex alpha masks', () => {
  const { background, y } = fixture();
  const empty = image(64, 64, [0, 0, 0, 0]);
  const clipped = fixture().piece;
  clipped.data[3] = 255;
  const complex = image(128, 128, [0, 0, 0, 0]);
  for (let row = 1; row < 127; row++) for (let column = 1; column < 127; column++) {
    if ((column + row) % 2) complex.data[(row * 128 + column) * 4 + 3] = 255;
  }
  for (const piece of [empty, clipped, image(64, 64), complex]) {
    assert.equal(detectSfExpressGap(background, piece, { expectedY: piece === complex ? 0 : y }).accepted, false);
  }
  const { piece } = fixture();
  background.data[3] = 0;
  assert.equal(detectSfExpressGap(background, piece, { expectedY: y }).accepted, false);
});
