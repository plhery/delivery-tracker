import { ADDRESS_LANGUAGES, languagePath } from './locale';

/**
 * What the browser is about to show at `/` and at the landing's own addresses,
 * told before the first paint.
 *
 * The server draws the landing for everyone: a sign-in lives in this browser's
 * storage, where the server cannot see it. So a script that runs before the
 * page is painted looks there, and marks the document:
 *
 * - `app`: a sign-in is saved or on its way back from a provider, or the demo
 *   or the sign-in step is open. The landing stays out of sight, and the
 *   deliveries, the demo or the sign-in step take its place once the page is live.
 * - `account`: at one of the landing's own addresses, a sign-in is saved. The landing
 *   shows there to anyone, so only its "Sign in" waits out of sight.
 * - `device`: a visitor with parcels on this device. The first screen is
 *   theirs, so what a first visit shows waits out of sight.
 *
 * The mark is a hint for the stylesheet only. The page removes it once it
 * knows for itself (`useEntryHint`).
 */
export type EntryHint = 'app' | 'account' | 'device';
export const ENTRY_HINT_ATTRIBUTE = 'entry';
/** The landing's own addresses, as the page's own routing names them: `/home`, and one per language. */
export const ENTRY_HINT_LANDING_PATHS = ['/home', ...ADDRESS_LANGUAGES.map(languagePath)];
const landingPaths = ENTRY_HINT_LANDING_PATHS.map((path) => path.slice(1)).join('|');
/** The names the page's own stores use; this file has no React in it, so the server can read it too. */
export const ENTRY_HINT_KEYS = { experience: 'sdt.web.experience.v1', deviceParcels: 'sdt.peek.parcels.v1' }; // gitleaks:allow -- public localStorage names

// Runs before first paint, as a fixed text the page's security policy names by its hash. Only the known values reach the DOM.
export const ENTRY_HINT_BOOTSTRAP = `try{var p=location.pathname,r=p==='/';if(r||/^\\/(?:${landingPaths})$/.test(p)){var s=localStorage,e=s.getItem('${ENTRY_HINT_KEYS.experience}'),h='',i,k;if(r&&(e==='demo'||sessionStorage.getItem('${ENTRY_HINT_KEYS.experience}')==='sign-in'||/[?&](code|error)=/.test(location.search)||/(access_token|error)=/.test(location.hash)))h='app';for(i=0;!h&&i<s.length;i++){k=s.key(i);if(/^sb-.+-auth-token$/.test(k)&&s.getItem(k)&&s.getItem(k+'.signed-out')!=='true')h=r?'app':'account'}if(!h){k=s.getItem('${ENTRY_HINT_KEYS.deviceParcels}');if(k&&k.charAt(0)==='['&&k.length>2)h='device'}if(h)document.documentElement.dataset.${ENTRY_HINT_ATTRIBUTE}=h}}catch(e){}`;
