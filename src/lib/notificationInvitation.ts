const DISMISSED_EVENT = 'delivery-tracker:notification-invitation-dismissed';
const keyFor = (userId: string) => `deliveryTrackerNotificationInvitation:${userId}`;

export function notificationInvitationDismissed(userId: string): boolean {
  try {
    return localStorage.getItem(keyFor(userId)) === 'dismissed';
  } catch {
    // Leave Settings available without repeatedly asking when storage is blocked.
    return true;
  }
}

export function dismissNotificationInvitation(userId: string) {
  try {
    localStorage.setItem(keyFor(userId), 'dismissed');
  } catch { /* The mounted popup also remembers its dismissal. */ }
  window.dispatchEvent(new Event(DISMISSED_EVENT));
}

export function subscribeToNotificationInvitation(onChange: () => void) {
  window.addEventListener(DISMISSED_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(DISMISSED_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}
