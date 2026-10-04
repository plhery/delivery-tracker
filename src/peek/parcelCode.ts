import { ENTRY_HINT_ATTRIBUTE } from '../lib/entryHintConfig';
import { laterCode } from '../lib/laterCode';

/**
 * A parcel's own page and the list of the device's parcels: the maps and
 * sheets a first visit to the landing does not need to come alive. A browser
 * with parcels on the device, which the entry hint marks, asks for them at
 * once; a parcel's address brings them along.
 */
export const parcelCode = laterCode(() => import('./ParcelScreens'), () => document.documentElement.dataset[ENTRY_HINT_ATTRIBUTE] === 'device');
