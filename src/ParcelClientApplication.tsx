'use client';

import type { ComponentProps } from 'react';
import { ClientApplication } from './ClientApplication';
import { parcelCode } from './peek/parcelCode';
import * as screens from './peek/ParcelScreens';

// A parcel's address brings the parcel page's code along: the server draws the page with it, and the browser has it
// before the page comes alive.
parcelCode.provide(screens);

/** The application for an address that opens on a parcel page. */
export function ParcelClientApplication(props: ComponentProps<typeof ClientApplication>) {
  return <ClientApplication {...props} />;
}
