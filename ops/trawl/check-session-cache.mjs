// Run with Node or Bun, including inside the private TRAWL container.
// Probe the public tracking landing page; never print bodies, cookies or tokens.
const endpoint = new URL('/scrape', process.env.FLARESOLVERR_URL || 'http://localhost:8191');
for (let run = 1; run <= 3; run++) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: 'https://www.mondialrelay.fr/suivi-de-colis/',
      skipHttp: true,
      maxTier: 3,
      maxTimeout: 45_000,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`TRAWL probe failed: HTTP ${response.status}`);
  const result = await response.json();
  // Upstream timings entries contain full tier results, including cookies.
  const attempts = (result.timings || []).map(({ tier, status, durationMs }) => ({ tier, status, durationMs }));
  console.log(JSON.stringify({ run, tier: result.tier, sessionCached: result.sessionCached,
    totalMs: result.totalMs, statusCode: result.statusCode, attempts }));
  if (result.statusCode !== 200 || ![2, 3].includes(result.tier)) {
    throw new Error('TRAWL did not retrieve the tracking page');
  }
  if (run > 1 && (result.tier !== 2 || !result.sessionCached)) {
    throw new Error('Warm Mondial Relay request did not reuse a cached session');
  }
}
