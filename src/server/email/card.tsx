import 'server-only';

import { ImageResponse } from 'next/og';
import type { CSSProperties } from 'react';
import { CARRIER_PALETTES, CARRIER_TRUCK, carrierBrand, carrierBrandFamily, carrierDecal, mix, type CarrierPalette, type TruckDecalShape } from '../../brand';
import { PARCEL, flapPoints } from '../../components/Icon';
import { PIP_FRAME } from '../../components/map/pipGeometry';
import type { Rect } from '../../components/map/layout';
import { formatKm, type Route } from '../../components/map/route';
import type { CarrierInfo } from '../../lib/carriers';
import type { Translate } from '../../lib/messages';
import { formatJourneyDuration } from '../../lib/passport';
import { CORE_STAGES, stageMeta } from '../../lib/stages';
import type { ParcelWithEvents } from '../../types';
import { GEIST, textWidth, writable } from '../pictureFont';
import { journeyMap, LABEL_SIZE, type Tint } from './cardMap';
import type { EmailStage } from './types';

/** The card's width in CSS pixels: the column of the email it is shown in. Every measure below is in these. */
const WIDTH = 456;
/** Drawn larger than it is shown, so it stays sharp on a dense screen. */
export const CARD_PIXELS = 1040;
const SCALE = CARD_PIXELS / WIDTH;
/** The map across the top of the card, with the room the app's own card keeps around the route. */
const MAP = { height: 236, insets: { top: 48, right: 18, bottom: 56, left: 18 } };
/** The carrier and the time, in the top corners. */
const TOP = { inset: 16, height: 18 };
/** How far under the first carrier's mark a second one stands, as on the app's card. */
const MARK_GAP = 7;
/**
 * A second carrier's mark adds a line to the top row: the route starts below it, and the map grows by that much, as on
 * the app's shared card.
 */
const HANDOVER_ROOM = 24;
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

/** The carrier's name as its mark writes it, when the picture's face can. */
function wordmark(carrier: CarrierInfo): { family: string; name: string | null } {
  const family = carrierBrandFamily(carrier.id);
  return { family, name: writable(WORDMARKS[family] ?? carrier.name, GEIST) };
}

/** The carrier's mark: its truck, and its name in its own colour. */
function CarrierMark({ carrier }: { carrier: CarrierInfo }) {
  const palette = carrierBrand(carrier.color, CARRIER_PALETTES[carrier.id]);
  const brand = palette['brand-light'];
  const { family, name } = wordmark(carrier);
  return <div style={{ display: 'flex', alignItems: 'center', height: u(TOP.height), fontSize: u(12), color: brand }}>
    <Drawing svg={truckSvg(carrier, palette)} width={27} height={27 * CARRIER_TRUCK.viewBox.height / CARRIER_TRUCK.viewBox.width} />
    {/* DHL's wordmark leans. */}
    {name && <span style={{ marginLeft: u(7), ...heavy(.6, brand), ...(family === 'dhl' ? { transform: 'skewX(-12deg)' } : {}) }}>{name}</span>}
    {name && family === 'gls' && <span style={{ color: '#b98a00', ...heavy(.6, '#b98a00') }}>.</span>}
  </div>;
}

/** The box a second carrier's mark takes on the card, in CSS pixels: the map keeps its route, names and Pip off it. */
function secondMarkBox(carrier: CarrierInfo): Rect {
  const { family, name } = wordmark(carrier);
  const words = name ? 7 + textWidth(family === 'gls' ? `${name}.` : name, 12, GEIST) : 0;
  return { x: 20, y: TOP.inset + TOP.height + MARK_GAP, width: 27 + words + 2, height: TOP.height };
}

/**
 * Pip as he stands on the parcel's map in the app: his box open once it is
 * delivered, shut and looking up while it waits at its pickup point. The kraft
 * parcel's geometry in the card's ink mixed toward its surface.
 */
function pipSvg({ tone, surface }: Tint, open: boolean): string {
  const toward = (amount: number) => mix(surface, tone, amount);
  const deep = mix(tone, '#000000', .18);
  const paper = mix(surface, '#ffffff', .62);
  const blush = mix(toward(.56), '#f0707e', .55);
  const flap = (name: keyof typeof PARCEL.flaps, fill: string) => `<polygon points="${flapPoints(PARCEL.flaps[name], open)}" fill="${fill}" stroke="${tone}" stroke-opacity=".24" stroke-width=".7"/>`;
  const glints = [tone, toward(.72), tone, toward(.86), toward(.72), tone];
  // Happy, or his two eyes raised toward the dot above him and his mouth a line.
  const face = open
    ? `<path d="M14.25 37.5Q26.25 21 38.25 37.5M57.75 37.5Q69.75 21 81.75 37.5" stroke="${deep}" stroke-width="4.5" stroke-linecap="round"/>`
      + [25.25, 68.75].map((x) => `<ellipse cx="${x}" cy="55.5" rx="9.75" ry="4.8" fill="${blush}" opacity=".55"/>`).join('')
      + `<path d="M33.75 53.25Q48 78 62.25 53.25Z" fill="${deep}" stroke="${deep}" stroke-width="2.7" stroke-linejoin="round"/>`
      + `<path d="M41.1 66Q48 61.5 54.9 66Q48 71.4 41.1 66Z" fill="${blush}"/>`
    : [26.25, 69.75].map((x) => `<ellipse cx="${x}" cy="33" rx="15" ry="17.25" fill="${paper}"/>`
      + `<circle cx="${x - 2.52}" cy="27.54" r="8.1" fill="${deep}"/><circle cx="${x - 5.22}" cy="24.54" r="2.4" fill="${paper}"/>`).join('')
      + `<path d="M41.25 59.25H54.75" stroke="${deep}" stroke-width="3.6" stroke-linecap="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PIP_FRAME.width} ${PIP_FRAME.height}" fill="none">`
    + `<ellipse cx="150" cy="286" rx="84" ry="10" fill="${deep}" opacity=".14"/>`
    + `<path d="${PARCEL.inside}" fill="${deep}"/>`
    // Shut, two of the flaps are folded under the other two.
    + (open ? flap('backLeft', toward(.62)) : '') + flap('backRight', toward(.4))
    + `<path d="${PARCEL.left}" fill="${toward(.56)}"/><path d="${PARCEL.right}" fill="${toward(.84)}"/>`
    + `<path d="${PARCEL.left}" fill="${paper}" opacity=".07"/>`
    + `<path d="${PARCEL.hairlines}" stroke="${tone}" stroke-opacity=".25" stroke-width=".8"/>`
    + `<path d="${PARCEL.edges}" stroke="${paper}" stroke-width="1" opacity=".4"/>`
    // The face is on the side, under the front flaps: open, the left one is a brim over his eyes.
    + `<g transform="${PARCEL.facePlane}">${face}</g>`
    + (open ? flap('frontRight', toward(.5)) : '') + flap('frontLeft', toward(.36))
    + (open
      ? PARCEL.glints.map(({ x, y, size }, index) => `<path d="${PARCEL.glint}" transform="translate(${x} ${y}) scale(${size / 2})" fill="${glints[index]}"/>`).join('')
      : `<path d="${PARCEL.tape}" fill="${toward(.2)}"/><path d="${PARCEL.seam}" stroke="${toward(.7)}" stroke-opacity=".6" stroke-width="1" stroke-dasharray="3 3"/>`)
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
  return facts.length ? writable(facts.join(' · '), GEIST) : null;
}

export interface DeliveryCardInput {
  parcel: ParcelWithEvents;
  /** Null when no carrier is known: the card stays neutral and names none. */
  carrier: CarrierInfo | null;
  /** The carrier that delivered a parcel handed over by the first: its mark stands under the first one. */
  delivery?: CarrierInfo | null;
  /** When it was delivered, as the email's sentence says it: "Today, 14:12". Null without a usable time. */
  when: string | null;
  /** Whether the scan it tells carries the carrier's own clock time. */
  timed: boolean;
  t: Translate;
  languageTag: string;
  /** What the card shows: the parcel delivered, or waiting at its pickup point. Left out, delivered. */
  stage?: EmailStage;
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
 * it has arrived. The journey on the map, with Pip beside the place it ended,
 * his box open when it was delivered and shut while it waits to be collected;
 * the carrier, with the one it handed the parcel to under it, and when;
 * "Delivered" or "Ready for pickup", what the journey came to, and the track
 * filled as far as it got. It carries no parcel name, number or address. A
 * parcel none of whose scans could be placed gets the card without the map.
 *
 * Every word on it is checked against the picture's own face first: the
 * renderer would otherwise fetch a font for it from the web.
 */
export async function deliveryCard({ parcel, carrier, delivery = null, when, timed, t, languageTag, stage = 'delivered' }: DeliveryCardInput): Promise<DeliveryCard> {
  const palette = carrier ? carrierBrand(carrier.color, CARRIER_PALETTES[carrier.id]) : null;
  const tint: Tint = palette ? { tone: palette['ink-light'], surface: palette['surface-light'] } : NEUTRAL;
  const { tone, surface } = tint;
  const second = carrier && delivery;
  const top = TOP.height + (second ? MARK_GAP + TOP.height : 0);
  const mapHeight = MAP.height + (second ? HANDOVER_ROOM : 0);
  // Pip keeps his ceiling: beside the parcel's dot, he only keeps off the second mark.
  const map = await journeyMap(parcel, languageTag, { width: WIDTH, height: mapHeight }, { ...MAP.insets, top: MAP.insets.top + (second ? HANDOVER_ROOM : 0) }, tint,
    { ceiling: MAP.insets.top, covered: second ? secondMarkBox(second) : undefined, stage });
  const open = stage === 'delivered';
  const headline = writable(t(`stage.${stage}`), GEIST) ?? '';
  // A long name for the stage gets smaller, on its one line, to leave Pip his room.
  const room = WIDTH - 40 - (map ? 0 : BESIDE.pip + BESIDE.gap);
  const headlineSize = Math.min(28, 28 * room / Math.max(textWidth(headline, 28, GEIST) - .8 * [...headline].length, 1));
  const reached = stageMeta(stage).progress;
  const facts = map ? journeyFacts(map.route, parcel, timed, t, languageTag) : null;
  const time = when ? writable(when, GEIST) : null;
  const from = map?.route.origin?.place.name;
  const to = (map?.route.destination ?? map?.route.current?.place)?.name;
  const pipHeight = (width: number) => width * PIP_FRAME.height / PIP_FRAME.width;
  const words = HEADLINE + (facts ? FACTS : 0);
  const height = map ? mapHeight + words + TRACK : TOP.inset + top + BESIDE.gap + Math.max(words, pipHeight(BESIDE.pip)) + TRACK;
  const clear = `rgba(${[1, 3, 5].map((offset) => parseInt(surface.slice(offset, offset + 2), 16)).join(', ')}, `;

  const response = new ImageResponse(
    <div style={{ display: 'flex', flexDirection: 'column', position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: u(24), background: surface, color: INK, fontFamily: GEIST.name }}>
      {map && <div style={{ display: 'flex', position: 'relative', width: u(WIDTH), height: u(mapHeight) }}>
        <Drawing svg={map.svg} width={WIDTH} height={mapHeight} style={{ position: 'absolute', left: 0, top: 0 }} />
        {map.labels.map((label) => <div key={label.id} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'absolute', left: u(label.x), top: u(label.y), width: u(label.width), height: u(22),
          borderRadius: u(7), color: tone, whiteSpace: 'nowrap', lineHeight: 1,
          // A country is named in spaced capitals on the bare map; a town on a chip of the card's surface.
          ...(label.kind === 'area' ? { fontSize: u(10.5), letterSpacing: u(.84) } : { fontSize: u(LABEL_SIZE), background: `${clear}.92)`, ...heavy(.25, tone) }),
        }}>{label.text}</div>)}
        {/* The drawing fades into the card where the words begin; Pip stands in front of the fade. */}
        <div style={{ display: 'flex', position: 'absolute', left: 0, top: 0, width: u(WIDTH), height: u(mapHeight), backgroundImage: `linear-gradient(to bottom, ${clear}0) 78%, ${surface} 100%)` }} />
        {map.pip && <Drawing svg={pipSvg(tint, open)} width={map.pip.width} height={pipHeight(map.pip.width)} style={{ position: 'absolute', left: u(map.pip.x), top: u(map.pip.y) }} />}
      </div>}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', height: u(top),
        ...(map ? { position: 'absolute', left: u(20), right: u(16), top: u(TOP.inset) } : { margin: `${u(TOP.inset)}px ${u(16)}px 0 ${u(20)}px` }),
      }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {carrier && <CarrierMark carrier={carrier} />}
          {second && <div style={{ display: 'flex', marginTop: u(MARK_GAP) }}><CarrierMark carrier={second} /></div>}
        </div>
        {time && <div style={{ display: 'flex', alignItems: 'center', height: u(TOP.height), fontSize: u(11), color: tone }}>{time}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `0 ${u(20)}px`, ...(map ? {} : { marginTop: u(BESIDE.gap) }) }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: u(headlineSize), lineHeight: `${u(HEADLINE)}px`, letterSpacing: u(-.8 * headlineSize / 28), whiteSpace: 'nowrap', ...heavy(.7, INK) }}>{headline}</div>
          {facts && <div style={{ display: 'flex', marginTop: u(8), fontSize: u(15), lineHeight: 1.5, color: tone, whiteSpace: 'nowrap', ...heavy(.2, tone) }}>{facts}</div>}
        </div>
        {!map && <Drawing svg={pipSvg(tint, open)} width={BESIDE.pip} height={pipHeight(BESIDE.pip)} />}
      </div>
      <div style={{ display: 'flex', padding: `${u(18)}px ${u(20)}px ${u(20)}px` }}>
        {CORE_STAGES.map((step, index) => <div key={step} style={{
          display: 'flex', flex: 1, height: u(3), marginLeft: index ? u(4) : 0, borderRadius: u(1.5),
          background: index <= reached ? mix(tone, surface, .45) : mix(surface, INK, .14),
        }} />)}
      </div>
    </div>,
    { width: CARD_PIXELS, height: Math.round(u(height)), fonts: [{ name: GEIST.name, data: GEIST.data, weight: 400, style: 'normal' }] },
  );
  return {
    png: new Uint8Array(await response.arrayBuffer()),
    ends: from && to && from !== to ? { from, to } : null,
    mapped: map !== null,
  };
}
