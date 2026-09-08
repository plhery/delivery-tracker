import { trackScreen } from '../lib/analytics';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';
import { LanguageControl, useI18n } from '../i18n';
import { bindArrivalMotion } from '../lib/arrivalMotion';
import type { EntryScreen } from '../lib/experience';
import { Icon, ParcelIllustration } from './Icon';
import { SignInScreen } from './SignInScreen';

const subscribeToHydration = () => () => undefined;
const clientReady = () => true;
const serverReady = () => false;

export function ArrivalScreen({ screen, onNavigate, invitation, ...signIn }: ComponentProps<typeof SignInScreen> & {
  screen: Exclude<EntryScreen, 'demo'>;
  onNavigate: (screen: EntryScreen) => void;
  invitation?: { title: ReactNode; canOpen: boolean; notice?: ReactNode; afterOpen?: ReactNode; onDismiss: () => void; appURL?: string; received?: boolean };
}) {
  const { t } = useI18n();
  useEffect(() => { trackScreen(invitation ? 'invitation' : screen, 'anonymous'); }, [screen, invitation]);
  const ready = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [opening, setOpening] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const welcome = screen === 'welcome';
  const signInPanel = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!welcome || !invitation || typeof ResizeObserver === 'undefined') return;
    const root = scene.current;
    const stage = root?.querySelector('.arrival__scene');
    const space = root?.querySelector('.arrival__parcel-space');
    const parcel = root?.querySelector<HTMLElement>('.arrival__parcel');
    if (!root || !stage || !space || !parcel) return;
    const position = () => {
      const slot = space.getBoundingClientRect();
      root.style.setProperty('--invite-parcel-top', `${slot.top - stage.getBoundingClientRect().top + (slot.height - parcel.offsetHeight) / 2}px`);
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(stage); observer.observe(parcel);
    return () => observer.disconnect();
  }, [welcome, invitation]);
  useEffect(() => {
    if (welcome && !opening && scene.current) return bindArrivalMotion(scene.current);
  }, [welcome, opening]);
  useEffect(() => {
    if (screen === 'sign-in' && opening) signInPanel.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }, [screen, opening]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function unwrap() {
    if (opening) return;
    const paper = scene.current?.querySelector('.parcel-illustration__body');
    if (paper) scene.current?.style.setProperty('--parcel-rest', getComputedStyle(paper).transform);
    setOpening(true);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    timer.current = setTimeout(() => onNavigate('sign-in'), reduced ? 80 : 960);
  }

  return <main ref={scene} className={`arrival arrival--${screen}${opening ? ' arrival--opening' : ''}${invitation ? ' arrival--invitation' : ''}${invitation?.received ? ' arrival--received' : ''}`}>
    <header className="arrival__header">
      {welcome ? invitation ? <button className="text-button arrival__back" type="button" aria-label={t('common.close')} onClick={invitation.onDismiss}><Icon name="close" /></button> : <span className="arrival__brand"><Icon name="parcel" />{t('app.title')}</span> :
        <button className="text-button arrival__back" type="button" disabled={invitation?.received} onClick={() => { setOpening(false); onNavigate('welcome'); }}><Icon name="back" />{t('welcome.back')}</button>}
      {invitation?.appURL && <a className="arrival__app-link" href={invitation.appURL}>{t('friends.openInApp')}</a>}
      <LanguageControl />
    </header>
    <div className="arrival__scene">
      <div className="arrival__parcel"><div className="arrival__ground" /><div className="arrival__tilt"><div className="arrival__press"><ParcelIllustration /></div></div>
        {invitation?.received && <div className="friendship-receipt" aria-hidden="true"><span className="postage-stamp"><span className="postage-stamp__print"><Icon name="friends" /><Icon name="check" /></span></span></div>}
      </div>
      {welcome ? <div className="arrival__welcome">
        <h1>{invitation?.title ?? t('arrival.welcomeTitle')}</h1>
        <button type="button" className="arrival__open" onClick={unwrap} disabled={!ready || opening || (invitation && !invitation.canOpen)} aria-describedby="parcel-open-hint">
          <span className="arrival__parcel-space" aria-hidden="true" />
          <span>{t('arrival.tapToOpen')}<Icon name="arrow" /></span>
        </button>
        <span className="sr-only" id="parcel-open-hint">{t('arrival.openHint')}</span>
        {invitation?.notice}
      </div> : <div className="arrival__sign-in" ref={signInPanel}>
        {invitation?.afterOpen ?? <SignInScreen {...signIn} />}
        {!invitation && <button type="button" className="text-button arrival__demo" onClick={() => onNavigate('demo')}>{t('welcome.demo')}<Icon name="arrow" /></button>}
      </div>}
    </div>
  </main>;
}
