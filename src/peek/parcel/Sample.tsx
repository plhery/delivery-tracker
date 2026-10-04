import { Icon } from '../../components/Icon';
import { useI18n } from '../../i18n';
import { DEMO_PATH } from '../../lib/experience';
import type { CarrierInfo } from '../../lib/carriers';
import { followDemoLink, followInPlace } from '../landing/links';
import { Glyph } from './glyphs';
import { CardStack } from './Keep';

/** Above the sample's card: the way back to the landing it is opened from, and what the page is. */
export function SampleNote({ landingPath, onLanding }: {
  landingPath: string;
  onLanding: () => void;
}) {
  const { t } = useI18n();
  return <div className="peekp-sample">
    <a className="peekp-textlink" href={landingPath} onClick={(event) => followInPlace(event, onLanding)}><Icon name="back" />{t('app.homePage')}</a>
    <p className="peekp-shared"><Glyph name="info" />{t('sample.note')}</p>
  </div>;
}

/**
 * Where the sample leads: back to the field for a parcel of one's own, and,
 * for a visitor who follows several, to an account, with the demo deliveries
 * to look at first.
 */
export function SampleInvitation({ carrier, onTrack, onSignIn }: {
  carrier: CarrierInfo;
  onTrack: () => void;
  /** Offered to a visitor only. */
  onSignIn?: () => void;
}) {
  const { t } = useI18n();
  return <>
    <section className="peekp-yours" aria-labelledby="peekp-yours-title">
      <div>
        <h2 id="peekp-yours-title">{t('sample.yours.title')}</h2>
        <p>{t('sample.yours.body')}</p>
      </div>
      <button type="button" className="button button--primary" onClick={onTrack}><Icon name="search" />{t('sample.yours.action')}</button>
    </section>
    {onSignIn && <section className="peekp-keep" aria-labelledby="peekp-keep-title">
      <CardStack carrier={carrier} />
      <div>
        <h2 id="peekp-keep-title">{t('landing.more.title')}</h2>
        <p>{t('link.keep.body')}</p>
        <div className="peekp-keep__ways">
          <button type="button" className="peekp-textlink" onClick={onSignIn}>{t('arrival.signInTitle')}<Icon name="chevron" /></button>
          <a className="peekp-textlink" href={DEMO_PATH} onClick={followDemoLink}>{t('landing.more.demo')}<Icon name="chevron" /></a>
        </div>
      </div>
    </section>}
  </>;
}
