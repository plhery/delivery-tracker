// A test that draws a parcel page or the device's parcels at once imports this file: their code is in hand, as on a
// page that opens on them.
import { parcelCode } from '../peek/parcelCode';
import * as screens from '../peek/ParcelScreens';

parcelCode.provide(screens);
