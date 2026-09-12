// Bounded provider HTTP lives in the carrier package; this module keeps the
// historical import path for host code and adapters not yet moved.
export { fetchBounded, decodeText, parseJsonBytes, UpstreamHttpError, UpstreamNetworkError } from '@carriers/core/transport';
