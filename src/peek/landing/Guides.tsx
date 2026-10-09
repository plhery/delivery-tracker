import { useId, useRef, useState, type MouseEvent } from 'react';
import { carrierPath } from '../../carriers/paths';
import { GUIDE_LINKS } from '../../generated/guides';
import { guidePath } from '../../guides/paths';
import { useI18n } from '../../i18n';
import { trackAction } from '../../lib/analytics';

/**
 * The foot's way to the guides. It is a link to their page; a plain click
 * opens their list in place instead. The list is in the page from the start,
 * out of sight, so a search engine reads every guide's address on the landing,
 * and the way to the carriers' pages below it.
 */
export function GuidesLink() {
  const { t, locale } = useI18n();
  const list = useRef<HTMLDivElement>(null);
  // Pressing the link while the list is open closes it. A press outside the list has already closed it when the
  // click arrives, so whether it was open is read as the press starts; a click no press started (Enter, a screen
  // reader) reads it as it comes.
  const wasOpen = useRef<boolean | null>(null);
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const links = GUIDE_LINKS[locale];
  if (!links.length) return null;
  const showing = () => list.current?.matches(':popover-open') === true;

  function toggle(event: MouseEvent<HTMLAnchorElement>) {
    const open = wasOpen.current ?? showing();
    wasOpen.current = null;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    // A browser without popovers follows the link to the guides' own page.
    if (!list.current?.showPopover) return;
    event.preventDefault();
    if (open) {
      if (showing()) list.current.hidePopover();
      return;
    }
    list.current.showPopover();
    trackAction('guides-open');
  }

  return <>
    <a href={guidePath(locale)} aria-haspopup="dialog" aria-controls={id} aria-expanded={expanded} onClick={toggle}
      onPointerDown={() => { wasOpen.current = showing(); }} onKeyDown={() => { wasOpen.current = null; }}>{t('guides.title')}</a>
    <div ref={list} id={id} popover="auto" className="landing-guides" role="dialog" aria-labelledby={`${id}-title`}
      onToggle={(event) => setExpanded(event.currentTarget.matches(':popover-open'))}>
      <strong id={`${id}-title`}>{t('guides.heading')}</strong>
      <ul>{links.map(({ id: guide, slug, title }) => <li key={guide}><a href={guidePath(locale, slug)}>{title}</a></li>)}</ul>
      <p className="landing-guides__more">
        <a className="landing-guides__all" href={guidePath(locale)}>{t('guides.all')}</a>
        <a className="landing-guides__all" href={carrierPath(locale)}>{t('carriers.all')}</a>
      </p>
    </div>
  </>;
}
