/** Read-only, 96-bit invitation IDs; acceptance still requires the fragment token. */
export function isInvitationPreviewId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16}$/.test(value);
}

export function shortInvitationPreviewId(pathname: string): string | null {
  const id = pathname.startsWith('/i/') ? pathname.slice(3) : null;
  return isInvitationPreviewId(id) ? id : null;
}
