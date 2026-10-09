import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UNSUBSCRIBE_TOKEN,
  unsubscribeAccount,
  unsubscribePagePath,
  unsubscribeToken,
  unsubscribeUrls,
} from './unsubscribe';

// Synthetic identifiers only.
const alex = '55000000-0000-4000-a000-000000000001';
const other = '55000000-0000-4000-a000-000000000002';

beforeEach(() => { vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key'); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('the token an email carries to switch itself off', () => {
  it('names its account, and only this server can have made it', () => {
    const token = unsubscribeToken(alex);
    expect(token).toMatch(UNSUBSCRIBE_TOKEN);
    expect(token).toHaveLength(66);
    expect(unsubscribeAccount(token)).toBe(alex);
    // The same account always gets the same token: an old email still works.
    expect(unsubscribeToken(alex.toUpperCase())).toBe(token);
    expect(unsubscribeToken(other)).not.toBe(token);
    // It says nothing readable about the account, and it is not the service key's plain signature.
    expect(token).not.toContain(alex);
    expect(token).not.toContain(alex.replaceAll('-', ''));
    const account = Buffer.from(alex.replaceAll('-', ''), 'hex');
    expect(token.split('.')[1]).not.toBe(createHmac('sha256', 'test-service-key').update(account).digest('base64url'));
  });

  it('refuses a token that was changed, cut, swapped or made with another key', () => {
    const token = unsubscribeToken(alex);
    const [id, mac] = token.split('.') as [string, string];
    const [otherId, otherMac] = unsubscribeToken(other).split('.') as [string, string];
    const flipped = (text: string, index: number) => `${text.slice(0, index)}${text[index] === 'A' ? 'B' : 'A'}${text.slice(index + 1)}`;
    for (const forged of [
      `${otherId}.${mac}`, `${id}.${otherMac}`, `${id}.${flipped(mac, 0)}`, `${id}.${flipped(mac, 20)}`,
      `${flipped(id, 3)}.${mac}`, `${id}.${mac.slice(0, -1)}`, `${id}.${mac}A`, `${id}${mac}`, `${mac}.${id}`,
      `${id}.${mac}.${mac}`, `.${mac}`, `${id}.`, `${id}.${'A'.repeat(43)}`, `${token} `, `${token}\n`,
      // Other spellings of the same bytes are not the token.
      `${id}=.${mac}`, `${id}.${mac}=`, `${id.slice(0, -1)}${id.at(-1) === 'A' ? 'B' : 'A'}.${mac}`,
    ]) {
      expect(unsubscribeAccount(forged), forged).toBeNull();
    }
    for (const junk of ['', 'short', 'x'.repeat(201), 'a'.repeat(22), null, undefined, 42, {}, [token]]) {
      expect(unsubscribeAccount(junk)).toBeNull();
    }
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'another-service-key');
    expect(unsubscribeAccount(token)).toBeNull();
    expect(unsubscribeAccount(unsubscribeToken(alex))).toBe(alex);
  });

  it('is neither made nor accepted without the service key', () => {
    const token = unsubscribeToken(alex);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', ' ');
    expect(() => unsubscribeToken(alex)).toThrow('SUPABASE_SERVICE_ROLE_KEY');
    expect(unsubscribeAccount(token)).toBeNull();
    // Nor with a key derived from nothing.
    const account = Buffer.from(alex.replaceAll('-', ''), 'hex');
    const keyless = createHmac('sha256', createHmac('sha256', '').update('delivery-email-unsubscribe').digest()).update(account).digest('base64url');
    expect(unsubscribeAccount(`${account.toString('base64url')}.${keyless}`)).toBeNull();
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
    expect(() => unsubscribeToken('not-an-account')).toThrow('account id');
  });

  it('travels after # to the page, and in the address only where a mail app posts, with the email’s language', () => {
    const token = unsubscribeToken(alex);
    expect(unsubscribeUrls('https://peek.example.com', alex, 'fr')).toEqual({
      page: `https://peek.example.com/email/off?lang=fr#t=${token}`,
      oneClick: `https://peek.example.com/api/email/unsubscribe?t=${token}&lang=fr`,
    });
    expect(unsubscribePagePath(token, 'de')).toBe(`/email/off?lang=de#t=${token}`);
    // As an older email's link, which names no language.
    expect(unsubscribePagePath(token)).toBe(`/email/off#t=${token}`);
    expect(unsubscribePagePath(null)).toBe('/email/off');
    expect(unsubscribePagePath(null, 'it')).toBe('/email/off?lang=it');
    // Nothing in a token needs escaping in an address or a mail header.
    expect(encodeURIComponent(token)).toBe(token);
  });
});
