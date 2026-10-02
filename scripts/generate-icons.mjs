// Draws the mark in src/brand/mark.json into every icon file, and renders the link preview.
// Run with: npm run icons
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mark = JSON.parse(readFileSync(join(root, 'src/brand/mark.json'), 'utf8'));
const { size, tile } = mark;

// `part` names what a shape belongs to; it is not an SVG attribute.
const element = ({ tag, ...attributes }) =>
  `<${tag} ${Object.entries(attributes).filter(([name]) => name !== 'part').map(([name, value]) => `${name}="${value}"`).join(' ')}/>`;

/**
 * One drawing of the mark as an SVG document. A rounded tile is the mark as the app shows it;
 * `bleed` fills the square instead, for icons the system masks itself, and `scale` shrinks the
 * drawing about the centre of that square.
 */
function markSvg(name, { bleed = false, scale = 1 } = {}) {
  const { shapes, clipped } = mark.drawings[name === 'label' ? 'full' : name];
  const drawn = shapes.filter((shape) => name === 'label' || !shape.part).map(element);
  const square = `<rect width="${size}" height="${size}" fill="${tile.fill}"/>`;
  const rounded = `<rect width="${size}" height="${size}" rx="${tile.radius}"`;
  const lines = bleed
    ? [square, `<g transform="translate(${size / 2} ${size / 2}) scale(${scale}) translate(${-size / 2} ${-size / 2})">`, ...drawn.map((line) => `  ${line}`), '</g>']
    : clipped
      ? [`<clipPath id="tile">${rounded}/></clipPath>`, '<g clip-path="url(#tile)">', ...[square, ...drawn].map((line) => `  ${line}`), '</g>']
      : [`${rounded} fill="${tile.fill}"/>`, ...drawn];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">\n${lines.map((line) => `  ${line}\n`).join('')}</svg>\n`;
}

// A launcher may crop a maskable icon to a centred circle of 40% radius. The lid's far corner,
// with its rounded stroke, is the point of the drawing furthest from the centre.
const safeRadius = size * 0.4;
const farthest = Math.hypot(385.1 - size / 2, 22.5 - size / 2) + 20;
const maskableScale = Math.floor(100 * safeRadius / farthest) / 100;

const render = (svg, width, options = {}) => new Resvg(svg, { fitTo: { mode: 'width', value: width }, ...options }).render().asPng();
/** Icons the system masks have no transparency at all: the App Store rejects an alpha channel. */
const opaque = (png) => sharp(png).flatten({ background: tile.fill }).removeAlpha().png().toBuffer();

async function write(file, contents) {
  writeFileSync(join(root, file), await contents);
  console.log(`wrote ${file}`);
}

await write('public/icons/icon.svg', markSvg('label'));
await write('public/icons/favicon.svg', markSvg('glyph'));
await write('public/icons/icon-192.png', render(markSvg('label'), 192));
await write('public/icons/icon-512.png', render(markSvg('label'), 512));
await write('public/icons/icon-maskable-512.png', opaque(render(markSvg('label', { bleed: true, scale: maskableScale }), 512)));
await write('public/icons/apple-touch-icon.png', opaque(render(markSvg('label', { bleed: true }), 180)));
await write('ios/SwissDeliveryTracker/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png', opaque(render(markSvg('label', { bleed: true }), 1024)));

// The preview's text is set in the typeface the invitation card uses, so it renders the same everywhere.
await write('public/og.png', render(readFileSync(join(root, 'public/og.svg'), 'utf8'), 1200, {
  font: {
    fontFiles: [join(root, 'node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf')],
    loadSystemFonts: false,
    defaultFontFamily: 'Geist',
  },
}));
