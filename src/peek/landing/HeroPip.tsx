import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { ParcelIllustration } from '../../components/Icon';
import { useI18n } from '../../i18n';
import { bindArrivalMotion } from '../../lib/arrivalMotion';
import type { CarrierInfo } from '../../lib/carriers';
import { PIP_TRANSITION_NAME } from '../route';
import { SAMPLE_PATH } from '../sample';

/** He presses, the flaps open and the card rises out of the box before the sample shows. */
export const UNBOXING_MS = 1_300;

const still = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** A sentence around the words it sets apart. */
function around(sentence: (value: string) => string): [string, string] {
  const [before = '', after = ''] = sentence('\u0000').split('\u0000');
  return [before, after];
}

/**
 * Pip under the field. He floats, blinks, leans toward the pointer, looks up
 * at the field while it has the focus, and hops with a smile when a carrier
 * answers. With nothing in the field, tapping him opens a sample parcel: the
 * box opens first. Pasting a number never opens it.
 */
export function HeroPip({ label, sample, happy, hop, named = true, onOpening, onOpen }: {
  /** The carrier's label on the box, once the carrier is known. */
  label?: { carrier: CarrierInfo; number: string };
  /** Whether tapping Pip opens a sample: only while the field is empty. */
  sample: boolean;
  happy: boolean;
  /** Names the answer a carrier gave, and is empty while there is none: Pip hops once for each. */
  hop: string;
  /** Whether the browser may move him into a parcel's page: not while a page lies over the door, with a Pip of its own. */
  named?: boolean;
  /** The box starts to open: nothing else on the page should move for attention now. */
  onOpening: () => void;
  /** The box is open: the sample parcel shows. */
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const [opening, setOpening] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const hopper = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // The whole first screen is his to watch, not only the box.
  useEffect(() => {
    const stage = root.current?.closest<HTMLElement>('.door-hero');
    if (stage && !opening) return bindArrivalMotion(stage);
  }, [opening]);

  const hops = useRef(hop);
  useEffect(() => {
    if (hops.current === hop) return;
    hops.current = hop;
    if (!hop || still()) return;
    hopper.current?.animate?.(
      [{ transform: 'none' }, { transform: 'translateY(-16px) rotate(-3deg)', offset: .44 }, { transform: 'none' }],
      { duration: 540, easing: 'cubic-bezier(.22, 1, .36, 1)' },
    );
  }, [hop]);

  function open(event: MouseEvent<HTMLAnchorElement>) {
    // A modified click opens the sample the browser's way, in a new tab or window.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    if (opening) return;
    const paper = root.current?.querySelector('.parcel-illustration__body');
    if (paper) root.current?.style.setProperty('--parcel-rest', getComputedStyle(paper).transform);
    setOpening(true);
    onOpening();
    timer.current = setTimeout(onOpen, still() ? 80 : UNBOXING_MS);
  }

  const [before, after] = around((action) => t('landing.pip.hint', { action }));
  return <>
    <div ref={root} className={`door-pip${opening ? ' door-pip--opening' : ''}`} data-mood={happy && !opening ? 'happy' : undefined}
      style={named ? { viewTransitionName: PIP_TRANSITION_NAME } : undefined}>
      {/* Without an address this is no link: Pip is then the parcel being tracked, not the way to a sample. */}
      <a className="door-pip__tap" href={sample ? SAMPLE_PATH : undefined} aria-label={sample ? t('landing.pip.open') : undefined}
        draggable={false} onClick={sample ? open : undefined}>
        <span className="door-pip__tilt"><span ref={hopper} className="door-pip__hop"><ParcelIllustration label={label} /></span></span>
      </a>
    </div>
    <p className="door-hint" aria-live="polite" data-shown={sample || opening || undefined}>
      {opening ? t('landing.pip.opening') : <>{before}<strong>{t('landing.pip.action')}</strong>{after}</>}
    </p>
  </>;
}
