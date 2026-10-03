// The static privacy document serves its addresses scrambled, so a harvester reading the
// page finds none. This fixed script writes them back; the page's content policy allows
// it by its hash.
export const MAIL_LINK_BOOTSTRAP = `try{document.querySelectorAll('a[data-mail]').forEach(function(a){var h=a.getAttribute('data-mail'),k=parseInt(h.slice(0,2),16),s='';for(var i=2;i<h.length;i+=2)s+=String.fromCharCode(parseInt(h.slice(i,i+2),16)^k);if(s.indexOf('@')>0){a.href='mailto:'+s;a.textContent=s}})}catch(e){}`;

/** An address as the page carries it: a key byte, then each character crossed with it, in hex. */
export function scrambledAddress(address: string): string {
  if (!/^[\x21-\x7e]+@[\x21-\x7e]+$/.test(address)) throw new TypeError('Only a plain ASCII address can be scrambled');
  const codes = Array.from(address, (character) => character.charCodeAt(0));
  const key = codes.reduce((sum, code) => sum + code, 0) % 255 + 1;
  return [key, ...codes.map((code) => code ^ key)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
