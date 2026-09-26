import { useLayoutEffect, useRef } from 'react';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

const TABS = [
  { id: 'deliveries', icon: 'parcel', label: 'native.deliveries' },
  { id: 'passport', icon: 'passport', label: 'passport.title' },
  { id: 'friends', icon: 'friends', label: 'friends.title' },
] as const;
export type AppTab = typeof TABS[number]['id'];

export function AppNavigation({ selected, onSelect }: { selected: AppTab; onSelect: (tab: AppTab) => void }) {
  const { t } = useI18n();
  const navigation = useRef<HTMLElement>(null);
  const selection = useRef<HTMLSpanElement>(null);
  const moveSelection = useRef<(animate: boolean) => void>(() => {});

  useLayoutEffect(() => {
    const nav = navigation.current;
    const pill = selection.current;
    if (!nav || !pill) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let animation: Animation | undefined;
    let previous = '';
    const move = (animate: boolean) => {
      const button = nav.querySelector<HTMLButtonElement>('[aria-current="page"]');
      if (!button || !button.offsetWidth || !button.offsetHeight) return;
      const target = {
        transform: `translateX(${button.offsetLeft}px)`,
        width: `${button.offsetWidth}px`,
        top: `${button.offsetTop}px`,
        height: `${button.offsetHeight}px`,
      };
      const key = JSON.stringify(target);
      if (key === previous) return;
      // A second tap continues from the visible edges, even mid-stretch.
      const visible = getComputedStyle(pill);
      const from = { transform: visible.transform, width: visible.width };
      animation?.cancel();
      Object.assign(pill.style, target);
      nav.dataset.selectionReady = 'true';
      if (animate && previous && pill.animate && !reducedMotion?.matches) {
        const left = new DOMMatrixReadOnly(from.transform).m41;
        const right = left + parseFloat(from.width);
        const targetLeft = button.offsetLeft;
        const targetRight = targetLeft + button.offsetWidth;
        const movingRight = targetLeft + targetRight > left + right;
        const stretchLeft = Math.min(left, targetLeft);
        const stretchRight = Math.max(right, targetRight);
        const frame = (l: number, r: number) => ({ transform: `translateX(${l}px)`, width: `${r - l}px` });
        const easing = 'cubic-bezier(.23,1,.32,1)';
        // Lead with one edge, pull the trailing edge through, then relax the
        // small landing squeeze. Animate the width so corners keep their shape.
        animation = pill.animate([
          { ...from, offset: 0, easing },
          { ...frame(stretchLeft, stretchRight), offset: 150 / 610, easing },
          { ...frame(targetLeft + (movingRight ? 3 : 0), targetRight - (movingRight ? 0 : 3)), offset: 450 / 610, easing },
          { ...frame(targetLeft, targetRight), offset: 1 },
        ], {
          id: 'tab-selection-rubber', duration: 610,
        });
      }
      previous = key;
    };
    moveSelection.current = move;
    move(false);
    // Fonts, translations, and the phone/desktop layouts can all resize tabs.
    const resize = () => move(false);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(nav);
    nav.querySelectorAll('button').forEach((button) => observer?.observe(button));
    window.addEventListener('resize', resize);
    const stopMotion = () => { if (reducedMotion?.matches) animation?.cancel(); };
    reducedMotion?.addEventListener('change', stopMotion);
    return () => {
      animation?.cancel();
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      reducedMotion?.removeEventListener('change', stopMotion);
      moveSelection.current = () => {};
    };
  }, []);

  useLayoutEffect(() => { moveSelection.current(true); }, [selected]);

  return <nav ref={navigation} className="app__navigation" aria-label={t('app.title')}>
    <span ref={selection} className="app__navigation-selection" aria-hidden="true" />
    {TABS.map((tab) => <button key={tab.id} type="button" aria-current={selected === tab.id ? 'page' : undefined} onClick={() => onSelect(tab.id)}>
      <Icon name={tab.icon} /><span>{t(tab.label)}</span>
    </button>)}
  </nav>;
}
