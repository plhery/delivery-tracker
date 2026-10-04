'use client';

import type { ComponentProps } from 'react';
import * as account from './AccountApplication';
import { accountCode } from './accountCode';
import { ClientApplication } from './ClientApplication';

// The pages that open on the account's screens bring their code along: the server draws them with it, and the browser
// has it before the page comes alive.
accountCode.provide(account);

/** The application for an address that opens on the account's screens: the demo's, an invitation's. */
export function AccountClientApplication(props: ComponentProps<typeof ClientApplication>) {
  return <ClientApplication {...props} />;
}
