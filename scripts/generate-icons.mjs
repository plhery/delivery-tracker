// Draws the mark in src/brand/mark.json into every icon file, and renders the link preview.
// Run with: npm run icons
import { Resvg } from '@resvg/resvg-js';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mark = JSON.parse(readFileSync(join(root, 'src/brand/mark.json'), 'utf8'));
const { size, tile, shapes } = mark;

const element = ({ tag, ...attributes }) =>
  `<${tag} ${Object.entries(attributes).map(([name, value]) => `${name}="${value}"`).join(' ')}/>`;

/**
 * The mark as an SVG document. A rounded tile is the mark as the app shows it; `bleed` fills
 * the square instead, for icons the system masks itself, and `scale` shrinks the drawing about
 * the centre of that square.
 */
function markSvg({ bleed = false, scale = 1 } = {}) {
  const drawn = shapes.map(element);
  const lines = bleed
    ? [`<rect width="${size}" height="${size}" fill="${tile.fill}"/>`, `<g transform="translate(${size / 2} ${size / 2}) scale(${scale}) translate(${-size / 2} ${-size / 2})">`, ...drawn.map((line) => `  ${line}`), '</g>']
    : [`<rect width="${size}" height="${size}" rx="${tile.radius}" fill="${tile.fill}"/>`, ...drawn];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">\n${lines.map((line) => `  ${line}\n`).join('')}</svg>\n`;
}

/**
 * The mark's eyes alone, white on nothing, for the badge of a notification. Android keeps only
 * a badge's outline and paints it in one colour, so the tile would come out as a plain square.
 * The light shapes show and the dark ones are cut out of them; a highlight is too small to
 * survive in a status bar and is left out.
 */
function badgeSvg() {
  const speck = size * 0.03;
  const drawn = shapes.filter(({ rx, r }) => (rx ?? r) > speck);
  const light = ({ fill }) => Number.parseInt(fill.slice(1, 3), 16) > 127;
  const edges = (axis, radius) => drawn.flatMap((shape) => [shape[axis] - (shape[radius] ?? shape.r), shape[axis] + (shape[radius] ?? shape.r)]);
  const [left, right, top, bottom] = [Math.min(...edges('cx', 'rx')), Math.max(...edges('cx', 'rx')), Math.min(...edges('cy', 'ry')), Math.max(...edges('cy', 'ry'))];
  // A square around the eyes, with a little air on the sides they reach.
  const side = Math.max(right - left, bottom - top) * 1.08;
  const box = `${(left + right - side) / 2} ${(top + bottom - side) / 2} ${side} ${side}`;
  const [x, y] = box.split(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">
  <mask id="eyes">
${drawn.map((shape) => `    ${element({ ...shape, fill: light(shape) ? '#fff' : '#000' })}\n`).join('')}  </mask>
  <rect x="${x}" y="${y}" width="${side}" height="${side}" fill="#fff" mask="url(#eyes)"/>
</svg>
`;
}

/** How far an ellipse or a circle, the only shapes the mark is drawn in, reaches from the centre of the square. */
function reach({ tag, cx, cy, rx, ry, r }) {
  if (tag !== 'ellipse' && tag !== 'circle') throw new Error(`The reach of a ${tag} is not measured`);
  return Math.max(...Array.from({ length: 360 }, (_, degree) => {
    const angle = degree * Math.PI / 180;
    return Math.hypot(cx + (rx ?? r) * Math.cos(angle) - size / 2, cy + (ry ?? r) * Math.sin(angle) - size / 2);
  }));
}

// A launcher may crop a maskable icon to a centred circle of 40% radius. The eyes stay inside
// that circle, so the drawing keeps its size; one that reached past it would shrink to fit.
const safeRadius = size * 0.4;
const farthest = Math.max(...shapes.map(reach));
const maskableScale = Math.min(1, Math.floor(100 * safeRadius / farthest) / 100);

const render = (svg, width, options = {}) => new Resvg(svg, { fitTo: { mode: 'width', value: width }, ...options }).render().asPng();
/** Icons the system masks have no transparency at all: the App Store rejects an alpha channel. */
const opaque = (png) => sharp(png).flatten({ background: tile.fill }).removeAlpha().png().toBuffer();

/**
 * An ICO file holding one PNG per size: what a browser, a feed reader or a crawler gets when
 * it asks for `/favicon.ico` without reading the page. Browsers that read the page use the SVG.
 */
function ico(sizes) {
  const images = sizes.map((size) => ({ size, png: render(markSvg(), size) }));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2); // An icon, not a cursor.
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(size, entry);
    header.writeUInt8(size, entry + 1);
    header.writeUInt16LE(1, entry + 4); // Colour planes.
    header.writeUInt16LE(32, entry + 6); // Bits per pixel.
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

async function write(file, contents) {
  writeFileSync(join(root, file), await contents);
  console.log(`wrote ${file}`);
}

await write('public/icons/icon.svg', markSvg());
await write('public/icons/favicon.svg', markSvg());
await write('public/favicon.ico', ico([16, 32, 48]));
await write('public/icons/icon-192.png', render(markSvg(), 192));
await write('public/icons/icon-512.png', render(markSvg(), 512));
await write('public/icons/badge-96.png', render(badgeSvg(), 96));
await write('public/icons/icon-maskable-512.png', opaque(render(markSvg({ bleed: true, scale: maskableScale }), 512)));
await write('public/icons/apple-touch-icon.png', opaque(render(markSvg({ bleed: true }), 180)));
await write('ios/PeekDeliveryTracker/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png', opaque(render(markSvg({ bleed: true }), 1024)));

// The link preview, once per language. `public/og.svg` is the English drawing; its words are
// replaced with each language's own. The text is set in the typeface the parcel pictures use,
// so it renders the same everywhere.
const LOCALES = ['en', 'de', 'fr', 'it', 'es', 'pt', 'pl'];
const drawing = readFileSync(join(root, 'public/og.svg'), 'utf8');
const HEADLINE = /<text [^>]*font-size="104"[^>]*>[\s\S]*?<\/text>/;
const DETAIL = /<text x="84" y="462"[^>]*>[^<]*<\/text>/;
const [headlineAttributes] = /font-family="[^"]*"/.exec(drawing);
/** How wide a line of the face runs, in ems: close enough to choose where a headline breaks. */
const EM = 0.56;
const COLUMN = 640;

/** A headline on two lines as large as they fit, or on three when two would be small. */
function headline(text) {
  const words = text.split(' ');
  const splits = (count) => count === 1 ? [[words.join(' ')]] : words.slice(1).flatMap((_, index) => {
    const head = words.slice(0, index + 1).join(' ');
    const rest = words.slice(index + 1);
    return count === 2 ? [[head, rest.join(' ')]] : rest.slice(1).map((__, cut) => [head, rest.slice(0, cut + 1).join(' '), rest.slice(cut + 1).join(' ')]);
  });
  const longest = (lines) => Math.max(...lines.map((line) => [...line].length));
  const best = (count) => splits(Math.min(count, words.length)).reduce((a, b) => longest(b) < longest(a) ? b : a);
  const two = best(2);
  const twoSize = Math.min(104, Math.floor(COLUMN / (longest(two) * EM)));
  const lines = twoSize >= 84 ? two : best(3);
  const size = lines === two ? twoSize : Math.min(78, Math.floor(COLUMN / (longest(lines) * EM)));
  return { lines, size };
}

function previewSvg(locale) {
  const words = JSON.parse(readFileSync(join(root, `shared/locales/${locale}.json`), 'utf8'));
  const { lines, size } = headline(words['peek.title']);
  const leading = size * 1.02;
  // The detail sits where the English one does under two full lines, and moves with the headline.
  const first = 182 + size * 0.895;
  const detail = words['preview.picture.detail'];
  const detailSize = Math.min(40, Math.floor(COLUMN / ([...detail].length * 0.5)));
  const detailY = Math.round(first + leading * (lines.length - 1) + 30 + 51 * size / 104);
  return drawing
    .replace(/<title id="title">[^<]*<\/title>/, `<title id="title">${words['app.title']} — ${words['peek.title']}</title>`)
    .replace('>3,500+ carriers<', `>${words['landing.pill.carriers']}<`)
    .replace(HEADLINE, `<text ${headlineAttributes} font-size="${size}" letter-spacing="${(-size * 0.035).toFixed(2)}" fill="#20251E" stroke="#20251E" stroke-width="${(size * 0.0404).toFixed(1)}" stroke-linejoin="round">\n${lines.map((line, index) => `    <tspan x="80" y="${Math.round(first + leading * index)}">${line}</tspan>`).join('\n')}\n  </text>`)
    .replace(DETAIL, `<text x="84" y="${detailY}" ${headlineAttributes} font-size="${detailSize}" fill="#526E5B">${detail}</text>`);
}

const versions = {};
for (const locale of LOCALES) {
  const png = render(locale === 'en' ? drawing : previewSvg(locale), 1200, {
    font: {
      fontFiles: [join(root, 'node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf')],
      loadSystemFonts: false,
      defaultFontFamily: 'Geist',
    },
  });
  await write(`public/og${locale === 'en' ? '' : `-${locale}`}.png`, png);
  versions[locale] = createHash('sha256').update(png).digest('hex').slice(0, 8);
}
// The address of each picture names its contents, so a redrawn one replaces cached copies.
await write('src/lib/peekPictures.json', `${JSON.stringify(versions, null, 2)}\n`);
