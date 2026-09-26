const MAX_CONTOUR_EDGES = 2048;
const EDGE_RADIUS = 3;

function validImage(image, maximum) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height)
    || image.width < 8 || image.height < 8 || image.width > maximum || image.height > maximum) return false;
  const { data } = image;
  if (!(data instanceof Uint8Array) && !(data instanceof Uint8ClampedArray) && !Array.isArray(data)) return false;
  if (data.length !== image.width * image.height * 4) return false;
  return !Array.isArray(data) || data.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255);
}

function contourFor(piece) {
  const { data, width, height } = piece;
  const mask = new Uint8Array(width * height);
  let area = 0;
  for (let i = 0; i < mask.length; i++) {
    mask[i] = data[i * 4 + 3] > 127 ? 1 : 0;
    area += mask[i];
  }
  if (area < 64 || area >= mask.length * .9) return null;
  for (let x = 0; x < width; x++) if (mask[x] || mask[(height - 1) * width + x]) return null;
  for (let y = 0; y < height; y++) if (mask[y * width] || mask[y * width + width - 1]) return null;
  const edges = [];
  const bounds = { minX: width, minY: height, maxX: -1, maxY: -1 };
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    if (!mask[y * width + x]) continue;
    bounds.minX = Math.min(bounds.minX, x); bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x); bounds.maxY = Math.max(bounds.maxY, y);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if (!mask[(y + dy) * width + x + dx]) edges.push({ x, y, dx, dy });
    }
    if (edges.length > MAX_CONTOUR_EDGES) return null;
  }
  return { edges, bounds };
}

function refineChroma(background, piece, peak, window) {
  const support = [];
  for (let y = 3; y < piece.height - 3; y++) for (let x = 3; x < piece.width - 3; x++) {
    let opaque = true;
    for (let dy = -3; dy <= 3 && opaque; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (piece.data[((y + dy) * piece.width + x + dx) * 4 + 3] < 250) { opaque = false; break; }
    }
    if (!opaque) continue;
    const i = (y * piece.width + x) * 4;
    const a = piece.data[i] - piece.data[i + 1], c = piece.data[i + 1] - piece.data[i + 2];
    const norm = Math.hypot(a, c);
    if (norm >= 10) support.push({ x, y, a: a / norm, c: c / norm, weight: Math.min(norm, 50) });
  }
  if (support.length < 64) return null;
  const totalWeight = support.reduce((sum, pixel) => sum + pixel.weight, 0);
  const candidates = [];
  for (let y = Math.max(window.yMin, peak.y - 2); y <= Math.min(window.yMax, peak.y + 2); y++) {
    for (let x = Math.max(window.xMin, peak.x - 2); x <= Math.min(window.xMax, peak.x + 2); x++) {
      let sum = 0, weight = 0;
      for (const pixel of support) {
        const i = ((y + pixel.y) * background.width + x + pixel.x) * 4;
        const a = background.data[i] - background.data[i + 1], c = background.data[i + 1] - background.data[i + 2];
        const norm = Math.hypot(a, c);
        if (norm < 5) continue;
        sum += (pixel.a * a + pixel.c * c) / norm * pixel.weight;
        weight += pixel.weight;
      }
      if (weight / totalWeight >= .95) candidates.push({ x, y, score: sum / weight });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const margin = best && candidates[1] ? best.score - candidates[1].score : 0;
  // Uniform colors cannot establish an alignment, even with a perfect cosine.
  return best && best.score >= .995 && margin >= .00005 ? { ...best, margin } : null;
}

/** Locate the native transparent-tile origin; this does not perform browser actions. */
export function detectSfExpressGap(background, piece, options = {}) {
  const reject = reason => ({ accepted: false, reason });
  if (!options || typeof options !== 'object') return reject('Invalid search window');
  const { expectedY, yTolerance = 3, xMin = 0, xMax } = options;
  if (!validImage(background, 1024) || !validImage(piece, 256)
    || piece.width > background.width || piece.height > background.height) return reject('Invalid RGBA dimensions or bytes');
  if (!Number.isFinite(expectedY) || expectedY < 0 || expectedY > background.height - piece.height
    || !Number.isInteger(yTolerance) || yTolerance < 0 || yTolerance > 5
    || !Number.isInteger(xMin) || xMin < 0
    || (xMax !== undefined && (!Number.isInteger(xMax) || xMax < xMin))) return reject('Invalid search window');
  for (let i = 3; i < background.data.length; i += 4) if (background.data[i] !== 255) return reject('Background must be opaque');
  const contour = contourFor(piece);
  if (!contour) return reject('Invalid or overly complex alpha contour');
  const { edges, bounds } = contour;
  const window = {
    xMin: Math.max(xMin, EDGE_RADIUS - bounds.minX),
    xMax: Math.min(xMax ?? background.width - piece.width, background.width - piece.width,
      background.width - 1 - bounds.maxX - EDGE_RADIUS),
    yMin: Math.max(0, Math.round(expectedY) - yTolerance, EDGE_RADIUS - bounds.minY),
    yMax: Math.min(background.height - piece.height, Math.round(expectedY) + yTolerance,
      background.height - 1 - bounds.maxY - EDGE_RADIUS),
  };
  if (window.xMin > window.xMax || window.yMin > window.yMax) return reject('Empty search window');
  const gray = new Float64Array(background.width * background.height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = .299 * background.data[i * 4] + .587 * background.data[i * 4 + 1] + .114 * background.data[i * 4 + 2];
  }
  const candidates = [];
  for (let y = window.yMin; y <= window.yMax; y++) for (let x = window.xMin; x <= window.xMax; x++) {
    let score = 0, positive = 0;
    for (const edge of edges) {
      let contrast = 0;
      for (let distance = 1; distance <= EDGE_RADIUS; distance++) {
        contrast += gray[(y + edge.y + edge.dy * distance) * background.width + x + edge.x + edge.dx * distance]
          - gray[(y + edge.y - edge.dy * distance) * background.width + x + edge.x - edge.dx * distance];
      }
      contrast /= EDGE_RADIUS;
      score += Math.max(-50, Math.min(50, contrast));
      positive += contrast > 5 ? 1 : 0;
    }
    candidates.push({ x, y, score: score / edges.length, positiveFraction: positive / edges.length });
  }
  candidates.sort((a, b) => b.score - a.score);
  const peak = candidates[0];
  // Nearby pixels describe one gap. A competing horizontal location must lose decisively.
  const competitor = candidates.find(candidate => Math.abs(candidate.x - peak.x) > 8);
  const margin = competitor ? peak.score - competitor.score : 0;
  const measured = { ...peak, margin, competitor: competitor ?? null };
  if (peak.score < 25 || peak.positiveFraction < .75 || margin < 10) {
    return { ...measured, accepted: false, reason: 'Weak or ambiguous contour' };
  }
  // White highlights on the tile and dark shadows in its slot can invert grayscale
  // texture correlation. Interior chroma provides an independent local alignment.
  const chroma = refineChroma(background, piece, peak, window);
  if (peak.positiveFraction < .8 && (!chroma || chroma.margin < .001)) {
    return { ...measured, accepted: false, reason: 'Contour lacks independent confirmation' };
  }
  return { ...measured, accepted: true, x: chroma?.x ?? peak.x, y: chroma?.y ?? peak.y,
    contourX: peak.x, contourY: peak.y, chromaScore: chroma?.score ?? null };
}
