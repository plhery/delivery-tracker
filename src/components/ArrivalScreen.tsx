import { useEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react';
import { LanguageControl, useI18n } from '../i18n';
import type { EntryScreen } from '../lib/experience';
import { Icon, ParcelIllustration } from './Icon';
import { SignInScreen } from './SignInScreen';

const subscribeToHydration = () => () => undefined;
const clientReady = () => true;
const serverReady = () => false;

export function ArrivalScreen({ screen, onNavigate, ...signIn }: ComponentProps<typeof SignInScreen> & {
  screen: Exclude<EntryScreen, 'demo'>;
  onNavigate: (screen: EntryScreen) => void;
}) {
  const { t } = useI18n();
  const ready = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [opening, setOpening] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const welcome = screen === 'welcome';
  const signInPanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (screen === 'sign-in' && opening) signInPanel.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }, [screen, opening]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function unwrap() {
    if (opening) return;
    setOpening(true);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    timer.current = setTimeout(() => onNavigate('sign-in'), reduced ? 80 : 680);
  }

  return <main className={`arrival arrival--${screen}${opening ? ' arrival--opening' : ''}`}>
    <header className="arrival__header">
      {welcome ? <span className="arrival__brand"><Icon name="parcel" />{t('app.title')}</span> :
        <button className="text-button arrival__back" type="button" onClick={() => { setOpening(false); onNavigate('welcome'); }}><Icon name="back" />{t('welcome.back')}</button>}
      <LanguageControl />
    </header>
    <div className="arrival__scene">
      <div className="arrival__parcel"><ParcelIllustration /></div>
      {welcome ? <div className="arrival__welcome">
        <h1>{t('arrival.welcomeTitle')}</h1>
        <button type="button" className="arrival__open" onClick={unwrap} disabled={!ready || opening} aria-describedby="parcel-open-hint">
          <span className="arrival__parcel-space" aria-hidden="true" />
          <span>{t('arrival.tapToOpen')}<Icon name="arrow" /></span>
        </button>
        <span className="sr-only" id="parcel-open-hint">{t('arrival.openHint')}</span>
      </div> : <div className="arrival__sign-in" ref={signInPanel}>
        <SignInScreen {...signIn} />
        <button type="button" className="text-button arrival__demo" onClick={() => onNavigate('demo')}>{t('welcome.demo')}<Icon name="arrow" /></button>
      </div>}
    </div>
  </main>;
}
