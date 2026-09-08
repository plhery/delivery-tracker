/** Random 96-bit invitation keys, shared as /i/<id> without a fragment. */
export function isInvitationPreviewId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16}$/.test(value);
}

export function shortInvitationPreviewId(pathname: string): string | null {
  const id = pathname.startsWith('/i/') ? pathname.slice(3) : null;
  return isInvitationPreviewId(id) ? id : null;
}

/** Accept existing fragment tokens as well as standalone short invitation keys. */
export function isInvitationCode(value: unknown): value is string {
  return isInvitationPreviewId(value) || (typeof value === 'string' && /^[a-f0-9]{32}$/.test(value));
}
