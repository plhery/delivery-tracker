import { CarrierTruck } from '../../components/CarrierMark';
import { Icon } from '../../components/Icon';
import { useI18n, type MessageKey } from '../../i18n';
import { carrierNameList } from '../../lib/carrierPicker';
import { carrierInfo } from '../../lib/carriers';
import type { CarrierId } from '../../types';
import type { SampleBeat } from './useSampleLoop';

/**
 * What the field shows while nobody has touched it: a number, a link and an
 * email, each with the carrier that answers. Every number is fictional, and
 * none of this is ever the field's value.
 */
const SAMPLES: readonly { text: string | { key: MessageKey; number: string }; carrier: CarrierId; answer: MessageKey }[] = [
  { text: '1234567899', carrier: 'dhl', answer: 'add.line.found' },
  { text: 'ups.com/track?tracknum=1ZDEMO202600000001', carrier: 'ups', answer: 'landing.sample.inLink' },
  { text: { key: 'landing.sample.email', number: '99.60.123456.78901234' }, carrier: 'swiss-post', answer: 'landing.sample.inEmail' },
];
export const SAMPLE_COUNT = SAMPLES.length;
/** The carriers the line says it is asking. */
const ASKED: readonly CarrierId[] = ['dhl', 'ups', 'swiss-post'];

/** The sample as it lands in the field, over the placeholder. */
export function SampleText({ beat }: { beat: SampleBeat }) {
  const { t } = useI18n();
  const { text } = SAMPLES[beat.index % SAMPLE_COUNT];
  const on = beat.phase === 'paste' || beat.phase === 'finding' || beat.phase === 'found';
  return <span className="door-sample" aria-hidden="true" data-on={on || undefined}>
    <span className="door-sample__text">{typeof text === 'string' ? text : t(text.key, { number: text.number })}</span>
  </span>;
}

/** The carrier's line under the field: the carriers are asked, then one answers. */
export function SampleLine({ beat }: { beat: SampleBeat }) {
  const { t, locale, languageTag } = useI18n();
  const sample = SAMPLES[beat.index % SAMPLE_COUNT];
  const carrier = carrierInfo(sample.carrier, locale);
  return <div className="door-sample-line" aria-hidden="true" data-phase={beat.phase}>
    <div className="door-sample-line__finding">
      <span className="door-line__detect is-busy"><Icon name="detect" /></span>
      <span className="door-line__text">
        <strong>{t('door.line.finding')}</strong>{' '}
        <small>{t('add.line.asking', { carriers: carrierNameList(ASKED, locale, languageTag) })}</small>
      </span>
    </div>
    <div className="door-sample-line__found">
      <CarrierTruck carrier={carrier} />
      <span className="door-line__text"><strong>{carrier.name}</strong>{' '}<small>{t(sample.answer)}</small></span>
    </div>
  </div>;
}
