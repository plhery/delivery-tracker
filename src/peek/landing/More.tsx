import { Suspense, useRef } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { Seal } from '../../components/Passport';
import { PeekMark } from '../../components/PeekMark';
import { useI18n, type MessageKey } from '../../i18n';
import { LandingIcon } from './glyphs';
import { IOS_APP_URL } from './links';
import { lazyPicture, useNear, useRise } from './useLive';
import './More.css';

// The cards and their sample parcels are for whoever scrolls this far.
const SampleList = lazyPicture(() => import('./SampleList'));

const BENEFITS: readonly { icon: IconName; title: MessageKey; body: MessageKey }[] = [
  { icon: 'parcel', title: 'landing.more.list.title', body: 'landing.more.list.body' },
  { icon: 'bell', title: 'landing.more.pings.title', body: 'landing.more.pings.body' },
  { icon: 'passport', title: 'landing.more.passport.title', body: 'landing.more.passport.body' },
];
const TABS: readonly { icon: IconName; label: MessageKey }[] = [
  { icon: 'parcel', label: 'native.deliveries' }, { icon: 'passport', label: 'passport.title' }, { icon: 'friends', label: 'friends.title' },
];
/** The stamps already in the passport, and the one each delivery adds. */
const STAMPS: readonly { icon: IconName; tone: string; tilt: number }[] = [
  { icon: 'globe', tone: 'blue', tilt: -3 }, { icon: 'express', tone: 'peach', tilt: 2 }, { icon: 'gift', tone: 'lilac', tilt: -2 },
];
const SAMPLE_PARCELS = 3;
const DELIVERED = 10;

/**
 * "Following more than one?": the deliveries list as the app shows it, what
 * signing in adds, and the passport, where a stamp lands each time the
 * journey above delivers.
 */
export function More({ onSignIn, landed }: {
  onSignIn: () => void;
  /** The journey's parcel has just arrived. */
  landed: boolean;
}) {
  const { t, languageTag } = useI18n();
  const phone = useRef<HTMLDivElement>(null);
  const near = useNear(phone);
  const rise = useRise(phone);
  return <section className="landing-section landing-more" aria-labelledby="landing-more-title">
    <div className="landing-more__intro">
      <h2 id="landing-more-title">{t('landing.more.title')}</h2>
      <p>{t('landing.more.body')}</p>
    </div>
    {/* A picture of the app: on a wide screen it stands in a phone. Nothing in it is read out. */}
    <div ref={phone} className="landing-phone" data-rise={rise} aria-hidden="true">
      <div className="landing-phone__screen">
        <div className="landing-phone__view">
          <div className="landing-phone__header">
            <PeekMark size={30} /><strong>{t('native.deliveries')}</strong><span className="landing-phone__account"><Icon name="account" /></span>
          </div>
          <div className="landing-phone__main">
            <div className="landing-phone__heading"><strong>{t('app.onTheWaySection')}</strong><span>{SAMPLE_PARCELS}</span></div>
            {/* The cards are the app's own buttons; in a picture none of them takes the focus or a tap. */}
            <fieldset className="app--deliveries landing-list" disabled>{near && <Suspense fallback={null}><SampleList /></Suspense>}</fieldset>
          </div>
          <div className="landing-phone__tabs">
            {TABS.map(({ icon, label }, index) => <span key={label} data-current={index === 0 || undefined}><Icon name={icon} />{t(label)}</span>)}
          </div>
        </div>
      </div>
    </div>
    <div className="landing-more__rest">
      <ul className="landing-benefits">
        {BENEFITS.map(({ icon, title, body }) => <li key={title}>
          <span className="landing-benefits__icon"><Icon name={icon} /></span>
          <span><strong>{t(title)}</strong><span>{t(body)}</span></span>
        </li>)}
      </ul>
      <div className="landing-passport" aria-hidden="true">
        <div className="passport-cover landing-passport__cover">
          <span><strong className="passport-cover__count">{DELIVERED.toLocaleString(languageTag)}</strong><span>{t('passport.delivered', { count: DELIVERED })}</span></span>
          <Seal icon="parcel" />
        </div>
        <div className="landing-passport__stamps">
          {STAMPS.map(({ icon, tone, tilt }) => <span key={icon} className={`landing-stamp tone-${tone}`} style={{ rotate: `${tilt}deg` }}><Seal icon={icon} /></span>)}
          <span className="landing-stamp landing-stamp--new tone-green" data-landed={landed || undefined}><Seal icon="houses" /></span>
        </div>
      </div>
      <div className="landing-more__actions">
        {/* The page has two ways to sign in; this one says what it is for. */}
        <button type="button" className="button button--primary" onClick={onSignIn}>
          <span>{t('arrival.signInTitle')}{' '}<span className="sr-only">{t('landing.more.signInFor')}</span></span>
        </button>
        {IOS_APP_URL && <a className="button button--secondary" href={IOS_APP_URL} target="_blank" rel="noopener noreferrer"><LandingIcon name="iphone" />{t('landing.more.app')}</a>}
      </div>
    </div>
  </section>;
}
