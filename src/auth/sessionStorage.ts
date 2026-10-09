import { browserStorage } from '../store/apiRepo';

/** A local logout must survive an offline/expired-token SDK refresh and reloads. */
export class SessionStorage {
  private readonly memory = new Map<string, string>();
  private signedOut = false;

  constructor(readonly key: string, private readonly storage: Storage | null = browserStorage()) {}

  private read(key: string): string | null {
    try { return this.storage?.getItem(key) ?? this.memory.get(key) ?? null; }
    catch { return this.memory.get(key) ?? null; }
  }

  get blocked(): boolean {
    return this.signedOut || this.read(`${this.key}.signed-out`) === 'true';
  }

  getItem(key: string): string | null { return this.blocked ? null : this.read(key); }

  setItem(key: string, value: string): void {
    if (this.blocked) return;
    this.memory.set(key, value);
    try { this.storage?.setItem(key, value); } catch { /* Use memory when storage is unavailable. */ }
  }

  removeItem(key: string): void {
    this.memory.delete(key);
    try { this.storage?.removeItem(key); } catch { /* Storage may be unavailable. */ }
  }

  signOut(): void {
    this.signedOut = true;
    this.memory.set(`${this.key}.signed-out`, 'true');
    try { this.storage?.setItem(`${this.key}.signed-out`, 'true'); } catch { /* Retain the in-memory guard. */ }
    for (const suffix of ['', '-user', '-code-verifier']) this.removeItem(`${this.key}${suffix}`);
  }

  allowSignIn(): void {
    this.signedOut = false;
    this.removeItem(`${this.key}.signed-out`);
  }
}
