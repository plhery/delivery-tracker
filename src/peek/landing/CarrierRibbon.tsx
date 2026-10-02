import { useRef, useSyncExternalStore, type CSSProperties } from 'react';
import { CarrierMark } from '../../components/CarrierMark';
import { useI18n } from '../../i18n';
import { carrierBrand } from '../../lib/carrierBrand';
import { carrierInfo, type CarrierInfo } from '../../lib/carriers';
import type { CarrierId } from '../../types';
import { useLive } from './useLive';
import './CarrierRibbon.css';

/** The carriers that roll by, in their own liveries. */
export const RIBBON_CARRIERS: readonly CarrierId[] = [
  'swiss-post', 'dhl', 'ups', 'dpd', 'gls-de', 'la-poste', 'spring-gds', 'fedex',
  'royal-mail', 'inpost', 'chronopost', 'usps', 'poste-italiane', 'postnord', 'mondial-relay', 'quickpac',
];
/** How many of them the description names. */
const NAMED = 5;
/** A carrier as the description says it: by its wordmark where that is shorter than its catalog name ("GLS"), spelled as a name. */
function spoken(carrier: CarrierInfo): string {
  const { name } = carrierBrand(carrier);
  return name.toLowerCase() === carrier.name.toLowerCase() ? carrier.name : name;
}
/** Each truck rides a little unevenly, as on a road: four rhythms, none in step with its neighbour. */
const RHYTHMS = [.7, .83, .96, 1.09];
const never = () => () => undefined;

/**
 * The carrier ribbon under the field: trucks rolling by, pausing under the
 * pointer, off screen and in a background tab. One image to a screen reader.
 */
export function CarrierRibbon() {
  const { t, locale } = useI18n();
  const road = useRef<HTMLDivElement>(null);
  const live = useLive(road);
  // The page arrives with one line of trucks, standing. Once it is live the line stands twice in the lane and rolls:
  // the second takes over where the first leaves.
  const rolling = useSyncExternalStore(never, () => true, () => false);
  const carriers = RIBBON_CARRIERS.map((id) => carrierInfo(id, locale));
  return <div className="door-ribbon">
    <p className="door-ribbon__caption">{t('landing.ribbon.caption', { first: carriers[0].name, last: carrierInfo('usps', locale).name })}</p>
    <div ref={road} className="door-ribbon__road" role="img" data-rolling={rolling || undefined} data-paused={!live || undefined}
      aria-label={t('landing.ribbon.label', { carriers: carriers.slice(0, NAMED).map(spoken).join(', ') })}>
      <div className="door-ribbon__lane">
        {(rolling ? [0, 1] : [0]).flatMap((lap) => carriers.map((carrier, index) => <span key={`${lap}:${carrier.id}`} className="door-ribbon__truck" style={{
          ...carrierBrand(carrier).style,
          animationDuration: `${RHYTHMS[index % RHYTHMS.length]}s`,
          animationDelay: `${(index * .17 % 1).toFixed(2)}s`,
        } as CSSProperties}><CarrierMark carrier={carrier} /></span>))}
      </div>
    </div>
  </div>;
}
