import { ENTRY_HINT_ATTRIBUTE } from './lib/entryHintConfig';
import { laterCode } from './lib/laterCode';

/** A sign-in saved in this browser, as the entry hint reads it. */
function holdsSignIn(): boolean {
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key && /^sb-.+-auth-token$/.test(key) && localStorage.getItem(key) && localStorage.getItem(`${key}.signed-out`) !== 'true') return true;
    }
  } catch { /* Without storage there is no sign-in to restore. */ }
  return false;
}

/**
 * The screens behind the front door: the deliveries, signing in, an
 * invitation, the demo. A visitor's page comes without their code. A browser
 * about to open on them asks for it at once: the entry hint says so at `/`
 * and at the landing, a saved sign-in at any address.
 */
export const accountCode = laterCode(() => import('./AccountApplication'), () => {
  const hint = document.documentElement.dataset[ENTRY_HINT_ATTRIBUTE];
  return hint === 'app' || hint === 'account' || holdsSignIn();
});
