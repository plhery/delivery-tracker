import { describe, expect, it } from 'vitest';
import { MAIL_LINK_BOOTSTRAP, scrambledAddress } from './mailLinkConfig';

describe('scrambled addresses', () => {
  it('serves no address, and the same letters every time', () => {
    const scrambled = scrambledAddress('someone@example.test');
    expect(scrambled).toMatch(/^[0-9a-f]{42}$/);
    expect(scrambled).toBe(scrambledAddress('someone@example.test'));
    expect(Buffer.from(scrambled, 'hex').toString('latin1')).not.toMatch(/someone|example|@/);
  });
  it('refuses what the script could not write back', () => {
    for (const address of ['', 'no-at.example.test', 'spaced out@example.test', 'accentué@example.test'])
      expect(() => scrambledAddress(address)).toThrow(TypeError);
  });
  it('are written back as links by the page script', () => {
    document.body.innerHTML = `<p>Write to <a data-mail="${scrambledAddress('someone@example.test')}">someone at example.test</a> or `
      + `<a data-mail="${scrambledAddress('other+tag@sub.example.test')}">other+tag at sub.example.test</a>, not <a href="https://example.test/">here</a>.</p>`;
    window.eval(MAIL_LINK_BOOTSTRAP);
    const [first, second, untouched] = [...document.querySelectorAll('a')];
    expect(first).toHaveAttribute('href', 'mailto:someone@example.test');
    expect(first).toHaveTextContent('someone@example.test');
    expect(second).toHaveAttribute('href', 'mailto:other+tag@sub.example.test');
    expect(second).toHaveTextContent('other+tag@sub.example.test');
    expect(untouched).toHaveAttribute('href', 'https://example.test/');
    expect(untouched).toHaveTextContent('here');
  });
  it('leaves the readable words when an address is damaged', () => {
    document.body.innerHTML = '<a data-mail="zz">someone at example.test</a>';
    expect(() => window.eval(MAIL_LINK_BOOTSTRAP)).not.toThrow();
    expect(document.querySelector('a')).not.toHaveAttribute('href');
    expect(document.querySelector('a')).toHaveTextContent('someone at example.test');
  });
});
