import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  ENFORCED_BY,
  chooseTarget,
  compareVersions,
  continueCommand,
  databaseFacets,
  diffDatabaseFacets,
  gateReport,
  installedRelease,
  matchesOnlyLettersAndDigits,
  parseVersion,
  peerMismatches,
  pinnedVersion,
  retry,
} from './adopt-scraper.mjs';

const postcode = {
  field: 'dpdPostcode',
  validator: 'swissPostcode',
  label: 'Delivery postcode',
  type: 'text',
  pattern: '^[0-9]{4}$',
  maxLength: 4,
};

function release(overrides = {}) {
  return {
    catalog: {
      'swiss-post': {
        displayName: 'Swiss Post',
        color: '#ffcc00',
        tracking: { mode: 'automatic', adapter: 'swiss-post', refresh: { minMinutes: 30 } },
        detectionRules: [{ pattern: '^9[89]\\d{16}$', confidence: 'high' }],
      },
      dpd: {
        displayName: 'DPD',
        color: '#dc0032',
        tracking: { mode: 'automatic', adapter: 'dpd', requirements: [postcode] },
        detectionRules: [{ pattern: '^\\d{14}$', confidence: 'low' }],
      },
      unknown: { displayName: 'Unknown', tracking: { mode: 'link-only', adapter: null }, detectionRules: [] },
    },
    stages: ['pending', 'in_transit', 'delivered'],
    providers: ['Ship24', '17TRACK'],
    ...overrides,
  };
}

function changesBetween(before, after) {
  return diffDatabaseFacets(databaseFacets(before), databaseFacets(after));
}

describe('scraper release versions', () => {
  it('accepts stable releases and prereleases of main', () => {
    assert.deepEqual(parseVersion('0.2.0'), { major: 0, minor: 2, patch: 0, prerelease: null });
    assert.deepEqual(parseVersion('1.10.3-main.12'), { major: 1, minor: 10, patch: 3, prerelease: 12 });
  });

  it('rejects everything else', () => {
    for (const value of [
      '', 'latest', 'v1.2.3', '1.2', '1.2.3.4', '01.2.3', '1.2.3-main', '1.2.3-main.01', '1.2.3-beta.1',
      '1.2.3-main.1.2', '1.2.3+build', ' 1.2.3', '1.2.3\n', '^1.2.3', '1.2.3 && true', '1.2.99999999999999999999',
      undefined, null, 123, ['1.2.3'],
    ]) {
      assert.throws(() => parseVersion(value), TypeError, JSON.stringify(value));
    }
  });

  it('orders releases by semver precedence', () => {
    const ordered = [
      '0.2.0', '0.2.1-main.1', '0.2.1-main.2', '0.2.1-main.10', '0.2.1', '0.3.0-main.1', '0.10.0', '1.0.0',
    ];
    assert.deepEqual([...ordered].reverse().sort(compareVersions), ordered);
    assert.equal(compareVersions('0.3.0-main.4', '0.3.0-main.4'), 0);
    assert.equal(compareVersions('0.3.0', '0.3.0-main.4'), 1);
    assert.equal(compareVersions('0.3.0-main.4', '0.3.0'), -1);
    assert.equal(compareVersions('0.3.0-main.4', '0.2.9'), 1);
  });

  it('reads the exact pin from package.json', () => {
    assert.equal(pinnedVersion({ dependencies: { 'universal-parcel-scraper': '0.2.0' } }), '0.2.0');
    assert.throws(() => pinnedVersion({ dependencies: { 'universal-parcel-scraper': '^0.2.0' } }), /exact release/);
    assert.throws(() => pinnedVersion({ dependencies: {} }), /exact release/);
  });
});

describe('the release to adopt', () => {
  it('adopts a requested release that is newer', () => {
    assert.deepEqual(chooseTarget({ current: '0.2.0', requested: '0.3.0-main.2' }), {
      version: '0.3.0-main.2', adopt: true,
    });
    assert.deepEqual(chooseTarget({ current: '0.3.0-main.2', requested: '0.3.0' }), { version: '0.3.0', adopt: true });
  });

  it('never downgrades and has nothing to adopt on the pinned release', () => {
    assert.equal(chooseTarget({ current: '0.3.0', requested: '0.3.0' }).adopt, false);
    assert.equal(chooseTarget({ current: '0.3.0', requested: '0.2.9' }).adopt, false);
    assert.equal(chooseTarget({ current: '0.3.0', requested: '0.3.0-main.9' }).adopt, false);
    assert.equal(chooseTarget({ current: '0.3.0', distTags: { latest: '0.3.0', next: '0.3.0-main.9' } }).adopt, false);
  });

  it('defaults to the newer of latest and next', () => {
    assert.deepEqual(chooseTarget({ current: '0.2.0', distTags: { latest: '0.2.0', next: '0.3.0-main.1' } }), {
      version: '0.3.0-main.1', adopt: true,
    });
    assert.equal(chooseTarget({ current: '0.2.0', distTags: { latest: '0.3.0', next: '0.3.0-main.7' } }).version, '0.3.0');
    assert.equal(chooseTarget({ current: '0.2.0', distTags: { latest: '0.2.1' } }).version, '0.2.1');
  });

  it('rejects a malformed request, pin or tag', () => {
    assert.throws(() => chooseTarget({ current: '0.2.0', requested: 'next' }), /Not a scraper release version/);
    assert.throws(() => chooseTarget({ current: 'main', requested: '0.3.0' }), /Not a scraper release version/);
    assert.throws(() => chooseTarget({ current: '0.2.0', distTags: { latest: '0.2.0', next: '0.0.0-stage' } }), /as next/);
    assert.throws(() => chooseTarget({ current: '0.2.0', distTags: {} }), /no latest or next/);
  });

  it('takes database_ready only for one named release', () => {
    assert.throws(
      () => chooseTarget({ current: '0.2.0', distTags: { latest: '0.3.0' }, databaseReady: true }),
      /pass -f version=<version>/,
    );
    assert.deepEqual(chooseTarget({ current: '0.2.0', requested: '0.3.0', databaseReady: true }), {
      version: '0.3.0', adopt: true,
    });
  });
});

describe('what the database enforces', () => {
  it('projects carriers, inputs, wider numbers, stages and providers', () => {
    assert.deepEqual(databaseFacets(release()), {
      carriers: ['dpd', 'swiss-post', 'unknown'],
      inputs: ['dpd: dpdPostcode, validator swissPostcode, required, pattern ^[0-9]{4}$'],
      numberShapes: [],
      forcedCarriers: [],
      stages: ['delivered', 'in_transit', 'pending'],
      providers: ['17TRACK', 'Ship24'],
    });
  });

  it('ignores what the database does not know', () => {
    const after = release();
    after.catalog.dpd = {
      ...after.catalog.dpd,
      displayName: 'DPD Switzerland',
      color: '#000000',
      trackingUrlTemplate: 'https://carrier.example/{trackingNumber}',
      tracking: {
        ...after.catalog.dpd.tracking,
        refresh: { minMinutes: 5 },
        requirements: [{ ...postcode, label: 'Postcode', help: 'Four digits.', maxLength: 5 }],
      },
      detectionRules: [{ pattern: '^0\\d{13}$', confidence: 'high' }, { pattern: '^(?=.{14}$)[A-Z]{2}\\d+$', confidence: 'low' }],
    };
    after.stages.reverse();
    after.providers.reverse();
    assert.deepEqual(changesBetween(release(), after), []);
  });

  it('reports new and removed carriers', () => {
    const after = release();
    after.catalog['example-post'] = { tracking: { mode: 'automatic', adapter: 'universal' }, detectionRules: [] };
    delete after.catalog['swiss-post'];
    assert.deepEqual(changesBetween(release(), after), [
      { facet: 'carriers', added: ['example-post'], removed: ['swiss-post'] },
    ]);
  });

  it('reports an input that becomes optional, moves to another field or is new', () => {
    const optional = release();
    optional.catalog.dpd.tracking.requirements = [{ ...postcode, optional: true }];
    assert.deepEqual(changesBetween(release(), optional), [{
      facet: 'inputs',
      added: ['dpd: dpdPostcode, validator swissPostcode, optional, pattern ^[0-9]{4}$'],
      removed: ['dpd: dpdPostcode, validator swissPostcode, required, pattern ^[0-9]{4}$'],
    }]);

    const renamed = release();
    renamed.catalog.dpd.tracking.requirements = [{ ...postcode, field: 'postcode' }];
    assert.deepEqual(changesBetween(release(), renamed)[0].added, [
      'dpd: postcode, validator swissPostcode, required, pattern ^[0-9]{4}$',
    ]);

    const conditional = release();
    conditional.catalog['swiss-post'].tracking.requirements = [{
      field: 'trackingUrl', validator: 'planzerSharedUrl', whenTrackingNumber: '^99990\\d{8}$', type: 'url',
    }];
    assert.deepEqual(changesBetween(release(), conditional), [{
      facet: 'inputs',
      added: ['swiss-post: trackingUrl, validator planzerSharedUrl, required, for numbers matching ^99990\\d{8}$'],
      removed: [],
    }]);
  });

  it('reports stages and providers the database has never seen', () => {
    const after = release({ stages: ['pending', 'in_transit', 'delivered', 'lost'], providers: ['Ship24', 'Example'] });
    assert.deepEqual(changesBetween(release(), after), [
      { facet: 'stages', added: ['lost'], removed: [] },
      { facet: 'providers', added: ['Example'], removed: ['17TRACK'] },
    ]);
  });

  it('reports a tracking number that is more than letters and digits', () => {
    const after = release();
    after.catalog.dpd.detectionRules = [{ pattern: '^\\d{4}/\\d{8}$', confidence: 'high' }];
    assert.deepEqual(changesBetween(release(), after), [
      { facet: 'numberShapes', added: ['dpd: ^\\d{4}/\\d{8}$'], removed: [] },
    ]);
  });

  it('reports a changed number shape of a carrier the database recognises by number', () => {
    const quickpac = (pattern, confidence = 'high') => {
      const result = release();
      result.catalog.quickpac = {
        tracking: { mode: 'automatic', adapter: 'planzer' },
        detectionRules: [{ pattern, confidence }],
      };
      return result;
    };
    assert.deepEqual(databaseFacets(quickpac('^44\\d{16}$')).forcedCarriers, ['quickpac: ^44\\d{16}$']);
    assert.deepEqual(changesBetween(quickpac('^44\\d{16}$'), quickpac('^45\\d{18}$')), [
      { facet: 'forcedCarriers', added: ['quickpac: ^45\\d{18}$'], removed: ['quickpac: ^44\\d{16}$'] },
    ]);
    assert.deepEqual(changesBetween(quickpac('^44\\d{16}$'), quickpac('^44\\d{16}$', 'low')), [
      { facet: 'forcedCarriers', added: [], removed: ['quickpac: ^44\\d{16}$'] },
    ]);
  });

  it('tells plain detection patterns from wider ones', () => {
    for (const pattern of [
      '^9[89]\\d{16}$',
      '^[A-Z]{2}\\d{9}CH$',
      '^(JJD|JVGL)[A-Z0-9]{8,}$',
      '^(?=.{13}$|.{15}$)3S[A-Z]{1,4}\\d+$',
      '^(?:(?=[A-Z0-9]{8}$)(?=.*[A-Z])(?=.*\\d)[A-Z0-9]{8}|\\d{11})$',
      '^06(?:0[6-9]|1\\d)\\d{10}$',
      '^(?!(?:PZ|XU|XW))[A-Z]{2}\\d{9}(?!CH$|FR$)[A-Z]{2}$',
      '^(?![^A-Z])(?!.*[/_a-z])[A-Z]{3}\\d{9}$',
    ]) {
      assert.equal(matchesOnlyLettersAndDigits(pattern), true, pattern);
    }
    for (const pattern of [
      '^\\d{4}/\\d{8}$', '^AB.{8}$', '^\\w{12}$', '^[^0-9]{4}\\d{8}$', '^[a-z]{2}\\d{9}$', '^\\d{4}_\\d{4}$',
      '^(?![(])/\\d+$', '^(?=(?:AB|CD)\\d)\\S{12}$', '^(?<=A)\\d{8}$', '^[A-Z]{2,x}$',
    ]) {
      assert.equal(matchesOnlyLettersAndDigits(pattern), false, pattern);
    }
  });

  it('names constraints and functions that exist in the migrations', () => {
    const migrations = path.resolve(import.meta.dirname, '..', 'supabase', 'migrations');
    const sql = readdirSync(migrations).map((name) => readFileSync(path.join(migrations, name), 'utf8')).join('\n');
    for (const name of Object.values(ENFORCED_BY).flat()) {
      assert.ok(sql.includes(name), `${name} is not in supabase/migrations`);
    }
  });

  it('projects the installed release', async () => {
    const { version, facets } = await installedRelease();
    parseVersion(version);
    assert.ok(facets.carriers.includes('unknown'));
    assert.ok(facets.stages.includes('delivered'));
    assert.ok(facets.providers.length > 0);
    assert.deepEqual(diffDatabaseFacets(facets, facets), []);
  });
});

describe('the database gate report', () => {
  const changes = [
    { facet: 'carriers', added: ['example-post'], removed: [] },
    { facet: 'stages', added: ['lost'], removed: ['returned'] },
  ];

  it('names every change, what enforces it and how to continue', () => {
    const report = gateReport({ from: '0.2.0', to: '0.3.0-main.4', changes, databaseReady: false });
    assert.match(report, /^### Blocked: Universal Parcel Scraper 0\.3\.0-main\.4/);
    assert.match(report, /Compared with 0\.2\.0:/);
    assert.match(report, /\*\*Carrier ids\*\* \(`packages_carrier_check`, `create_owned_package`, `change_owned_package_carrier`\)/);
    assert.match(report, /- added: `example-post`/);
    assert.match(report, /- added: `lost`\n- removed: `returned`/);
    assert.match(report, /`set_owned_notification_preferences`\)/);
    assert.match(report, /notification_preferences\.enabled_stages/);
    assert.match(report, /contracts\/openapi\.json/);
    assert.ok(report.includes('gh workflow run adopt-scraper.yml -f version=0.3.0-main.4 -f database_ready=true'));
    assert.equal(continueCommand('1.2.3'), 'gh workflow run adopt-scraper.yml -f version=1.2.3 -f database_ready=true');
  });

  it('only reports once the database is ready', () => {
    const report = gateReport({ from: '0.2.0', to: '0.3.0', changes, databaseReady: true });
    assert.doesNotMatch(report, /Blocked|gh workflow run/);
    assert.match(report, /confirmed as applied/);
    assert.match(report, /- added: `example-post`/);
  });

  it('says so when nothing changed', () => {
    assert.equal(
      gateReport({ from: '0.2.0', to: '0.2.1', changes: [], databaseReady: false }),
      'Universal Parcel Scraper 0.2.1 changes nothing the database enforces, compared with 0.2.0.',
    );
  });
});

describe('peer pins', () => {
  it('reports an exact peer version the app does not have', () => {
    const peers = { 'playwright-core': '1.64.0', sharp: '0.35.5', 'onnxruntime-web': '^1.30.0', absent: '2.0.0' };
    const installed = { 'playwright-core': '1.63.0', sharp: '0.35.5', 'onnxruntime-web': '1.29.0' };
    assert.deepEqual(peerMismatches(peers, installed), [
      { name: 'playwright-core', expected: '1.64.0', installed: '1.63.0' },
    ]);
    assert.deepEqual(peerMismatches(undefined, installed), []);
  });
});

describe('waiting for the registry', () => {
  it('retries until the release is served', async () => {
    const pauses = [];
    let calls = 0;
    const result = await retry(async () => {
      calls += 1;
      if (calls < 3) throw new Error('not served yet');
      return 'served';
    }, { attempts: 5, pauseMs: 10, pause: async (ms) => { pauses.push(ms); } });
    assert.equal(result, 'served');
    assert.deepEqual(pauses, [10, 10]);
  });

  it('gives up with the last failure', async () => {
    let calls = 0;
    await assert.rejects(retry(async () => {
      calls += 1;
      throw new Error(`attempt ${calls}`);
    }, { attempts: 3, pauseMs: 0, pause: async () => {} }), /attempt 3/);
    assert.equal(calls, 3);
  });
});
