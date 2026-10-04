// Draws the mark in src/brand/mark.json into every icon file, and renders the link preview.
// Run with: npm run icons
import { Resvg } from '@resvg/resvg-js';
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

async function write(file, contents) {
  writeFileSync(join(root, file), await contents);
  console.log(`wrote ${file}`);
}

await write('public/icons/icon.svg', markSvg());
await write('public/icons/favicon.svg', markSvg());
await write('public/icons/icon-192.png', render(markSvg(), 192));
await write('public/icons/icon-512.png', render(markSvg(), 512));
await write('public/icons/icon-maskable-512.png', opaque(render(markSvg({ bleed: true, scale: maskableScale }), 512)));
await write('public/icons/apple-touch-icon.png', opaque(render(markSvg({ bleed: true }), 180)));
await write('ios/PeekDeliveryTracker/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png', opaque(render(markSvg({ bleed: true }), 1024)));

// The preview's text is set in the typeface the invitation card uses, so it renders the same everywhere.
await write('public/og.png', render(readFileSync(join(root, 'public/og.svg'), 'utf8'), 1200, {
  font: {
    fontFiles: [join(root, 'node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf')],
    loadSystemFonts: false,
    defaultFontFamily: 'Geist',
  },
}));
