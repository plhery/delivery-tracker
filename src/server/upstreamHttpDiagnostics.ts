// Bounded response diagnostics live in the carrier package; this module keeps
// the historical import path for host code.
export { readUpstreamHttpDiagnostics } from '@carriers/core/transport';
export type { UpstreamHttpDiagnostics } from '@carriers/core/transport';
