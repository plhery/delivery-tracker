// Moved to the carrier package; this path stays for host code and the canary.
// Asendia is tracked through the universal providers, so the module lives at
// carriers/asendia/probe.ts rather than adapter.ts: an adapter.ts there would
// make the generated registry dispatch Asendia to it.
export * from '@carriers/carriers/asendia/probe';
