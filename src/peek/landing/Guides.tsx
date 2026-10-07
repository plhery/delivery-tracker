import { useId, useRef, type MouseEvent } from 'react';
import { GUIDE_LINKS } from '../../generated/guides';
import { guidePath } from '../../guides/paths';
import { useI18n } from '../../i18n';
import { trackAction } from '../../lib/analytics';

/**
 * The foot's way to the guides. It is a link to their page; a plain click
 * opens their list in place instead. The list is in the page from the start,
 * out of sight, so a search engine reads every guide's address on the landing.
 */
export function GuidesLink() {
  const { t, locale } = useI18n();
  const list = useRef<HTMLDivElement>(null);
  // Pressing the link while the list is open closes it, as any press outside the list does.
  const wasOpen = useRef(false);
  const id = useId();
  const links = GUIDE_LINKS[locale];
  if (!links.length) return null;

  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    // A browser without popovers follows the link to the guides' own page.
    if (!list.current?.showPopover) return;
    event.preventDefault();
    if (wasOpen.current) return;
    list.current.showPopover();
    trackAction('guides-open');
  }

  return <>
    <a href={guidePath(locale)} aria-haspopup="dialog" aria-controls={id} onClick={open}
      onPointerDown={() => { wasOpen.current = list.current?.matches(':popover-open') === true; }}
      onKeyDown={() => { wasOpen.current = false; }}>{t('guides.title')}</a>
    <div ref={list} id={id} popover="auto" className="landing-guides" role="dialog" aria-label={t('guides.title')}>
      <strong>{t('guides.heading')}</strong>
      <ul>{links.map(({ id: guide, slug, title }) => <li key={guide}><a href={guidePath(locale, slug)}>{title}</a></li>)}</ul>
      <a className="landing-guides__all" href={guidePath(locale)}>{t('guides.all')}</a>
    </div>
  </>;
}
