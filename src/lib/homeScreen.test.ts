import { describe, expect, it } from 'vitest';
import { homeScreenPath, safariHandoff } from './homeScreen';

const iphone = (rest: string) => `Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ${rest}`;
const PAGE = 'https://peek.example/p/link-id#key';

describe('the way to “Add to Home Screen”', () => {
  it('goes through the page menu in Safari 27 and later on iPhone', () => {
    expect(homeScreenPath(iphone('Version/27.0 Mobile/15E148 Safari/604.1'), false)).toBe('menu');
    expect(homeScreenPath(iphone('Version/28.1 Mobile/15E148 Safari/604.1'), false)).toBe('menu');
  });

  it('goes through a Share button in older Safari', () => {
    expect(homeScreenPath(iphone('Version/26.2 Mobile/15E148 Safari/604.1'), false)).toBe('share');
    expect(homeScreenPath(iphone('Version/18.0 Mobile/15E148 Safari/604.1'), false)).toBe('share');
  });

  it('goes through the Share button of the address bar in Chrome and Firefox', () => {
    expect(homeScreenPath(iphone('CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1'), false)).toBe('bar');
    expect(homeScreenPath(iphone('FxiOS/143.0 Mobile/15E148 Safari/605.1.15'), false)).toBe('bar');
  });

  it('goes through a Share button in other iPhone browsers and on iPad', () => {
    expect(homeScreenPath(iphone('Version/27.0 EdgiOS/140.0 Mobile/15E148 Safari/604.1'), false)).toBe('share');
    expect(homeScreenPath('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15', false)).toBe('share');
  });

  it('goes through Safari first from an app’s own browser', () => {
    // Most leave Safari's token out; Meta's apps and the Google app keep it, but name themselves.
    expect(homeScreenPath(iphone('Mobile/15E148'), false)).toBe('safari');
    expect(homeScreenPath(iphone('Mobile/15E148 [LinkedInApp]/9.31.1'), false)).toBe('safari');
    expect(homeScreenPath(iphone('Mobile/15E148 Instagram 400.0.0.38.95 (iPhone16,2; iOS 18_7; en_US)'), false)).toBe('safari');
    expect(homeScreenPath(iphone('Mobile/15E148 Safari/604.1 [FBAN/FBIOS;FBAV/530.0.0.47.106]'), false)).toBe('safari');
    expect(homeScreenPath(iphone('GSA/390.0.789 Mobile/15E148 Safari/604.1'), false)).toBe('safari');
    expect(homeScreenPath(iphone('Mobile/15E148 Twitter for iPhone/11.20'), false)).toBe('safari');
    // Telegram's says it is Safari, word for word.
    expect(homeScreenPath(iphone('Version/18.0 Mobile/15E148 Safari/604.1'), true)).toBe('safari');
  });
});

describe('the way from an app’s own browser to Safari', () => {
  it('asks Safari for the page by its own address', () => {
    expect(safariHandoff(PAGE, iphone('Mobile/15E148 [LinkedInApp]/9.31.1'))).toEqual({ href: `x-safari-${PAGE}`, window: false });
    expect(safariHandoff('http://localhost:3000/p/link-id', iphone('Mobile/15E148'))).toEqual({ href: 'x-safari-http://localhost:3000/p/link-id', window: false });
  });

  it('opens a window for it in Meta’s apps, which follow no link there', () => {
    expect(safariHandoff(PAGE, iphone('Mobile/15E148 Safari/604.1 [FBAN/FBIOS;FBAV/530.0.0.47.106]'))).toEqual({ href: `x-safari-${PAGE}`, window: true });
    expect(safariHandoff(PAGE, iphone('Mobile/15E148 Barcelona 400.0.0.21.70 (iPhone16,2; iOS 18_7)'))).toEqual({ href: `x-safari-${PAGE}`, window: true });
  });

  it('goes through Instagram’s own way out, which still opens a browser', () => {
    expect(safariHandoff(PAGE, iphone('Mobile/15E148 Instagram 400.0.0.38.95 (iPhone16,2; iOS 18_7; en_US)')))
      .toEqual({ href: `instagram://extbrowser/?url=${encodeURIComponent(PAGE)}`, window: false });
  });

  it('has none in apps that let no page out', () => {
    expect(safariHandoff(PAGE, iphone('Mobile/15E148 Twitter for iPhone/11.20'))).toBeNull();
    expect(safariHandoff(PAGE, iphone('Mobile/15E148 musical_ly_40.0.0 JsSdk/2.0 BytedanceWebview/d8a21c6'))).toBeNull();
    expect(safariHandoff(PAGE, iphone('Mobile/15E148 MicroMessenger/8.0.50(0x1800322d) NetType/WIFI'))).toBeNull();
    expect(safariHandoff(PAGE, iphone('Mobile/15E148 Snapchat/13.20.0.40 (like Safari/8618.1.15.10.15, panda)'))).toBeNull();
  });
});
