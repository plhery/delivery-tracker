import 'server-only';

import { ImageResponse } from 'next/og';
import type { CSSProperties } from 'react';
import { CARRIER_PALETTES, CARRIER_TRUCK, carrierBrand, carrierBrandFamily, carrierDecal, mix, type CarrierPalette, type TruckDecalShape } from '../../brand';
import { PARCEL, flapPoints } from '../../components/Icon';
import { PIP_FRAME } from '../../components/map/pipGeometry';
import { formatKm, type Route } from '../../components/map/route';
import type { CarrierInfo } from '../../lib/carriers';
import type { Translate } from '../../lib/messages';
import { formatJourneyDuration } from '../../lib/passport';
import { CORE_STAGES } from '../../lib/stages';
import type { ParcelWithEvents } from '../../types';
import { journeyMap, LABEL_SIZE, type Tint } from './cardMap';
import { FONT_NAME, fontData, writable } from './font';

/** The card's width in CSS pixels: the column of the email it is shown in. Every measure below is in these. */
const WIDTH = 456;
/** Drawn larger than it is shown, so it stays sharp on a dense screen. */
export const CARD_PIXELS = 1040;
const SCALE = CARD_PIXELS / WIDTH;
/** The map across the top of the card, with the room the app's own card keeps around the route. */
const MAP = { height: 236, insets: { top: 48, right: 18, bottom: 56, left: 18 } };
/** The carrier and the time, in the top corners. */
const TOP = { inset: 16, height: 18 };
/** "Delivered", the line under it with the space above it, and the track with the space around it. */
const HEADLINE = 28 * 1.125;
const FACTS = 8 + 15 * 1.5;
const TRACK = 18 + 3 + 20;
/** Without a map Pip stands beside the words, this wide, as on the app's card. */
const BESIDE = { pip: 96, gap: 12 };
const INK = '#20251e';
/** A card whose carrier is not known, as the app paints it. */
const NEUTRAL: Tint = { tone: '#657060', surface: '#eceee7' };
/** The wordmarks the app sets by hand, by brand family. */
const WORDMARKS: Record<string, string> = { dhl: 'DHL', gls: 'GLS', ups: 'ups' };

/** CSS pixels of the card as pixels of the picture. */
const u = (value: number) => value * SCALE;
/** The picture's one face has one weight: an outline in the text's own colour makes it heavier. */
const heavy = (width: number, color: string) => ({ WebkitTextStroke: `${u(width)}px ${color}` });

/** A drawing on the card. The renderer takes it as an image, from the document itself: nothing is fetched. */
function Drawing({ svg, width, height, style }: { svg: string; width: number; height: number; style?: CSSProperties }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`} width={u(width)} height={u(height)} alt="" style={style} />;
}

/** The carrier's truck in its own livery, with every paint resolved: a picture has no style sheet. */
function truckSvg(carrier: CarrierInfo, palette: CarrierPalette): string {
  const { viewBox, strokeWidth, body, cab, windshield, wheels, decals } = CARRIER_TRUCK;
  const paint = (value: string) => value.startsWith('#') ? value : palette[value as keyof CarrierPalette];
  const decal = (shape: TruckDecalShape) => shape.type === 'circle' ? `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" fill="${paint(shape.fill)}"/>`
    : shape.type === 'polygon' ? `<path d="${shape.d}" fill="${paint(shape.fill)}"/>`
      : `<path d="${shape.d}" stroke="${paint(shape.stroke)}" stroke-width="${shape.strokeWidth}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBox.width} ${viewBox.height}" fill="none" stroke-linecap="round" stroke-linejoin="round">`
    + `<rect x="${body.x}" y="${body.y}" width="${body.width}" height="${body.height}" rx="${body.rx}" fill="${paint(body.fill)}" stroke="${paint(body.stroke)}" stroke-width="${strokeWidth}"/>`
    + `<path d="${cab.d}" fill="${paint(cab.fill)}" stroke="${paint(cab.stroke)}" stroke-width="${strokeWidth}"/>`
    + `<path d="${windshield.d}" fill="${paint(windshield.fill)}"/>`
    + decals[carrierDecal(carrier.id)].map(decal).join('')
    + wheels.centers.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${wheels.tire.r}" fill="${paint(wheels.tire.fill)}"/><circle cx="${x}" cy="${y}" r="${wheels.hub.r}" fill="${paint(wheels.hub.fill)}"/>`).join('')
    + '</svg>';
}

/**
 * Pip with his box open, as he stands on a delivered parcel's map in the app:
 * the kraft parcel's geometry in the card's ink mixed toward its surface.
 */
function pipSvg({ tone, surface }: Tint): string {
  const toward = (amount: number) => mix(surface, tone, amount);
  const deep = mix(tone, '#000000', .18);
  const paper = mix(surface, '#ffffff', .62);
  const blush = mix(toward(.56), '#f0707e', .55);
  const flap = (name: keyof typeof PARCEL.flaps, fill: string) => `<polygon points="${flapPoints(PARCEL.flaps[name], true)}" fill="${fill}" stroke="${tone}" stroke-opacity=".24" stroke-width=".7"/>`;
  const glints = [tone, toward(.72), tone, toward(.86), toward(.72), tone];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PIP_FRAME.width} ${PIP_FRAME.height}" fill="none">`
    + `<ellipse cx="150" cy="286" rx="84" ry="10" fill="${deep}" opacity=".14"/>`
    + `<path d="${PARCEL.inside}" fill="${deep}"/>`
    + flap('backLeft', toward(.62)) + flap('backRight', toward(.4))
    + `<path d="${PARCEL.left}" fill="${toward(.56)}"/><path d="${PARCEL.right}" fill="${toward(.84)}"/>`
    + `<path d="${PARCEL.left}" fill="${paper}" opacity=".07"/>`
    + `<path d="${PARCEL.hairlines}" stroke="${tone}" stroke-opacity=".25" stroke-width=".8"/>`
    + `<path d="${PARCEL.edges}" stroke="${paper}" stroke-width="1" opacity=".4"/>`
    + flap('frontRight', toward(.5)) + flap('frontLeft', toward(.36))
    // The open front flaps hang over the left side, so the face is drawn after them.
    + `<g transform="${PARCEL.facePlane}">`
    + `<path d="M14.25 37.5Q26.25 21 38.25 37.5M57.75 37.5Q69.75 21 81.75 37.5" stroke="${deep}" stroke-width="4.5" stroke-linecap="round"/>`
    + [25.25, 68.75].map((x) => `<ellipse cx="${x}" cy="55.5" rx="9.75" ry="4.8" fill="${blush}" opacity=".55"/>`).join('')
    + `<path d="M33.75 53.25Q48 78 62.25 53.25Z" fill="${deep}" stroke="${deep}" stroke-width="2.7" stroke-linejoin="round"/>`
    + `<path d="M41.1 66Q48 61.5 54.9 66Q48 71.4 41.1 66Z" fill="${blush}"/></g>`
    + PARCEL.glints.map(({ x, y, size }, index) => `<path d="${PARCEL.glint}" transform="translate(${x} ${y}) scale(${size / 2})" fill="${glints[index]}"/>`).join('')
    + '</svg>';
}

/** What the app's map tells of a finished journey: how far, through how many countries, in how long. */
function journeyFacts(route: Route, parcel: ParcelWithEvents, timed: boolean, t: Translate, languageTag: string): string | null {
  const times = parcel.events.filter((event) => event.stage !== 'pending').map((event) => Date.parse(event.occurredAt)).filter(Number.isFinite);
  const duration = Math.max(...times) - Math.min(...times);
  const facts = [
    route.km >= 1 ? formatKm(route.km, languageTag) : null,
    route.countries.length > 1 ? t('map.countries.many', { count: route.countries.length }) : null,
    // A length in hours needs the delivery on the carrier's clock.
    timed && times.length > 1 && duration > 0 ? formatJourneyDuration(duration, languageTag) : null,
  ].filter(Boolean);
  return facts.length ? writable(facts.join(' · ')) : null;
}

export interface DeliveryCardInput {
  parcel: ParcelWithEvents;
  /** Null when no carrier is known: the card stays neutral and names none. */
  carrier: CarrierInfo | null;
  /** When it was delivered, as the email's sentence says it: "Today, 14:12". Null without a usable time. */
  when: string | null;
  /** Whether the delivered scan carries the carrier's own clock time. */
  timed: boolean;
  t: Translate;
  languageTag: string;
}

export interface DeliveryCard {
  png: Uint8Array;
  /** The two ends the map names, when it names both. */
  ends: { from: string; to: string } | null;
  /** Whether the card has a map at all. */
  mapped: boolean;
}

/**
 * The picture in a delivery email: the parcel's card as the app shows it once
 * it has arrived. The journey on the map, with Pip and his open box beside
 * the place it ended; the carrier and when; "Delivered", and what the journey
 * came to. It carries no parcel name, number or address. A parcel none of
 * whose scans could be placed gets the card without the map.
 *
 * Every word on it is checked against the picture's own face first: the
 * renderer would otherwise fetch a font for it from the web.
 */
export async function deliveryCard({ parcel, carrier, when, timed, t, languageTag }: DeliveryCardInput): Promise<DeliveryCard> {
  const palette = carrier ? carrierBrand(carrier.color, CARRIER_PALETTES[carrier.id]) : null;
  const tint: Tint = palette ? { tone: palette['ink-light'], surface: palette['surface-light'] } : NEUTRAL;
  const { tone, surface } = tint;
  const brand = palette?.['brand-light'] ?? tone;
  const map = await journeyMap(parcel, languageTag, { width: WIDTH, height: MAP.height }, MAP.insets, tint);
  const family = carrier ? carrierBrandFamily(carrier.id) : '';
  const name = carrier ? writable(WORDMARKS[family] ?? carrier.name) : null;
  const headline = writable(t('stage.delivered')) ?? '';
  const facts = map ? journeyFacts(map.route, parcel, timed, t, languageTag) : null;
  const time = when ? writable(when) : null;
  const from = map?.route.origin?.place.name;
  const to = (map?.route.destination ?? map?.route.current?.place)?.name;
  const pipHeight = (width: number) => width * PIP_FRAME.height / PIP_FRAME.width;
  const words = HEADLINE + (facts ? FACTS : 0);
  const height = map ? MAP.height + words + TRACK : TOP.inset + TOP.height + BESIDE.gap + Math.max(words, pipHeight(BESIDE.pip)) + TRACK;
  const clear = `rgba(${[1, 3, 5].map((offset) => parseInt(surface.slice(offset, offset + 2), 16)).join(', ')}, `;

  const response = new ImageResponse(
    <div style={{ display: 'flex', flexDirection: 'column', position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: u(24), background: surface, color: INK, fontFamily: FONT_NAME }}>
      {map && <div style={{ display: 'flex', position: 'relative', width: u(WIDTH), height: u(MAP.height) }}>
        <Drawing svg={map.svg} width={WIDTH} height={MAP.height} style={{ position: 'absolute', left: 0, top: 0 }} />
        {map.labels.map((label) => <div key={label.id} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'absolute', left: u(label.x), top: u(label.y), width: u(label.width), height: u(22),
          borderRadius: u(7), color: tone, whiteSpace: 'nowrap', lineHeight: 1,
          // A country is named in spaced capitals on the bare map; a town on a chip of the card's surface.
          ...(label.kind === 'area' ? { fontSize: u(10.5), letterSpacing: u(.84) } : { fontSize: u(LABEL_SIZE), background: `${clear}.92)`, ...heavy(.25, tone) }),
        }}>{label.text}</div>)}
        {/* The drawing fades into the card where the words begin; Pip stands in front of the fade. */}
        <div style={{ display: 'flex', position: 'absolute', left: 0, top: 0, width: u(WIDTH), height: u(MAP.height), backgroundImage: `linear-gradient(to bottom, ${clear}0) 78%, ${surface} 100%)` }} />
        {map.pip && <Drawing svg={pipSvg(tint)} width={map.pip.width} height={pipHeight(map.pip.width)} style={{ position: 'absolute', left: u(map.pip.x), top: u(map.pip.y) }} />}
      </div>}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: u(TOP.height),
        ...(map ? { position: 'absolute', left: u(20), right: u(16), top: u(TOP.inset) } : { margin: `${u(TOP.inset)}px ${u(16)}px 0 ${u(20)}px` }),
      }}>
        <div style={{ display: 'flex', alignItems: 'center', fontSize: u(12), color: brand }}>
          {carrier && palette && <Drawing svg={truckSvg(carrier, palette)} width={27} height={27 * CARRIER_TRUCK.viewBox.height / CARRIER_TRUCK.viewBox.width} />}
          {/* DHL's wordmark leans. */}
          {name && <span style={{ marginLeft: u(7), ...heavy(.6, brand), ...(family === 'dhl' ? { transform: 'skewX(-12deg)' } : {}) }}>{name}</span>}
          {name && family === 'gls' && <span style={{ color: '#b98a00', ...heavy(.6, '#b98a00') }}>.</span>}
        </div>
        {time && <div style={{ display: 'flex', fontSize: u(11), color: tone }}>{time}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `0 ${u(20)}px`, ...(map ? {} : { marginTop: u(BESIDE.gap) }) }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: u(28), lineHeight: 1.125, letterSpacing: u(-.8), whiteSpace: 'nowrap', ...heavy(.7, INK) }}>{headline}</div>
          {facts && <div style={{ display: 'flex', marginTop: u(8), fontSize: u(15), lineHeight: 1.5, color: tone, whiteSpace: 'nowrap', ...heavy(.2, tone) }}>{facts}</div>}
        </div>
        {!map && <Drawing svg={pipSvg(tint)} width={BESIDE.pip} height={pipHeight(BESIDE.pip)} />}
      </div>
      <div style={{ display: 'flex', padding: `${u(18)}px ${u(20)}px ${u(20)}px` }}>
        {CORE_STAGES.map((stage, index) => <div key={stage} style={{
          display: 'flex', flex: 1, height: u(3), marginLeft: index ? u(4) : 0, borderRadius: u(1.5), background: mix(tone, surface, .45),
        }} />)}
      </div>
    </div>,
    { width: CARD_PIXELS, height: Math.round(u(height)), fonts: [{ name: FONT_NAME, data: fontData, weight: 400, style: 'normal' }] },
  );
  return {
    png: new Uint8Array(await response.arrayBuffer()),
    ends: from && to && from !== to ? { from, to } : null,
    mapped: map !== null,
  };
}
