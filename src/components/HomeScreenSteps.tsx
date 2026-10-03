import { Fragment, useState, type ReactNode } from 'react';
import { useI18n, type MessageKey } from '../i18n';
import { homeScreenPath } from '../lib/homeScreen';
import { Icon } from './Icon';
import { PeekMark } from './PeekMark';
import './HomeScreenSteps.css';

/** Safari's own glyphs, redrawn in the app's line so that a step shows what to look for. */
const GLYPHS = {
  menu: 'M4 7h16M4 12h16M4 17h10',
  more: 'm6 9.5 6 6 6-6',
  add: 'M7.5 3.5h9a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4h-9a4 4 0 0 1-4-4v-9a4 4 0 0 1 4-4ZM12 8.2v7.6M8.2 12h7.6',
  back: 'm14.5 6-6 6 6 6',
  reload: 'M19 12a7 7 0 1 1-2.6-5.4M17.2 3v4h-4',
  tabs: 'M11 9h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2ZM5.5 15A2 2 0 0 1 4 13V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 1.5',
} as const;

function Glyph({ name }: { name: keyof typeof GLYPHS }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={GLYPHS[name]} /></svg>;
}

/** A translated sentence with its controls set in where the translation names them. */
function sentence(text: string, controls: Record<string, ReactNode>): ReactNode {
  return text.split(/\[\[(\w+)\]\]/).map((piece, index) => index % 2 ? <Fragment key={index}>{controls[piece]}</Fragment> : piece);
}

/** Safari 27's bar in small, with the site's name as Safari writes it: pale, but for the page menu to start from. */
function SafariBar() {
  return <span className="home-steps__bar" aria-hidden="true">
    <span><Glyph name="back" /></span>
    <span><span className="home-steps__target"><Glyph name="menu" /></span><span>{window.location.hostname.replace(/^www\./, '')}</span><Glyph name="reload" /></span>
    <span><Glyph name="tabs" /></span>
  </span>;
}

/**
 * The way to the Home Screen, where an iPhone keeps a site's notifications.
 * Each step names the control to tap as Safari shows it, glyph and name, and
 * Safari 27's first step draws its bar with the button to start from.
 */
export function HomeScreenSteps({ then, cards = false }: {
  /** What is left to do once Peek is open from the Home Screen. */
  then: 'ping' | 'notifications';
  /** Each step on its own card, as a sheet lays them out. */
  cards?: boolean;
}) {
  const { t } = useI18n();
  const [path] = useState(() => homeScreenPath());
  const say = (key: MessageKey, controls: Record<string, ReactNode>) =>
    sentence(t(key, Object.fromEntries(Object.keys(controls).map((name) => [name, `[[${name}]]`]))), controls);
  const control = (glyph: ReactNode, label: MessageKey) => <span className="home-steps__control">{glyph}{t(label)}</span>;
  // The page menu has no written name in Safari: its glyph stands in the sentence, and its name is read out.
  const menu = <span className="home-steps__control home-steps__control--bare"><Glyph name="menu" /><span className="sr-only">{t('homeScreen.safari.menu')}</span></span>;
  const share = control(<Icon name="share" />, 'homeScreen.safari.share');
  const add = control(<Glyph name="add" />, 'homeScreen.safari.add');
  const open = {
    text: then === 'ping' ? say('homeScreen.openPing', { ping: control(<Icon name="bell" />, 'alerts.action.ping') }) : t('homeScreen.openNotifications'),
    picture: <PeekMark size={28} className="home-steps__app" />,
  };
  const steps: { text: ReactNode; picture?: ReactNode }[] = path === 'menu' ? [
    { text: say('homeScreen.menu', { menu }), picture: <SafariBar /> },
    { text: say('homeScreen.share', { share }) },
    { text: say('homeScreen.add', { more: control(<Glyph name="more" />, 'homeScreen.safari.more'), add }) },
    open,
  ] : [
    { text: say('homeScreen.shareMenu', { share }) },
    { text: say('homeScreen.choose', { add }) },
    open,
  ];
  return <ol className={`home-steps${cards ? ' home-steps--cards' : ''}`}>
    {steps.map((step, index) => <li key={index}>
      <span className="home-steps__number">{index + 1}</span>
      <span className="home-steps__text">{step.text}</span>
      {step.picture}
    </li>)}
  </ol>;
}
