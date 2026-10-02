import { render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isInstalledApp, MovedHost, movedAddress } from './movedHost';

const replace = vi.fn();
/** The page's display mode, as the browser reports it to a media query. */
function displayMode(mode: string) {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === `(display-mode: ${mode})` })));
}

beforeEach(() => {
  replace.mockClear();
  history.replaceState(null, '', '/?parcel=abc&view=passport#top');
  vi.stubGlobal('location', {
    origin: window.location.origin, pathname: '/', search: '?parcel=abc&view=passport', hash: '#top', replace,
  });
  displayMode('browser');
});
afterEach(() => { vi.unstubAllGlobals(); history.replaceState(null, '', '/'); });

describe('a host the site has left', () => {
  it('sends a browser tab to the same address on the new origin, before anything of the app starts', () => {
    const started = vi.fn();
    function App() { started(); return <p>Deliveries</p>; }
    render(<MovedHost to="https://peek.example.test"><App /></MovedHost>);
    expect(replace).toHaveBeenCalledExactlyOnceWith('https://peek.example.test/?parcel=abc&view=passport#top');
    expect(screen.queryByText('Deliveries')).not.toBeInTheDocument();
    expect(started).not.toHaveBeenCalled();
  });

  it.each(['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay'])('keeps an installed app where it is: %s', (mode) => {
    displayMode(mode);
    expect(isInstalledApp()).toBe(true);
    render(<MovedHost to="https://peek.example.test"><p>Deliveries</p></MovedHost>);
    expect(screen.getByText('Deliveries')).toBeVisible();
    expect(replace).not.toHaveBeenCalled();
  });

  it('keeps an app on the iPhone Home Screen where it is', () => {
    vi.stubGlobal('navigator', { standalone: true });
    expect(isInstalledApp()).toBe(true);
    expect(movedAddress('https://peek.example.test')).toBeNull();
  });

  it('stays when there is nowhere else to go', () => {
    for (const to of [window.location.origin, 'javascript:alert(1)', 'not an origin', '']) {
      expect(movedAddress(to)).toBeNull();
    }
    render(<MovedHost to={window.location.origin}><p>Deliveries</p></MovedHost>);
    expect(screen.getByText('Deliveries')).toBeVisible();
    expect(replace).not.toHaveBeenCalled();
  });

  it('uses only the origin of where the site moved', () => {
    expect(movedAddress('https://peek.example.test/elsewhere?x=1#y')).toBe('https://peek.example.test/?parcel=abc&view=passport#top');
  });

  it('renders nothing on the server: the service worker’s copy of the page decides in the browser', () => {
    expect(renderToString(<MovedHost to="https://peek.example.test"><p>Deliveries</p></MovedHost>)).toBe('');
  });
});
