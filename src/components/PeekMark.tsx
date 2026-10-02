import { createElement, useId } from 'react';
import mark from '../brand/mark.json';
import { useI18n } from '../i18n';

export type PeekMarkDrawing = 'glyph' | 'simple' | 'full' | 'label';

/** The mark loses detail as it shrinks: the label first, then the tape, then everything but the eyes. */
export function peekMarkDrawing(size: number): PeekMarkDrawing {
  return size < 24 ? 'glyph' : size <= 40 ? 'simple' : size < 128 ? 'full' : 'label';
}

type Shape = { tag: string; part?: string } & Record<string, string | number | undefined>;
const drawings: Record<Exclude<PeekMarkDrawing, 'label'>, { clipped?: boolean; shapes: Shape[] }> = mark.drawings;
const attributeName = (name: string) => name.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());

/** The peeking parcel on its postal-yellow tile. It is decorative: the written name stands beside it. */
export function PeekMark({ size, className = '' }: { size: number; className?: string }) {
  const clip = useId();
  const drawing = peekMarkDrawing(size);
  const { shapes, clipped } = drawings[drawing === 'label' ? 'full' : drawing];
  // The label is a part of the full drawing that only the largest sizes keep.
  const drawn = shapes.filter((shape) => drawing === 'label' || !shape.part).map(({ tag, part, ...attributes }, index) => createElement(tag, {
    key: index, 'data-part': part,
    ...Object.fromEntries(Object.entries(attributes).map(([name, value]) => [attributeName(name), value])),
  }));
  return <svg className={`peek-mark ${className}`.trim()} data-drawing={drawing} viewBox={`0 0 ${mark.size} ${mark.size}`} style={{ width: size, height: size }} aria-hidden="true">
    {clipped ? <>
      <clipPath id={clip}><rect width={mark.size} height={mark.size} rx={mark.tile.radius} /></clipPath>
      <g clipPath={`url(#${clip})`}><rect width={mark.size} height={mark.size} fill={mark.tile.fill} />{drawn}</g>
    </> : <><rect width={mark.size} height={mark.size} rx={mark.tile.radius} fill={mark.tile.fill} />{drawn}</>}
  </svg>;
}

/** The mark beside the name and what the app does, for wherever the name stands alone. */
export function PeekLockup({ className = '' }: { className?: string }) {
  const { t } = useI18n();
  return <span className={`peek-lockup ${className}`.trim()}>
    <PeekMark size={28} />
    <span className="peek-lockup__text"><span className="peek-lockup__name">{t('app.title')}</span><span className="peek-lockup__tagline">{t('app.tagline')}</span></span>
  </span>;
}
