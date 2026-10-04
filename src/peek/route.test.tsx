import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import {
  leaveParcelLink,
  openLanding,
  useLandingRoute,
  linkNameFromHash,
  linkNameFromLocation,
  linkWordsFromHash,
  openParcelLink,
  parcelLinkIdFromPath,
  parcelLinkPath,
  parcelLinkURL,
  parcelShareURL,
  useParcelLinkRoute,
} from './route';
import { LINK_ID, OTHER_LINK_ID } from '../test/parcelLinks';
import { SAMPLE_LINK_ID } from './sample';

afterEach(() => { history.replaceState(null, '', '/'); });

describe('the parcel page’s address', () => {
  it('reads the link id from /p/<id> and nowhere else', () => {
    expect(parcelLinkIdFromPath(`/p/${LINK_ID}`)).toBe(LINK_ID);
    expect(parcelLinkIdFromPath(`/p/${LINK_ID}/`)).toBe(LINK_ID);
    // A malformed id is still a parcel address: it opens the unavailable page.
    expect(parcelLinkIdFromPath('/p/not-a-link')).toBe('not-a-link');
    expect(parcelLinkIdFromPath('/p/a%20b')).toBe('a b');
    expect(parcelLinkIdFromPath('/p/%E0%A4%A')).toBe('%E0%A4%A');
    for (const path of ['/', '/p', '/p/', `/p/${LINK_ID}/more`, `/i/${LINK_ID}`, `/app/p/${LINK_ID}`]) {
      expect(parcelLinkIdFromPath(path)).toBeNull();
    }
    expect(parcelLinkPath(LINK_ID)).toBe(`/p/${LINK_ID}`);
    expect(parcelLinkURL(LINK_ID, 'https://peek.example')).toBe(`https://peek.example/p/${LINK_ID}`);
  });

  it('gives the sample parcel an address of its own, which no link’s address stands in for', () => {
    expect(parcelLinkIdFromPath('/sample')).toBe(SAMPLE_LINK_ID);
    expect(parcelLinkIdFromPath('/sample/')).toBe(SAMPLE_LINK_ID);
    expect(parcelLinkPath(SAMPLE_LINK_ID)).toBe('/sample');
    expect(parcelLinkURL(SAMPLE_LINK_ID, 'https://peek.example')).toBe('https://peek.example/sample');
    expect(parcelLinkIdFromPath('/sample/more')).toBeNull();
    // A link's address with the sample's id leads nowhere.
    expect(parcelLinkIdFromPath(`/p/${SAMPLE_LINK_ID}`)).toBe('unavailable');
    openParcelLink(SAMPLE_LINK_ID);
    expect(location.pathname).toBe('/sample');
  });

  it('reads the name a link carries after the #, cleaned, and nothing else', () => {
    expect(linkNameFromHash(`#n=${encodeURIComponent('New sneakers 👟')}`)).toBe('New sneakers 👟');
    expect(linkNameFromHash('#n=%20%20Ada%0A%20%20Lovelace%20')).toBe('Ada Lovelace');
    expect([...linkNameFromHash(`#n=${'a'.repeat(200)}`)!]).toHaveLength(80);
    for (const hash of ['', '#', '#n=', '#name=Ada', '#x=1&n=Ada', '#n=%E0%A4%A']) expect(linkNameFromHash(hash)).toBeNull();
    history.replaceState(null, '', `/p/${LINK_ID}#n=For%20Mum`);
    expect(linkNameFromLocation()).toBe('For Mum');
  });

  it('reads a gift’s note and who it is from beside the name, each cleaned, and nothing from a # that is not a link’s', () => {
    const hash = `#n=${encodeURIComponent('trail running shoes')}&g=${encodeURIComponent('Happy birthday, Alex! 50% & more')}&f=Sam`;
    expect(linkWordsFromHash(hash)).toEqual({ name: 'trail running shoes', note: 'Happy birthday, Alex! 50% & more', from: 'Sam' });
    expect(linkWordsFromHash('#g=Just%20a%20note')).toEqual({ name: null, note: 'Just a note', from: null });
    expect(linkNameFromHash(hash)).toBe('trail running shoes');
    // A note is one line of at most 280 characters, a signature of 60.
    expect([...linkWordsFromHash(`#g=${'a'.repeat(400)}&f=${'b'.repeat(90)}`).note!]).toHaveLength(280);
    expect([...linkWordsFromHash(`#f=${'b'.repeat(90)}`).from!]).toHaveLength(60);
    expect(linkWordsFromHash('#g=line%0Aone%09two')).toMatchObject({ note: 'line one two' });
    // One unreadable part leaves the others; a part that is not a link's makes the whole # someone else's.
    expect(linkWordsFromHash('#n=Ada&g=%E0%A4%A')).toEqual({ name: 'Ada', note: null, from: null });
    for (const foreign of ['#section', '#n=Ada&utm=1', '#n=Ada&', '#x', '']) {
      expect(linkWordsFromHash(foreign)).toEqual({ name: null, note: null, from: null });
    }
  });

  it('writes only a public name into the URL, never a gift message or signature', () => {
    const origin = 'https://peek.example';
    expect(parcelShareURL(LINK_ID, {}, origin)).toBe(`${origin}/p/${LINK_ID}`);
    expect(parcelShareURL(LINK_ID, { name: null, note: '  ', from: '' }, origin)).toBe(`${origin}/p/${LINK_ID}`);
    const address = parcelShareURL(LINK_ID, { name: ' New sneakers 👟 ', note: 'Happy birthday, Alex! 50% & more #1', from: 'Sam' }, origin);
    expect(address).toBe(`${origin}/p/${LINK_ID}#n=New%20sneakers%20%F0%9F%91%9F`);
    // What is written is what is read back, and no server sees it: it all stands after the #.
    expect(linkWordsFromHash(new URL(address).hash)).toEqual({ name: 'New sneakers 👟', note: null, from: null });
    expect(new URL(address).pathname + new URL(address).search).toBe(`/p/${LINK_ID}`);
    expect(parcelShareURL(LINK_ID, { from: 'Sam' }, origin)).toBe(`${origin}/p/${LINK_ID}`);
  });

  it('follows the address: opening pushes, back and forward work, leaving returns to the door', async () => {
    const { result } = renderHook(() => useParcelLinkRoute());
    expect(result.current).toBeNull();
    const entries = history.length;
    act(() => openParcelLink(LINK_ID));
    expect(result.current).toBe(LINK_ID);
    expect(location.pathname).toBe(`/p/${LINK_ID}`);
    expect(history.length).toBe(entries + 1);

    act(() => openParcelLink(OTHER_LINK_ID, { replace: true }));
    expect(result.current).toBe(OTHER_LINK_ID);
    expect(history.length).toBe(entries + 1);

    const moved = () => new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
    let waiting = moved();
    history.back();
    await act(() => waiting);
    expect(result.current).toBeNull();
    waiting = moved();
    history.forward();
    await act(() => waiting);
    expect(result.current).toBe(OTHER_LINK_ID);

    act(() => leaveParcelLink());
    expect(result.current).toBeNull();
    expect(location.pathname).toBe('/');
    act(() => openParcelLink(LINK_ID));
    act(() => leaveParcelLink('/?parcel=p1'));
    expect(location.pathname + location.search).toBe('/?parcel=p1');
    expect(result.current).toBeNull();
  });

  it('opens with the address already in place, keeping its name', () => {
    history.replaceState(null, '', `/p/${LINK_ID}#n=Ada`);
    const { result } = renderHook(() => useParcelLinkRoute());
    expect(result.current).toBe(LINK_ID);
    expect(location.hash).toBe('#n=Ada');
  });

  it('renders the server’s link id before the browser has an address', () => {
    function Probe({ id }: { id: string | null }) {
      return <>{useParcelLinkRoute(id) ?? 'door'}</>;
    }
    expect(renderToString(<Probe id={LINK_ID} />)).toContain(LINK_ID);
    expect(renderToString(<Probe id={null} />)).toContain('door');
  });
});

describe('the landing’s own address', () => {
  it('follows the address: opening pushes it, leaving and Back return to where the reader was', () => {
    const { result } = renderHook(() => ({ landing: useLandingRoute(), link: useParcelLinkRoute() }));
    expect(result.current.landing).toBe(false);
    const length = history.length;
    act(() => openLanding());
    expect(location.pathname).toBe('/home');
    expect(history.length).toBe(length + 1);
    expect(result.current).toEqual({ landing: true, link: null });
    // A lookup made there opens the parcel's page, and leaving that page leads to the deliveries.
    act(() => openParcelLink(LINK_ID));
    expect(result.current).toEqual({ landing: false, link: LINK_ID });
    act(() => { history.replaceState(null, '', '/home'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(result.current.landing).toBe(true);
    act(() => leaveParcelLink());
    expect(location.pathname).toBe('/');
    expect(result.current.landing).toBe(false);
  });

  it('renders the server’s address before the browser has one, and is no other address', () => {
    function Probe({ landing }: { landing?: boolean }) { return <>{String(useLandingRoute(landing))}</>; }
    expect(renderToString(<Probe landing />)).toContain('true');
    expect(renderToString(<Probe />)).toContain('false');
    history.replaceState(null, '', '/home/more');
    expect(renderHook(() => useLandingRoute()).result.current).toBe(false);
  });

  it('counts a language’s address as the landing’s own: a lookup opens the parcel, and Back returns', () => {
    history.replaceState(null, '', '/de');
    const { result } = renderHook(() => ({ landing: useLandingRoute(true), link: useParcelLinkRoute() }));
    expect(result.current).toEqual({ landing: true, link: null });
    act(() => openParcelLink(LINK_ID));
    expect(result.current).toEqual({ landing: false, link: LINK_ID });
    act(() => { history.replaceState(null, '', '/de'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(result.current).toEqual({ landing: true, link: null });
    // English has no address of its own: `/en` is not the landing.
    act(() => { history.replaceState(null, '', '/en'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(result.current.landing).toBe(false);
  });
});
