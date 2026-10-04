/** Browser verification is kept in this tab, never in persistent storage or a parcel link. */
interface Proof { proof: string; expiresAt: number }
interface Turnstile {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  remove(id: string): void;
}
declare global { interface Window { turnstile?: Turnstile } }

export class LookupVerificationError extends Error {
  constructor() { super('Browser verification could not finish. Please try again.'); }
}

let proof: Proof | null = null;
let verify: (() => Promise<string | null>) | null = null;
let script: Promise<void> | null = null;

export function lookupProof(): string | null {
  return proof && proof.expiresAt > Date.now() + 5_000 ? proof.proof : null;
}

export function forgetLookupProof(rejected: string | null): void {
  if (proof?.proof === rejected) proof = null;
}

export async function getLookupProof(signal?: AbortSignal): Promise<string | null> {
  signal?.throwIfAborted();
  if (lookupProof()) return lookupProof();
  if (!verify) throw new LookupVerificationError();
  const pending = verify();
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (script) return script;
  script = new Promise<void>((resolve, reject) => {
    const element = document.createElement('script');
    element.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    element.async = true;
    const nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce;
    if (nonce) element.nonce = nonce;
    const timeout = setTimeout(() => finish(false), 12_000);
    function finish(ok: boolean) {
      clearTimeout(timeout);
      element.onload = element.onerror = null;
      if (ok && window.turnstile) resolve();
      else { element.remove(); reject(new LookupVerificationError()); }
    }
    element.onload = () => finish(true);
    element.onerror = () => finish(false);
    document.head.append(element);
  }).catch((error) => { script = null; throw error; });
  return script;
}

/** The widget stays in the form; Cloudflare shows it only when interaction is needed. */
export function mountLookupVerification(container: HTMLElement, language: string) {
  let disposed = false;
  let widget: string | null = null;
  let pending: Promise<string | null> | null = null;
  let cancel: (() => void) | null = null;

  async function start(): Promise<string | null> {
    if (lookupProof()) return lookupProof();
    const configResponse = await fetch('/api/public/verification', {
      credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(8_000),
    });
    if (!configResponse.ok) throw new LookupVerificationError();
    const configuration = await configResponse.json() as { siteKey?: unknown };
    if (configuration.siteKey === null) return null;
    if (typeof configuration.siteKey !== 'string' || !configuration.siteKey) throw new LookupVerificationError();
    await loadScript();
    if (disposed || !window.turnstile) throw new LookupVerificationError();
    if (widget !== null) window.turnstile.remove(widget);
    return new Promise<string>((resolve, reject) => {
      let finished = false;
      let exchanging = false;
      const timer = setTimeout(() => finish(), 60_000);
      function finish(result?: Proof) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        cancel = null;
        if (result && !disposed) { proof = result; resolve(result.proof); }
        else reject(new LookupVerificationError());
      }
      cancel = () => finish();
      widget = window.turnstile!.render(container, {
        sitekey: configuration.siteKey,
        action: 'parcel_lookup',
        appearance: 'interaction-only',
        theme: 'auto',
        language,
        'response-field': false,
        callback: (token: string) => {
          if (finished || exchanging) return;
          exchanging = true;
          void fetch('/api/public/verification', {
            method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
            signal: AbortSignal.timeout(12_000),
          }).then(async (response) => {
            if (!response.ok) throw new LookupVerificationError();
            const result = await response.json() as Partial<Proof>;
            if (typeof result.proof !== 'string' || typeof result.expiresAt !== 'number' || result.expiresAt <= Date.now()) {
              throw new LookupVerificationError();
            }
            finish(result as Proof);
          }).catch(() => finish());
        },
        'error-callback': () => { finish(); return true; },
        'expired-callback': () => finish(),
        'timeout-callback': () => finish(),
      });
    });
  }

  function run() {
    if (!pending) pending = start().catch(() => { throw new LookupVerificationError(); }).finally(() => { pending = null; });
    return pending;
  }
  verify = run;
  return {
    warm: () => { void run().catch(() => undefined); },
    dispose: () => {
      disposed = true;
      cancel?.();
      if (widget !== null) window.turnstile?.remove(widget);
      if (verify === run) verify = null;
    },
  };
}
