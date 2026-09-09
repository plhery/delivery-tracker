export const DEFAULT_APPEARANCE = 'light';
export const APPEARANCE_STORAGE_KEY = 'sdt.appearance.v1';
// Runs before first paint; only known preference values reach the DOM.
export const APPEARANCE_BOOTSTRAP = `try{var a=localStorage.getItem('${APPEARANCE_STORAGE_KEY}');document.documentElement.dataset.appearance=a==='dark'||a==='light'||a==='system'?a:'${DEFAULT_APPEARANCE}'}catch(e){document.documentElement.dataset.appearance='${DEFAULT_APPEARANCE}'}`;
