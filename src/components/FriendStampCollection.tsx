import { useEffect, useId, useState } from 'react';
import type { ApiFriendCard, ApiFriendStamp } from '../generated/apiContract';
import { useI18n } from '../i18n';
import { friendStamps } from '../lib/friends';
import { Icon } from './Icon';

/** Friends only exposes these shared milestones; never infer private tracking history. */
export function FriendStampCollection({ stats }: { stats: NonNullable<ApiFriendCard['stats']> }) {
  const { t } = useI18n();
  const prefix = useId();
  const [showAll, setShowAll] = useState(false);
  const collection = Object.keys(friendStamps) as ApiFriendStamp[];
  const upcoming = collection.filter((key) => !stats.stamps.includes(key)).slice(0, 3);
  const visible = showAll ? collection : collection.filter((key) => stats.stamps.includes(key) || upcoming.includes(key));
  const hasMore = collection.some((key) => !stats.stamps.includes(key) && !upcoming.includes(key));
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    const dismiss = (event: Event) => {
      if (!expanded) return;
      const bubble = document.getElementById(expanded);
      if (event.target instanceof Node && bubble?.contains(event.target)) return;
      if (bubble?.matches(':popover-open')) bubble.hidePopover();
    };
    window.addEventListener('resize', dismiss); window.addEventListener('scroll', dismiss, true);
    return () => { window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', dismiss, true); };
  }, [expanded]);
  return <section className="passport-stamps friend-stamps"><h2>{t('passport.stamps')}</h2><div className="passport-stamps__grid" id={`${prefix}-collection`}>{visible.map((key) => {
    const stamp = friendStamps[key], earned = stats.stamps.includes(key), id = `${prefix}-${key}`;
    const progress = earned ? '' : key === 'first' || key === 'ten' || key === 'theRegular' ? `${Math.min(stats.deliveredCount, key === 'first' ? 1 : key === 'ten' ? 10 : 25)} / ${key === 'first' ? 1 : key === 'ten' ? 10 : 25}` : key === 'express' ? t('passport.underTwoDays') : '';
    return <div key={key}><button type="button" className={`stamp-card tone-${stamp.tone}${earned ? ' stamp-card--earned' : ''}`} aria-label={[t(stamp.title), progress].filter(Boolean).join(', ')} popoverTarget={id} aria-haspopup="dialog" aria-expanded={expanded === id} aria-controls={id}>
      <span className={`passport-seal${earned ? '' : ' passport-seal--locked'}`} aria-hidden="true"><span className="passport-seal__frame">{stamp.icon === 'stamp' ? <span className="passport-seal__ten">{stamp.numeral ?? '10'}</span> : <Icon name={stamp.icon} />}</span></span><span>{t(stamp.title)}</span>
    </button><div id={id} className="passport-bubble" popover="auto" role="dialog" tabIndex={-1} aria-labelledby={`${id}-title`} onToggle={(event) => {
      const bubble = event.currentTarget, open = bubble.matches(':popover-open');
      setExpanded((current) => open ? id : current === id ? null : current);
      if (!open) { delete bubble.dataset.positioned; return; }
      const anchor = document.querySelector(`[popovertarget="${CSS.escape(id)}"]`);
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect(), { width, height } = bubble.getBoundingClientRect();
      const below = rect.bottom + 10, top = below + height <= innerHeight - 12 ? below : rect.top - height - 10;
      bubble.style.left = `${Math.max(12, Math.min(innerWidth - width - 12, rect.left + rect.width / 2 - width / 2))}px`;
      bubble.style.top = `${Math.max(12, Math.min(innerHeight - height - 12, top))}px`;
      bubble.dataset.positioned = 'true'; bubble.focus({ preventScroll: true });
    }}><h3 id={`${id}-title`}>{t(stamp.title)}</h3><p>{t(stamp.explanation)}{progress && `\n${progress}`}</p></div></div>;
  })}</div>{hasMore && <button type="button" className="passport-collection-toggle" aria-expanded={showAll} aria-controls={`${prefix}-collection`} onClick={() => setShowAll((value) => !value)}>{t(showAll ? 'passport.showLess' : 'passport.showAll')}</button>}</section>;
}
