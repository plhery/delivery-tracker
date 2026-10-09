import { useEffect } from 'react';
import type { ApiAuth } from '../lib/apiClient';
import { turnOnDeliveryEmail } from '../store/notificationPreferences';
import { useParcels } from '../store/ParcelsContext';
import type { ParcelRepo } from '../types';
import { keepPendingInDemo, keepPendingParcel } from './pending';

/**
 * Stands inside the deliveries of someone who just signed in: the parcel
 * they asked to keep as a visitor joins the account, and the list reloads
 * with it. Signing in for the delivery email switches it on with the parcel.
 */
export function KeepPendingParcel({ auth }: { auth: ApiAuth }) {
  const { retryLoad } = useParcels();
  useEffect(() => {
    void keepPendingParcel(auth, () => turnOnDeliveryEmail(auth)).then((outcome) => {
      if (outcome?.outcome === 'kept' || outcome?.outcome === 'already') void retryLoad();
    });
  }, [auth, retryLoad]);
  return null;
}

/** The demo's counterpart: entering the demo brings the parcel to keep into the demo deliveries. */
export function KeepPendingInDemo({ repo }: { repo: ParcelRepo }) {
  const { retryLoad } = useParcels();
  useEffect(() => {
    void keepPendingInDemo(repo).then((outcome) => {
      if (outcome?.outcome === 'kept') void retryLoad();
    });
  }, [repo, retryLoad]);
  return null;
}
