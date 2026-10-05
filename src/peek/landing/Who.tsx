import type { ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { PeekMark } from '../../components/PeekMark';
import { LanguageControl, useI18n, type MessageKey } from '../../i18n';
import { trackAction } from '../../lib/analytics';
import { LANDING_PATH, landingAtRoot } from '../../lib/experience';
import { usePeekSession } from '../session';
import { LandingIcon, XLogo } from './glyphs';
import { AUTHOR_URL, OTHER_SITES, SOURCE_URL } from './links';
import './Who.css';

const FACTS: readonly { icon: ReactNode; title: MessageKey; body: MessageKey }[] = [
  { icon: <LandingIcon name="github" />, title: 'link.source', body: 'landing.who.source' },
  { icon: <Icon name="lock" />, title: 'landing.who.account.title', body: 'landing.who.account.body' },
  { icon: <LandingIcon name="forgets" />, title: 'landing.who.forgets.title', body: 'landing.who.forgets.body' },
];

/** "Who's behind Peek?": an open-source project, no account needed, a parcel forgotten on its own, and the ways to its code and its author. */
export function Who() {
  const { t } = useI18n();
  return <section className="landing-who" aria-labelledby="landing-who-title">
    <h2 id="landing-who-title">{t('landing.who.title')}</h2>
    <ul className="landing-who__facts">
      {FACTS.map(({ icon, title, body }) => <li key={title}>
        <span className="landing-who__icon">{icon}</span>
        <strong>{t(title)}</strong>
        <span>{t(body)}</span>
      </li>)}
    </ul>
    <div className="landing-who__links">
      <a className="button landing-who__source" href={SOURCE_URL} target="_blank" rel="noopener noreferrer"><LandingIcon name="github" />{t('landing.who.github')}</a>
      <a className="button landing-who__author" href={AUTHOR_URL} target="_blank" rel="noopener noreferrer" aria-label={t('landing.who.x')}><XLogo />@plhery</a>
    </div>
  </section>;
}

/** The foot of the page: the name, the privacy notice, the code, the language, and what else its author makes. */
export function LandingFooter() {
  const { t, locale } = useI18n();
  const { account } = usePeekSession();
  // English lives at `/`. Where that is the deliveries, the demo or the sign-in step, the landing in English is at its own address.
  const englishAddress = () => account === 'visitor' && landingAtRoot() ? '/' : LANDING_PATH;
  return <footer className="landing-footer">
    <span className="landing-footer__name"><PeekMark size={18} />{t('app.title')} · {t('app.tagline')}</span>
    <a href="/privacy.html" onClick={() => trackAction('privacy-open')}>{t('auth.privacyLink')}</a>
    <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer"><LandingIcon name="github" />GitHub</a>
    <LanguageControl englishAddress={englishAddress} />
    {/* The sentence is cut around the two names, which are the links. No `noreferrer`: each site may see that the visit came from Peek. */}
    <p className="landing-footer__maker">
      {t('landing.footer.maker').split(/\{\{(horoscope|monkey)\}\}/).map((part, index) => {
        if (index % 2 === 0) return part;
        const site = OTHER_SITES[part as keyof typeof OTHER_SITES];
        return <a key={part} href={site.address(locale)} target="_blank" rel="noopener">{site.name}</a>;
      })}
    </p>
  </footer>;
}
