import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

// Daily carrier canary reporting for GitHub Actions. Every failed or
// inconclusive live check is listed with its reason in the job summary, and
// failures become the `failures` step output read by the issue job. Outside
// Actions (no GITHUB_STEP_SUMMARY or GITHUB_OUTPUT) nothing is written.

function cell(text) {
  return String(text).replace(/\s+/g, ' ').replace(/\|/g, '\\|').replace(/`/g, "'").trim().slice(0, 240);
}

/**
 * @param {{ title: string, totals: string, rows: { result: 'failed' | 'unverified', check: string, reason: string }[] }} report
 * @param {Record<string, string | undefined>} [env]
 */
export function writeCanaryReport({ title, totals, rows }, env = process.env) {
  if (env.GITHUB_STEP_SUMMARY) {
    let summary = `### ${title}\n\n${totals}\n`;
    if (rows.length) {
      summary += '\n| Result | Check | Reason |\n| --- | --- | --- |\n';
      for (const row of rows) {
        summary += `| ${row.result === 'failed' ? '❌ failed' : '⚠️ unverified'} | ${cell(row.check)} | ${cell(row.reason)} |\n`;
      }
    }
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  const failures = rows.filter((row) => row.result === 'failed');
  if (env.GITHUB_OUTPUT && failures.length) {
    const delimiter = `EOF_${randomUUID()}`;
    const lines = failures.map((row) => `- \`${cell(row.check)}\`: ${cell(row.reason)}`);
    fs.appendFileSync(env.GITHUB_OUTPUT, `failures<<${delimiter}\n${lines.join('\n')}\n${delimiter}\n`);
  }
}

/**
 * Vitest reporter for the live carrier suites. A skip with a note (bot
 * protection, an unsolved challenge) is inconclusive, not a pass, so it is
 * listed; a skip without one is a check gated on private input or a solver.
 */
export default class CanaryReporter {
  /** @param {ReadonlyArray<import('vitest/node').TestModule>} testModules */
  onTestRunEnd(testModules, unhandledErrors) {
    /** @type {{ result: 'failed' | 'unverified', check: string, reason: string }[]} */
    const rows = [];
    let passed = 0;
    let gated = 0;
    const reason = (error) => `${error?.name ?? 'Error'}: ${error?.message ?? 'failed'}`;
    for (const testModule of testModules) {
      for (const error of testModule.errors()) {
        rows.push({ result: 'failed', check: testModule.relativeModuleId, reason: reason(error) });
      }
      for (const test of testModule.children.allTests()) {
        const result = test.result();
        if (result.state === 'passed') passed += 1;
        else if (result.state === 'failed') rows.push({ result: 'failed', check: test.fullName, reason: reason(result.errors?.[0]) });
        else if (result.state === 'skipped' && result.note) rows.push({ result: 'unverified', check: test.fullName, reason: result.note });
        else gated += 1;
      }
    }
    for (const error of unhandledErrors) rows.push({ result: 'failed', check: 'Unhandled error', reason: reason(error) });
    const failed = rows.filter((row) => row.result === 'failed').length;
    writeCanaryReport({
      title: process.env.CANARY_SUMMARY_TITLE || 'Live carrier checks',
      totals: `${passed} passed · ${failed} failed · ${rows.length - failed} unverified · ${gated} not run (need private input or a challenge solver)`,
      rows,
    });
  }
}
