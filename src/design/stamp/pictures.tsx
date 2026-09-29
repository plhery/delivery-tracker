'use client';

import { geoAzimuthalEqualArea, geoCentroid, geoDistance, geoPath } from 'd3-geo';
import type { MultiPolygon } from 'geojson';
import { useMemo, type ReactNode } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { geography } from '../../components/map/geography';
import type { Stage } from '../../types';
import styles from './study.module.css';

/** Pictures are drawn in the stamp's printed area, 35 wide and 47 tall. */
export const PRINT = { width: 35, height: 47 };

export function GlyphPicture({ icon, size = 20, y }: { icon: IconName; size?: number; y?: number }) {
  return <Icon name={icon} x={(PRINT.width - size) / 2} y={y ?? (PRINT.height - size) / 2 - 2.5} width={size} height={size} className={styles.glyph} />;
}

/** Horizontal hairlines, the way an engraver shades sea and sky. */
function hatching(top: number, bottom: number, left: number, right: number, gap: number): string {
  let d = '';
  for (let y = top + gap / 2; y < bottom; y += gap) d += `M${left} ${y.toFixed(2)}H${right}`;
  return d;
}

/** The country's mainland: overseas parts would shrink it to a dot. */
function mainland(shape: MultiPolygon, label: [number, number]): MultiPolygon {
  const near = shape.coordinates.filter((polygon) => geoDistance(geoCentroid({ type: 'Polygon', coordinates: polygon }), label) < .2);
  return { type: 'MultiPolygon', coordinates: near.length ? near : shape.coordinates };
}

function useCountryOutline(code: string, ready: boolean, box: [[number, number], [number, number]]): string | null {
  return useMemo(() => {
    const country = ready && code ? geography('fine').countries.get(code) : undefined;
    if (!country) return null;
    const label = country.label ?? geoCentroid(country.shape) as [number, number];
    const shape = mainland(country.shape, label);
    const projection = geoAzimuthalEqualArea().rotate([-label[0], -label[1]]).fitExtent(box, shape);
    return geoPath(projection)(shape);
  }, [code, ready, box]);
}

const COUNTRY_BOX: [[number, number], [number, number]] = [[4.5, 12.5], [30.5, 36.5]];

/** An engraved view of the country the parcel was posted in, with the sea in hairlines. */
export function CountryPicture({ origin, name, fallback, icon, km, ready }: {
  origin: string; name: string; fallback: string; icon: IconName; km: number | null; ready: boolean;
}) {
  const outline = useCountryOutline(origin, ready, COUNTRY_BOX);
  const title = outline ? name : fallback;
  const titleSize = Math.max(3.2, Math.min(4.6, 28 / Math.max(1, title.length * .72)));
  return <>
    <text x={PRINT.width / 2} y="6.6" className={styles.engravedTitle} style={{ fontSize: titleSize }}>{title}</text>
    <path d={hatching(9.4, 38, 2.4, 32.6, 1.15)} className={styles.hatch} />
    <rect x="2.4" y="9.4" width="30.2" height="28.6" className={styles.engravedFrame} />
    {outline
      ? <path d={outline} className={styles.land} />
      : <g><circle cx={PRINT.width / 2} cy="23.7" r="9.6" className={styles.land} /><GlyphPicture icon={icon} size={12} y={17.7} /></g>}
    <Icon name={icon} x="2.6" y="39.6" width="5.6" height="5.6" className={styles.valueGlyph} />
    {km !== null && <text x="32.6" y="45" className={styles.value}>{km.toLocaleString('de-CH')}<tspan className={styles.valueUnit} dx=".5">KM</tspan></text>}
  </>;
}

export function EmojiPicture({ emoji, fallback }: { emoji: string | null; fallback: IconName }) {
  if (!emoji) return <GlyphPicture icon={fallback} />;
  return <text x={PRINT.width / 2} y="22" className={styles.emoji}>{emoji}</text>;
}

/**
 * Little scenes for each step, in three inks: the card's colour, a mid tone and
 * the ink itself, with the paper showing through as highlights. In dark mode the
 * same inks turn them into night scenes.
 */
export function ScenePicture({ stage }: { stage: Stage | null }) {
  const scene = SCENES[sceneFor(stage)];
  return <g className={styles.scene}>{scene}</g>;
}

type SceneName = 'announced' | 'pickedUp' | 'transit' | 'customs' | 'outForDelivery' | 'delivered' | 'locker';

function sceneFor(stage: Stage | null): SceneName {
  switch (stage) {
    case 'accepted': return 'pickedUp';
    case 'in_transit': case 'returned': return 'transit';
    case 'customs': return 'customs';
    case 'out_for_delivery': case 'failed_attempt': return 'outForDelivery';
    case 'delivered': return 'delivered';
    case 'ready_for_pickup': return 'locker';
    default: return 'announced';
  }
}

const s = styles;
const Sky = () => <rect width={PRINT.width} height={PRINT.height} className={s.sky} />;
const Wheel = ({ x, y }: { x: number; y: number }) => <><circle cx={x} cy={y} r="2" className={s.ink} /><circle cx={x} cy={y} r=".72" className={s.light} /></>;

const SCENES: Record<SceneName, ReactNode> = {
  announced: <>
    <Sky />
    <path className={s.light} d="M27.6 6.4l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8zM6.4 9.6l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" />
    <rect y="38" width={PRINT.width} height="9" className={s.mid} />
    <rect y="38" width={PRINT.width} height="1.3" className={s.deep} />
    <path className={`${s.mid} ${s.outline}`} d="M9 22.4 13.2 17.6H30.2L26 22.4Z" />
    <path className={`${s.deep} ${s.outline}`} d="M26 22.4 30.2 17.6V33.4L26 38.2Z" />
    <rect className={`${s.light} ${s.outline}`} x="9" y="22.4" width="17" height="15.8" />
    <path className={s.mid} d="M15.7 22.4H19.3V38.2H15.7Z" />
    <path className={s.deep} d="M15.7 22.4 19.9 17.6H23.5L19.3 22.4Z" />
    <path className={s.inkLine} d="M9 25.2C6.6 25.4 5.4 26.8 5.4 28.8" />
    <path className={`${s.light} ${s.outline}`} d="M3 29.2 5.4 28 7.8 29.2V35H3Z" />
    <circle className={s.ink} cx="5.4" cy="30.1" r=".45" />
  </>,
  pickedUp: <>
    <Sky />
    <circle className={s.light} cx="8" cy="9" r="3.4" />
    <path className={s.mid} d="M0 31 7 24.5 12 28 20 20 27 27 35 22V47H0Z" />
    <rect y="38.5" width={PRINT.width} height="8.5" className={s.deep} />
    <rect className={`${s.light} ${s.outline}`} x="6" y="23" width="23" height="15.5" />
    <rect className={s.ink} x="5" y="21.2" width="25" height="2.4" />
    <rect className={s.ink} x="15.3" y="30" width="4.8" height="8.5" />
    <rect className={s.mid} x="8.6" y="26.4" width="4.2" height="4.2" />
    <rect className={s.mid} x="22.6" y="26.4" width="4.2" height="4.2" />
    <path className={s.inkLine} d="M26.6 21.2V11.4" />
    <rect className={s.ink} x="26.6" y="11.4" width="5.6" height="4.4" />
    <path className={s.light} d="M28.9 12.3h1v1h1v1h-1v1h-1v-1h-1v-1h1z" />
  </>,
  transit: <>
    <Sky />
    <circle className={s.light} cx="26.6" cy="10.2" r="3.8" />
    <path className={s.mid} d="M0 30 6.5 22.5 10 26 17.5 15.5 24 24 27.5 20.5 35 27.5V47H0Z" />
    <path className={s.light} d="M15.2 18.7 17.5 15.5 19.9 18.9 18.7 18.3 17.6 19.4 16.4 18.4ZM5.1 24.1 6.5 22.5 7.9 23.9 7.1 23.7 6.4 24.5 5.7 23.8Z" />
    <path className={s.deep} d="M0 36C7 33 13 34.5 19 35.5 25 36.5 30 34 35 34.5V47H0Z" />
    <rect className={s.ink} y="40.4" width={PRINT.width} height="2.8" />
    <path className={s.lane} d="M1 41.8H4M7 41.8H10M13 41.8H16M19 41.8H22M25 41.8H28M31 41.8H34" />
    <rect className={`${s.light} ${s.outline}`} x="6" y="30.6" width="13.4" height="8.6" rx=".5" />
    <path className={s.ink} d="M19.4 32.8H23.6L26.6 36V39.2H19.4Z" />
    <path className={s.light} d="M20.4 33.8H23.1L25.1 36H20.4Z" />
    <Wheel x={9.6} y={39.6} />
    <Wheel x={23.2} y={39.6} />
    <path className={s.speed} d="M1.4 32.4H4.2M.6 35H4.2M1.4 37.6H4.2" />
  </>,
  customs: <>
    <Sky />
    <path className={s.mid} d="M0 29 8 21 14 26 21 18.5 28 25 35 21V47H0Z" />
    <path className={s.light} d="M18.9 20.7 21 18.5 23.2 20.6 22.1 20.3 21.1 21.3 19.9 20.4Z" />
    <rect y="37.6" width={PRINT.width} height="9.4" className={s.deep} />
    <rect className={`${s.light} ${s.outline}`} x="22.4" y="27.4" width="8.6" height="10.2" />
    <rect className={s.ink} x="21.4" y="25.6" width="10.6" height="2.2" />
    <rect className={s.mid} x="24.3" y="29.6" width="4.8" height="3.6" />
    <rect className={s.ink} x="3.6" y="28.8" width="2.6" height="8.8" />
    <rect className={`${s.light} ${s.outline}`} x="6.2" y="29.8" width="14.4" height="2.2" />
    <path className={s.ink} d="M8.6 29.8h2.2V32H8.6zM13 29.8h2.2V32H13zM17.4 29.8h2.2V32h-2.2z" />
  </>,
  outForDelivery: <>
    <Sky />
    <circle className={s.light} cx="6.6" cy="8.8" r="3.3" />
    <path className={s.mid} d="M0 36V25L4.5 21 9 25V36ZM10 36V18.6H17V36ZM18 36V27L23 22.5 28 27V36ZM29 36V21.4H35V36Z" />
    <path className={s.light} d="M12 21h1.6v1.6H12zM14.6 21h1.6v1.6h-1.6zM12 24.6h1.6v1.6H12zM14.6 24.6h1.6v1.6h-1.6zM31 24h1.6v1.6H31zM31 28h1.6v1.6H31z" />
    <rect y="35.6" width={PRINT.width} height="11.4" className={s.deep} />
    <path className={s.lane} d="M2 44.6H6M10 44.6H14M18 44.6H22M26 44.6H30M34 44.6H38" />
    <path className={`${s.light} ${s.outline}`} d="M5.6 30.6H20.4C22.5 30.6 23.9 31.4 25.2 33.2L26.8 35C28.3 35.3 29.1 36 29.1 37.4V40.4H5.6Z" />
    <path className={s.ink} d="M20.2 31.9H21.8C23 31.9 23.9 32.5 24.7 33.8L25.4 35H20.2Z" />
    <path className={s.inkLine} d="M9.4 33.4H14.4V37.6H9.4ZM11.9 33.4V37.6" />
    <Wheel x={10} y={40.6} />
    <Wheel x={24.6} y={40.6} />
    <path className={s.speed} d="M.9 33H3.4M.2 35.6H3.4M.9 38.2H3.4" />
  </>,
  delivered: <>
    <Sky />
    <circle className={s.light} cx="27.6" cy="9.4" r="3.6" />
    <path className={s.mid} d="M0 33C8 29 16 31 22 32 28 33 31 30.5 35 31V47H0Z" />
    <rect y="39.4" width={PRINT.width} height="7.6" className={s.deep} />
    <rect className={s.ink} x="22.6" y="15" width="2.6" height="6" />
    <rect className={`${s.light} ${s.outline}`} x="7" y="24" width="21" height="15.4" />
    <path className={s.ink} d="M5 24.4 17.5 13.2 30 24.4Z" />
    <rect className={s.mid} x="14.9" y="30" width="5.2" height="9.4" />
    <circle className={s.ink} cx="19" cy="35" r=".45" />
    <rect className={s.mid} x="9.3" y="27" width="3.8" height="3.8" />
    <rect className={s.mid} x="21.9" y="27" width="3.8" height="3.8" />
    <path className={s.light} d="M15.4 39.4H19.6L22 47H13Z" />
    <rect className={`${s.deep} ${s.outline}`} x="21" y="35.4" width="4.4" height="4" />
    <path className={s.laneInk} d="M23.2 35.4V39.4" />
  </>,
  locker: <>
    <Sky />
    <rect y="40" width={PRINT.width} height="7" className={s.deep} />
    <rect className={`${s.light} ${s.outline}`} x="5.6" y="11.6" width="22.4" height="28.4" rx=".5" />
    <path className={s.inkLine} d="M13.1 11.6V40M20.5 11.6V40M5.6 18.7H28M5.6 25.8H28M5.6 32.9H28" />
    <rect className={s.deep} x="20.5" y="25.8" width="7.5" height="7.1" />
    <rect className={`${s.mid} ${s.outline}`} x="22.2" y="28.4" width="4.1" height="4.5" />
    <path className={`${s.light} ${s.outline}`} d="M28 25.8 32.2 27.2V34.3L28 32.9Z" />
  </>,
};
