import { render } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SERVED = 'Peek — Where’s my parcel? Universal Package & Parcel Tracker';
const APP = 'Peek — Universal Parcel Tracker';

let useTabTitle: typeof import('./tabTitle').useTabTitle;

function Screen({ title, after }: { title: string | null; after?: string }) {
  useTabTitle(title, after);
  return null;
}

/** Writes the served title back, as React does when the route's metadata hydrates. */
const hydrateMetadata = () => act(async () => {
  document.querySelector('title')!.firstChild!.nodeValue = SERVED;
  await Promise.resolve();
});

// Each test opens a page of its own: the title the server sent, read as the page loads.
beforeEach(async () => {
  const head = document.createElement('head');
  head.innerHTML = `<title>${SERVED}</title>`;
  document.documentElement.replaceChild(head, document.head);
  vi.resetModules();
  ({ useTabTitle } = await import('./tabTitle'));
});

describe('the tab’s title', () => {
  it('stays the screen’s when the route’s metadata hydrates after it', async () => {
    const view = render(<Screen title="Moon lamp · In transit" after={APP} />);
    view.rerender(<Screen title="Moon lamp · Out for delivery" after={APP} />);
    expect(document.title).toBe('Moon lamp · Out for delivery');
    await hydrateMetadata();
    expect(document.title).toBe('Moon lamp · Out for delivery');
    view.unmount();
    expect(document.title).toBe(APP);
  });

  it('is the app’s once the door gives way to it, metadata or not', async () => {
    const door = render(<Screen title={SERVED} after={APP} />);
    door.unmount();
    expect(document.title).toBe(APP);
    await hydrateMetadata();
    expect(document.title).toBe(APP);
  });

  it('is `after` once a covered screen stops naming it, unless another screen has named it since', () => {
    const door = render(<Screen title={SERVED} after={APP} />);
    door.rerender(<Screen title={null} after={APP} />);
    expect(document.title).toBe(APP);
    door.rerender(<Screen title={SERVED} after={APP} />);
    const page = render(<Screen title="In transit · Peek" after={APP} />);
    door.rerender(<Screen title={null} after={APP} />);
    door.unmount();
    expect(document.title).toBe('In transit · Peek');
    page.unmount();
  });

  it('is left alone by a screen without a title, and by every other renaming', async () => {
    render(<Screen title={null} after={APP} />);
    await hydrateMetadata();
    expect(document.title).toBe(SERVED);
    render(<Screen title="In transit · Peek" />);
    await act(async () => { document.title = 'Peek — Demo'; await Promise.resolve(); });
    expect(document.title).toBe('Peek — Demo');
  });
});
