import { ImageResponse } from 'next/og';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { CARRIER_PALETTES, CARRIER_TRUCK, carrierBrand, carrierBrandFamily, carrierDecal, mix, type CarrierPalette, type TruckDecalShape } from '../brand';
import mark from '../brand/mark.json';
import type { CarrierInfo } from '../lib/carriers';
import type { Locale } from '../lib/locale';
import type { ParcelLinkPreview } from './parcelLinkPreview';
import { GEIST, writable } from './pictureFont';

const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const INK = '#20251e';
/** The wordmarks the app sets by hand, by brand family. */
const WORDMARKS: Record<string, string> = { dhl: 'DHL', gls: 'GLS', ups: 'ups' };
/** The parcel's 300 × 310 frame, as the app draws Pip. */
const BOX = {
  top: 'm55 142 95-47 95 47-95 48-95-48Z',
  left: 'm55 142 95 48v87l-95-48v-87Z',
  right: 'm150 190 95-48v87l-95 48v-87Z',
  hairlines: 'M56 144v84l93 47m2 0 92-46v-84',
  edges: 'm55 142 95 48 95-48m-95 48v87',
  tape: 'm96 122 13-7 95 48-13 7-95-48Z',
  seam: 'm103 119 94 47',
  barcode: 'M6 20v14m2.2-14v14m3-14v14m1.6-14v14m3.4-14v14m2-14v14m3-14v14m1.4-14v14m3.6-14v14m2-14v14m2.6-14v14m1.8-14v14m3.2-14v14m2-14v14m2.4-14v14m3-14v14m1.6-14v14',
};

/**
 * The carrier's truck in its own livery, with every paint resolved: the image
 * has no style sheet. The renderer takes only plain SVG elements inside an
 * `<svg>`, so the shapes come as a list rather than as a component.
 */
function truckShapes(carrier: CarrierInfo, palette: CarrierPalette) {
  const { strokeWidth, body, cab, windshield, wheels, decals } = CARRIER_TRUCK;
  const paint = (value: string) => value.startsWith('#') ? value : palette[value as keyof CarrierPalette];
  const decal = (shape: TruckDecalShape, index: number) => shape.type === 'circle'
    ? <circle key={`decal-${index}`} cx={shape.cx} cy={shape.cy} r={shape.r} fill={paint(shape.fill)} />
    : shape.type === 'polygon' ? <path key={`decal-${index}`} d={shape.d} fill={paint(shape.fill)} />
      : <path key={`decal-${index}`} d={shape.d} stroke={paint(shape.stroke)} strokeWidth={shape.strokeWidth} strokeLinecap="round" />;
  return [
    <rect key="body" x={body.x} y={body.y} width={body.width} height={body.height} rx={body.rx} fill={paint(body.fill)} stroke={paint(body.stroke)} strokeWidth={strokeWidth} />,
    <path key="cab" d={cab.d} fill={paint(cab.fill)} stroke={paint(cab.stroke)} strokeWidth={strokeWidth} strokeLinejoin="round" />,
    <path key="windshield" d={windshield.d} fill={paint(windshield.fill)} />,
    ...decals[carrierDecal(carrier.id)].map(decal),
    ...wheels.centers.map(([x, y]) => <circle key={`tire-${x}`} cx={x} cy={y} r={wheels.tire.r} fill={paint(wheels.tire.fill)} />),
    ...wheels.centers.map(([x, y]) => <circle key={`hub-${x}`} cx={x} cy={y} r={wheels.hub.r} fill={paint(wheels.hub.fill)} />),
  ];
}

function Truck({ carrier, palette, width }: { carrier: CarrierInfo; palette: CarrierPalette; width: number }) {
  const { viewBox } = CARRIER_TRUCK;
  return <svg width={width} height={width * viewBox.height / viewBox.width} viewBox={`0 0 ${viewBox.width} ${viewBox.height}`} fill="none">
    {truckShapes(carrier, palette)}
  </svg>;
}

/** Peek's mark: two eyes on a yellow tile. */
function Mark({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox={`0 0 ${mark.size} ${mark.size}`}>
    <rect width={mark.size} height={mark.size} rx={mark.tile.radius} fill={mark.tile.fill} />
    {mark.shapes.map(({ tag, ...attributes }, index) => createElement(tag, { key: index, ...attributes }))}
  </svg>;
}

/** What a gift's picture is painted in, whoever carries it. */
const GIFT = { surface: '#e9deff', tone: '#654299' };

/**
 * Pip, closed, with the carrier's label on his right side: its truck and a
 * barcode, never a number. With `ribbon` he is wrapped as a gift, as on the page.
 */
function Pip({ carrier, palette, width, ribbon = false }: { carrier: CarrierInfo | null; palette: CarrierPalette | null; width: number; ribbon?: boolean }) {
  return <div style={{ display: 'flex', position: 'relative', width, height: width * 310 / 300 }}>
    <svg width={width} height={width * 310 / 300} viewBox="0 0 300 310" fill="none">
      <ellipse cx="150" cy="286" rx="84" ry="10" fill={INK} opacity=".08" />
      <path d={BOX.top} fill="#DDBD96" />
      <path d={BOX.left} fill="#C9A47B" />
      <path d={BOX.right} fill="#B78F66" />
      <path d={BOX.hairlines} stroke="#987450" strokeOpacity=".25" strokeWidth=".8" />
      <path d={BOX.edges} stroke="#FFF2CF" strokeWidth="1" />
      <g transform="matrix(1 0.505263 0 1 55 142)">
        {[32.5, 63.5].map((x) => <g key={x}>
          <ellipse cx={x} cy="36" rx="10" ry="11.5" fill="#FFFDF6" />
          <circle cx={x + 3.5} cy="34.6" r="5.4" fill="#20251E" />
          <circle cx={x + 1.7} cy="32.6" r="1.6" fill="#FFFFFF" />
          <ellipse cx={x - 1} cy="51" rx="6.5" ry="3.2" fill="#E9958F" opacity=".55" />
        </g>)}
        {/* The ribbon runs where Pip smiles. */}
        {!ribbon && <path d="M42 51Q48 58 54 51" stroke="#20251E" strokeWidth="2.4" strokeLinecap="round" />}
      </g>
      {carrier && palette ? <g transform="matrix(.97 -0.490105 0 .97 160 205)">
        <rect width="74" height="48" rx="2.5" fill="#FFFEFA" />
        <g transform="translate(5 5) scale(.5)">{truckShapes(carrier, palette)}</g>
        <path d="M26 11h34" stroke={palette['brand-light']} strokeWidth="4" strokeLinecap="round" />
        <path d={BOX.barcode} stroke="#20251E" strokeWidth="1.05" />
        <path d="M6 41h44" stroke="#20251E" strokeOpacity=".3" strokeWidth="2.4" strokeLinecap="round" />
      </g> : <g transform="translate(183 234) rotate(-27)">
        <circle r="14" fill="#DECCE2" />
        <circle r="11.5" stroke="#FFF6FF" strokeWidth="1.2" />
        <path d="M0-7V7m-6-10 12 6M-6 3 6-3" stroke="#7C6787" strokeWidth="1.5" strokeLinecap="round" />
      </g>}
      <path d={BOX.tape} fill="#EBDDCA" />
      <path d={BOX.seam} stroke="#AF9474" strokeOpacity=".6" strokeWidth="1" strokeDasharray="3 3" />
      {ribbon && <path d="M102.5 118.5 197.5 166M197.5 118.5 102.5 166M102.5 166v87M197.5 166v87" stroke="#A286B5" strokeWidth="9" />}
      {ribbon && <path d="M150 142c-14-16-34-12-26 0 5 7 20 4 26 0Zm0 0c14-16 34-12 26 0-5 7-20 4-26 0Z" fill="#B99BCB" stroke="#9A82AA" strokeWidth="1" />}
      {ribbon && <path d="M150 142c-6 10-12 18-20 22M150 142c6 10 13 17 22 20" stroke="#A286B5" strokeWidth="5" strokeLinecap="round" />}
      {ribbon && <ellipse cx="150" cy="142" rx="6" ry="4.5" fill="#8E6FA3" />}
    </svg>
  </div>;
}

/** A headline as large as its longest word and its length allow beside Pip. */
function headlineSize(headline: string): number {
  const longest = Math.max(...headline.split(/\s+/).map((word) => [...word].length));
  const fit = Math.floor(640 / (longest * .58));
  const length = [...headline].length;
  return Math.max(56, Math.min(length > 30 ? 68 : length > 20 ? 84 : 104, fit));
}

/**
 * The 1200 × 630 picture of a parcel link: the card in its carrier's colours
 * with the status as the headline, and Pip. `host` is where the link lives.
 *
 * The picture is drawn without the web: a line its face cannot write is left
 * out, and a status it cannot write gets Peek's own picture.
 */
export function parcelLinkSocialImage(preview: ParcelLinkPreview, host: string | null, locale: Locale = 'en'): Response {
  const { carrier, steps, gift = false } = preview;
  const written = (text: string | null) => (text && writable(text, GEIST)) || null;
  const headline = written(preview.headline);
  if (!headline) return genericSocialImage(locale);
  const detail = written(preview.detail);
  const note = written(preview.note ?? null);
  const name = written(carrier && (WORDMARKS[carrierBrandFamily(carrier.id)] ?? carrier.name));
  const site = written(host);
  const palette = carrier ? carrierBrand(carrier.color, CARRIER_PALETTES[carrier.id]) : null;
  const surface = gift ? GIFT.surface : palette?.['surface-light'] ?? '#eceee7';
  const tone = gift ? GIFT.tone : palette?.['ink-light'] ?? '#657060';
  const size = headlineSize(headline);
  // The bundled face has one weight: an outline in the text's own colour makes it bold.
  const bold = (width: number, color: string) => ({ WebkitTextStroke: `${width}px ${color}` });
  return new ImageResponse(
    <div style={{ display: 'flex', position: 'relative', width: '100%', height: '100%', background: surface, color: INK, fontFamily: 'Geist' }}>
      <div style={{ display: 'flex', flexDirection: 'column', position: 'absolute', left: 80, top: 72, width: 660 }}>
        <div style={{ display: 'flex', alignItems: 'center', height: 48, fontSize: 29, color: palette?.['brand-light'] ?? tone, ...bold(1, palette?.['brand-light'] ?? tone) }}>
          {carrier && palette && <Truck carrier={carrier} palette={palette} width={65} />}
          {name && <span style={{ marginLeft: 17 }}>{name}</span>}
        </div>
        <div style={{ display: 'flex', marginTop: 62, fontSize: size, lineHeight: 1.02, letterSpacing: -size * .035, ...bold(size * .028, INK) }}>{headline}</div>
        {detail && <div style={{ display: 'flex', marginTop: 30, marginLeft: 4, fontSize: 40, color: tone }}>{detail}</div>}
        <div style={{ display: 'flex', marginTop: 40, marginLeft: 4 }}>
          {Array.from({ length: 6 }, (_, index) => <div key={index} style={{
            display: 'flex', width: 91, height: 6, marginRight: 10, borderRadius: 3, background: mix(tone, surface, index < steps ? .45 : .87),
          }} />)}
        </div>
      </div>
      <div style={{ display: 'flex', position: 'absolute', right: 70, top: 90 }}><Pip carrier={carrier} palette={palette} width={420} ribbon={gift} /></div>
      {note && <div style={{
        display: 'flex', alignItems: 'center', position: 'absolute', right: 76, top: 70, height: 52, padding: '0 22px', borderRadius: 26,
        background: mix(surface, '#ffffff', .7), fontSize: 24, color: tone, whiteSpace: 'nowrap', ...bold(.5, tone),
      }}>{note}</div>}
      <div style={{ display: 'flex', alignItems: 'center', position: 'absolute', left: 84, bottom: 44, fontSize: 26, color: tone }}>
        <Mark size={38} />
        <span style={{ marginLeft: 9, fontSize: 28, color: INK, ...bold(1.1, INK) }}>Peek</span>
        {site && <span style={{ marginLeft: 14 }}>{site}</span>}
      </div>
    </div>,
    { width: 1200, height: 630, fonts: [{ name: 'Geist', data: GEIST.data, weight: 400, style: 'normal' }], headers: HEADERS },
  );
}

const generic = new Map<Locale, Buffer>();

/** Peek's own picture, for a link that leads nowhere: the same one the front door shows, in the asked language. */
export function genericSocialImage(locale: Locale = 'en'): Response {
  const picture = generic.get(locale) ?? readFileSync(join(process.cwd(), `public/og${locale === 'en' ? '' : `-${locale}`}.png`));
  generic.set(locale, picture);
  return new Response(new Uint8Array(picture), { headers: { 'Content-Type': 'image/png', ...HEADERS } });
}
