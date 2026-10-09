/**
 * A sign-in saved in this browser, as the entry hint reads it. It reads local
 * storage alone, so a page without the account's code can tell it too.
 */
export function holdsSignIn(): boolean {
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key && /^sb-.+-auth-token$/.test(key) && localStorage.getItem(key) && localStorage.getItem(`${key}.signed-out`) !== 'true') return true;
    }
  } catch { /* Without storage there is no sign-in to restore. */ }
  return false;
}
