// The result contract lives in the carrier package; this module keeps the
// historical import path for host code and adapters not yet moved.
export type { CarrierEvent, CarrierResult, CarrierStatus } from '@carriers/core/result';
export { normalizeCarrierResult } from '@carriers/core/result';
