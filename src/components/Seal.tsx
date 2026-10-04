import { Icon, type IconName } from './Icon';

/** A passport stamp: an icon, or a numeral, in a die-cut frame that takes the tone it stands in. */
export function Seal({ icon, earned = true, numeral = '10' }: { icon: IconName; earned?: boolean; numeral?: string }) {
  return <span className={`passport-seal${earned ? '' : ' passport-seal--locked'}`} aria-hidden="true"><span className="passport-seal__frame">{icon === 'stamp' ? <span className="passport-seal__ten">{numeral}</span> : <Icon name={icon} />}</span></span>;
}
