import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateIosInstall } from './validate-ios-install.mjs';

const configured = Object.freeze({
  SDTUseAPI: 'YES',
  SDTAPIBaseURL: 'https://delivery.example.com',
  SDTSupabaseURL: 'https://supabase.example.com',
  SDTSupabasePublishableKey: 'sb_publishable_test',
  SDTGoogleAuthEnabled: 'YES',
  SDTEmailOTPEnabled: 'YES',
});

describe('built iPhone sign-in configuration', () => {
  it('accepts configured Google and email sign-in, including either provider alone', () => {
    validateIosInstall(configured);
    validateIosInstall({ ...configured, SDTGoogleAuthEnabled: 'NO' });
    validateIosInstall({ ...configured, SDTEmailOTPEnabled: 'NO' });
  });

  it('accepts Apple alone and rejects an invalid Apple flag', () => {
    const apple = { ...configured, SDTGoogleAuthEnabled: 'NO', SDTEmailOTPEnabled: 'NO', SDTAppleAuthEnabled: 'YES' };
    validateIosInstall(apple);
    assert.throws(() => validateIosInstall({ ...apple, SDTAppleAuthEnabled: 'true' }), /YES or NO/);
  });

  it('rejects the demo defaults that replaced the account-enabled iPhone app', () => {
    assert.throws(() => validateIosInstall({
      ...configured, SDTUseAPI: 'NO', SDTSupabaseURL: '', SDTSupabasePublishableKey: '',
    }), /SDTUseAPI/);
  });

  it('rejects missing and unresolved build settings without printing configuration values', () => {
    for (const key of Object.keys(configured)) {
      for (const invalid of ['', undefined, `$(${key})`]) {
        assert.throws(() => validateIosInstall({ ...configured, [key]: invalid }), (error) => {
          assert.match(error.message, new RegExp(key));
          assert.doesNotMatch(error.message, /sb_publishable_test|delivery\.example\.com/);
          return true;
        });
      }
    }
  });

  it('rejects malformed origins and disabled sign-in providers', () => {
    for (const key of ['SDTAPIBaseURL', 'SDTSupabaseURL']) {
      for (const invalid of ['not-a-url', 'https://user:secret@example.com', 'https://example.com/path', 'http://example.com']) {
        assert.throws(() => validateIosInstall({ ...configured, [key]: invalid }), /HTTPS origin/);
      }
    }
    assert.throws(() => validateIosInstall({ ...configured, SDTGoogleAuthEnabled: 'NO', SDTEmailOTPEnabled: 'NO' }), /sign-in method/);
    assert.throws(() => validateIosInstall({ ...configured, SDTGoogleAuthEnabled: 'true' }), /YES or NO/);
  });
});
