import { holdsSignIn } from './auth/sessionStorage';
import { ENTRY_HINT_ATTRIBUTE } from './lib/entryHintConfig';
import { laterCode } from './lib/laterCode';

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
