import { createElement, type ReactNode } from 'react';
import mark from '../brand/mark.json';
import { languagePath, SUPPORTED_LOCALES, type Locale } from '../lib/locale';
import type { Translate } from '../lib/messages';
import { SOURCE_URL } from '../lib/source';
import { GuideAnalytics } from './GuideAnalytics';
import { guidePath } from './paths';
import './guides.css';

/** Peek's mark, drawn without the app around it. */
function Mark({ size }: { size: number }) {
  return <svg className="peek-mark" viewBox={`0 0 ${mark.size} ${mark.size}`} style={{ width: size, height: size }} aria-hidden="true">
    <rect width={mark.size} height={mark.size} rx={mark.tile.radius} fill={mark.tile.fill} />
    {mark.shapes.map(({ tag, ...attributes }, index) => createElement(tag, { key: index, ...attributes }))}
  </svg>;
}

/**
 * What stands around every guides page: the name and the way to the tracker
 * above, and below it the same foot as the landing, with the page in each
 * language as plain links a search engine can follow. The tracker is the
 * landing in the page's language, reached with a plain link so the browser
 * loads it anew: what the landing decides before its first paint only runs on
 * a fresh document.
 */
export function GuideFrame({ locale, t, addresses, languageNames, screen, children }: {
  locale: Locale;
  t: Translate;
  /** This page in every language. */
  addresses: Record<Locale, string>;
  /** Each language's name, written in that language. */
  languageNames: Record<Locale, string>;
  /** The page's name in the usage counts. */
  screen: string;
  children: ReactNode;
}) {
  const tracker = languagePath(locale);
  return <div className="guide-page">
    <header className="guide-top">
      <a className="peek-lockup" href={tracker}>
        <Mark size={28} />
        <span className="peek-lockup__text"><span className="peek-lockup__name">{t('app.title')}</span><span className="peek-lockup__tagline">{t('app.tagline')}</span></span>
      </a>
      <a className="button button--primary guide-top__track" href={tracker}>{t('sample.yours.action')}</a>
    </header>
    <main>{children}</main>
    <footer className="guide-footer">
      <div className="guide-footer__links">
        <a className="guide-footer__name" href={tracker}><Mark size={18} />{t('app.title')} · {t('app.tagline')}</a>
        <a href={guidePath(locale)}>{t('guides.all')}</a>
        <a href="/privacy.html">{t('auth.privacyLink')}</a>
        <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
      </div>
      <nav className="guide-footer__languages" aria-label={t('language.label')}>
        {SUPPORTED_LOCALES.map((language) => <a key={language} href={addresses[language]} hrefLang={language} lang={language}
          aria-current={language === locale ? 'page' : undefined}>{languageNames[language]}</a>)}
      </nav>
    </footer>
    <GuideAnalytics screen={screen} />
  </div>;
}
