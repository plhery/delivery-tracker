import { describe, expect, it } from 'vitest';
import { homeScreenPath } from './homeScreen';

const iphone = (rest: string) => `Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ${rest}`;

describe('the way to “Add to Home Screen”', () => {
  it('goes through the page menu in Safari 27 and later on iPhone', () => {
    expect(homeScreenPath(iphone('Version/27.0 Mobile/15E148 Safari/604.1'))).toBe('menu');
    expect(homeScreenPath(iphone('Version/28.1 Mobile/15E148 Safari/604.1'))).toBe('menu');
  });

  it('goes through a Share button in older Safari', () => {
    expect(homeScreenPath(iphone('Version/26.2 Mobile/15E148 Safari/604.1'))).toBe('share');
    expect(homeScreenPath(iphone('Version/18.0 Mobile/15E148 Safari/604.1'))).toBe('share');
  });

  it('goes through a Share button in other iPhone browsers, in-app pages and on iPad', () => {
    expect(homeScreenPath(iphone('CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1'))).toBe('share');
    expect(homeScreenPath(iphone('Version/27.0 EdgiOS/140.0 Mobile/15E148 Safari/604.1'))).toBe('share');
    expect(homeScreenPath(iphone('FxiOS/143.0 Mobile/15E148 Safari/605.1.15'))).toBe('share');
    expect(homeScreenPath(iphone('Version/27.0 Mobile/15E148'))).toBe('share');
    expect(homeScreenPath('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15')).toBe('share');
  });
});
