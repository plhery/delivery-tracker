import type { ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { PeekMark } from '../../components/PeekMark';
import { LanguageControl, useI18n, type MessageKey } from '../../i18n';
import { trackAction } from '../../lib/analytics';
import { LandingIcon } from './glyphs';
import { SOURCE_URL } from './links';
import './Who.css';

const FACTS: readonly { icon: ReactNode; title: MessageKey; body: MessageKey }[] = [
  { icon: <LandingIcon name="github" />, title: 'link.source', body: 'landing.who.source' },
  { icon: <Icon name="lock" />, title: 'landing.who.account.title', body: 'landing.who.account.body' },
  { icon: <LandingIcon name="forgets" />, title: 'landing.who.forgets.title', body: 'landing.who.forgets.body' },
];

/** "Who's behind Peek?": an open-source project, no account needed, and a parcel forgotten on its own. */
export function Who() {
  const { t } = useI18n();
  return <section className="landing-who" aria-labelledby="landing-who-title">
    <div className="landing-who__intro">
      <h2 id="landing-who-title">{t('landing.who.title')}</h2>
      <p>{t('landing.who.body')}</p>
    </div>
    <ul className="landing-who__facts">
      {FACTS.map(({ icon, title, body }) => <li key={title}>
        <span className="landing-who__icon">{icon}</span>
        <strong>{t(title)}</strong>
        <span>{t(body)}</span>
      </li>)}
    </ul>
    <a className="button landing-who__source" href={SOURCE_URL} target="_blank" rel="noopener noreferrer"><LandingIcon name="github" />{t('landing.who.github')}</a>
  </section>;
}

/** The foot of the page: the name, the privacy notice, the code, and the language. */
export function LandingFooter() {
  const { t } = useI18n();
  return <footer className="landing-footer">
    <span className="landing-footer__name"><PeekMark size={18} />{t('app.title')} · {t('app.tagline')}</span>
    <a href="/privacy.html" onClick={() => trackAction('privacy-open')}>{t('auth.privacyLink')}</a>
    <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer"><LandingIcon name="github" />GitHub</a>
    <LanguageControl />
  </footer>;
}
