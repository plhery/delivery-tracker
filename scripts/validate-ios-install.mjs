import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function value(info, key) {
  const result = typeof info[key] === 'string' ? info[key].trim() : '';
  if (!result || result.includes('$(')) throw new Error(`${key} is missing from the built app`);
  return result;
}

function flag(info, key) {
  const result = value(info, key);
  if (result !== 'YES' && result !== 'NO') throw new Error(`${key} must be YES or NO`);
  return result === 'YES';
}

function origin(info, key) {
  let url;
  try { url = new URL(value(info, key)); } catch { throw new Error(`${key} must be a valid HTTPS origin`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${key} must be a valid HTTPS origin`);
  }
}

/** Check the resolved bundle, since an isolated build can lose Local.xcconfig. */
export function validateIosInstall(info) {
  if (!flag(info, 'SDTUseAPI')) throw new Error('SDTUseAPI must be YES for an account-enabled iPhone install');
  origin(info, 'SDTAPIBaseURL');
  origin(info, 'SDTSupabaseURL');
  value(info, 'SDTSupabasePublishableKey');
  const google = flag(info, 'SDTGoogleAuthEnabled');
  const email = flag(info, 'SDTEmailOTPEnabled');
  const apple = info.SDTAppleAuthEnabled == null ? false : flag(info, 'SDTAppleAuthEnabled');
  if (!google && !apple && !email) throw new Error('At least one sign-in method must be enabled');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv[2]) throw new Error('Usage: node scripts/validate-ios-install.mjs APP_PATH');
    const info = JSON.parse(execFileSync('/usr/bin/plutil', [
      '-convert', 'json', '-o', '-', join(process.argv[2], 'Info.plist'),
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    validateIosInstall(info);
    console.log('Built iPhone app has a valid sign-in configuration.');
  } catch (error) {
    // Do not print plutil output: the bundle contains client configuration.
    const message = error?.stdout !== undefined ? 'Could not read the built app Info.plist' : error.message;
    console.error(`iPhone install blocked: ${message}. Check ios/Configuration/Local.xcconfig.`);
    process.exitCode = 1;
  }
}
