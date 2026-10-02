import { trackScreen } from '../lib/analytics';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';
import { LanguageControl, useI18n } from '../i18n';
import { bindArrivalMotion } from '../lib/arrivalMotion';
import type { EntryScreen } from '../lib/experience';
import { InvitationParcelArtwork } from './InvitationParcel';
import { Icon, ParcelIllustration } from './Icon';
import { PeekLockup } from './PeekMark';
import { SignInScreen } from './SignInScreen';
import './Arrival.css';

const subscribeToHydration = () => () => undefined;
const clientReady = () => true;
const serverReady = () => false;

export function ArrivalScreen({ screen, onNavigate, invitation, ...signIn }: ComponentProps<typeof SignInScreen> & {
  screen: Exclude<EntryScreen, 'demo'>;
  onNavigate: (screen: EntryScreen) => void;
  invitation?: { nickname?: string; title: ReactNode; canOpen: boolean; notice?: ReactNode; afterOpen?: ReactNode; onDismiss: () => void; appURL?: string; received?: boolean };
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
    if (screen === 'sign-in') signInPanel.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }, [screen, opening]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // Sign-in reached without the welcome step, from the front door: the box stands closed for a frame, then opens in place.
  const [arrival, setArrival] = useState<'sealed' | 'opening' | 'open'>(() => screen === 'sign-in' && !invitation ? 'sealed' : 'open');
  useEffect(() => {
    if (arrival === 'sealed') {
      // The closed box has to be laid out before its opening can be seen.
      scene.current?.getBoundingClientRect();
      const frame = requestAnimationFrame(() => setArrival('opening'));
      return () => cancelAnimationFrame(frame);
    }
    if (arrival === 'opening') {
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const settle = setTimeout(() => setArrival('open'), reduced ? 80 : 960);
      return () => clearTimeout(settle);
    }
  }, [arrival]);

  function unwrap() {
    if (opening) return;
    const paper = scene.current?.querySelector('.parcel-illustration__body');
    if (paper) scene.current?.style.setProperty('--parcel-rest', getComputedStyle(paper).transform);
    setOpening(true);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    timer.current = setTimeout(() => onNavigate('sign-in'), reduced ? 80 : 960);
  }

  const back = <button className="text-button arrival__back" type="button" disabled={invitation?.received} onClick={() => { setOpening(false); onNavigate('welcome'); }}><Icon name="back" />{t('welcome.back')}</button>;

  return <main ref={scene} className={`arrival arrival--${arrival === 'sealed' ? 'arriving' : screen}${opening || arrival === 'opening' ? ' arrival--opening' : ''}${invitation ? ' arrival--invitation' : ' arrival--onboarding'}${invitation?.received ? ' arrival--received' : ''}${!welcome && invitation?.afterOpen && !invitation.received ? ' arrival--accepting' : ''}`}>
    <header className="arrival__header">
      {/* An invitation is led by its own way out; everywhere else the name stays in place while the step changes beside it. */}
      {!invitation ? <PeekLockup /> : welcome ? <button className="text-button arrival__back" type="button" aria-label={t('common.close')} onClick={invitation.onDismiss}><Icon name="close" /></button> : back}
      {invitation?.appURL && <a className="arrival__app-link" href={invitation.appURL}>{t('friends.openInApp')}</a>}
      {invitation ? <LanguageControl /> : welcome ? <button type="button" className="arrival__shortcut" disabled={!ready || opening} onClick={() => onNavigate('sign-in')}>{t('arrival.signInTitle')}</button> :
        <div className="arrival__actions">{back}<LanguageControl /></div>}
    </header>
    <div className="arrival__scene">
      <div className="arrival__parcel"><div className="arrival__ground" /><div className="arrival__tilt"><div className="arrival__press">{invitation?.nickname ? <InvitationParcelArtwork nickname={invitation.nickname} /> : <ParcelIllustration />}</div></div>
        {invitation?.received && <div className="friendship-receipt" aria-hidden="true"><span className="postage-stamp"><span className="postage-stamp__print"><Icon name="friends" /><Icon name="check" /></span></span></div>}
      </div>
      {welcome ? <div className="arrival__welcome">
        <h1>{invitation?.title ?? t('arrival.welcomeTitle')}</h1>
        {!invitation && <p className="arrival__explanation">{t('arrival.welcomeSubtitle')}</p>}
        {invitation && !invitation.canOpen ? <div className="arrival__parcel-space" aria-hidden="true" /> : <><button type="button" className="arrival__open" onClick={unwrap} disabled={!ready || opening} aria-describedby="parcel-open-hint">
          <span className="arrival__parcel-space" aria-hidden="true" />
          <span>{t('arrival.tapToOpen')}<Icon name="arrow" /></span>
        </button>
        <span className="sr-only" id="parcel-open-hint">{t('arrival.openHint')}</span></>}
        {invitation?.notice}
      </div> : <div className="arrival__sign-in" ref={signInPanel}>
        {invitation?.afterOpen ?? <SignInScreen {...signIn} card={!invitation} />}
        {!invitation?.afterOpen && <button type="button" className="text-button arrival__demo" onClick={() => onNavigate('demo')}>{t('welcome.demo')}<Icon name="arrow" /></button>}
      </div>}
    </div>
  </main>;
}
