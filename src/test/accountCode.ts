// A test that draws the account's screens at once imports this file: their code is in hand, as on a page that opens on them.
import * as account from '../AccountApplication';
import { accountCode } from '../accountCode';

accountCode.provide(account);
