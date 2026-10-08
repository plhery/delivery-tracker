import { useEffect } from 'react';

/**
 * The page's title as the server sent it. Next writes it again once the route's
 * metadata hydrates, which can be after the screens' first effects have named
 * the tab: that write is undone. Anything else that renames the tab keeps it.
 */
const served = typeof document === 'undefined' ? null : document.title;

/** What the screens last named the tab, and the screen that named it while it is shown. */
let named: { title: string; screen: object | null } | null = null;
let watching = false;

function name(title: string, screen: object | null) {
  named = { title, screen };
  if (document.title !== title) document.title = title;
  if (watching) return;
  watching = true;
  new MutationObserver(() => {
    if (named && named.title !== served && document.title === served) document.title = named.title;
  }).observe(document.head, { childList: true, characterData: true, subtree: true });
}

/**
 * Names the tab while a screen is shown, unless its title is `null`. Once the
 * screen closes or stops naming it, the tab is `after`, if given, unless another
 * screen has named it since.
 */
export function useTabTitle(title: string | null, after?: string): void {
  useEffect(() => {
    if (title === null) return;
    const screen = {};
    name(title, screen);
    return () => {
      if (named?.screen !== screen) return;
      if (after === undefined) named = null;
      else name(after, null);
    };
  }, [title, after]);
}
