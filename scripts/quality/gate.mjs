import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { comparison, git, sourceAt, revision } from './git.mjs';
import { readPolicy } from './policy.mjs';
import { budgetChanges, validateLedger } from './baselines.mjs';
import { repositoryFindings } from './analysis.mjs';
import { readCoverage, coverageResults } from './coverage.mjs';
import { checkChangedFunctions } from './gate-source.mjs';
import { checkSites, siteChanges } from './gate-sites.mjs';
export async function runQuality(options) {
  const context = { cwd: process.cwd(), ...options };
  try { return await evaluate(context); }
  catch (error) { return errorReport(context, error); }
}
async function evaluate(context) {
  context.comparison = comparison(context.cwd, context.base, context.head ?? 'HEAD');
  return analyze(checkedContext(context));
}
function checkedContext(context) {
  assertCheckout(context.cwd, context.comparison.head);
  context.policy = readPolicy(resolve(context.cwd, 'quality-policy.json'));
  return context;
}
function errorReport(context, error) {
  return { status: 'error', base: context.comparison?.base ?? context.base, target: context.comparison?.target, head: context.comparison?.head ?? context.head ?? 'HEAD', policy: context.policy, selected: context.changed?.selected, error: error.message, failures: [] };
}
function assertCheckout(cwd, head) {
  if (revision(cwd, 'HEAD') !== head || git(cwd, ['diff', '--name-only', head, '--']).trim()) throw new Error('Check out the specified head and commit tracked changes before comparison');
  if (git(cwd, ['ls-files', '--others', '--exclude-standard']).trim()) throw new Error('Commit or ignore untracked files before comparison');
}
async function analyze(context) {
  context.changed = await checkChangedFunctions(context.comparison, context.policy);
  const baseline = baselineContext(context), results = await repositoryFindings(context.cwd);
  return finish(context, context.changed, baseline, results);
}
function baselineContext(context) {
  const before = baseJson(context, 'quality-sites.json', { version: 1, sites: [] });
  const after = JSON.parse(readFileSync(resolve(context.cwd, 'quality-sites.json'), 'utf8'));
  return siteContext(context, validateLedger(before), validateLedger(after));
}
function siteContext(context, before, after) {
  if (before.revision && before.revision !== after.revision) throw new Error('Site baseline source revision cannot change');
  return { ...context, sites: before.sites, headSites: after.sites, comparison: before.revision ? comparison(context.cwd, before.revision, context.comparison.head) : context.comparison, rollout: isRollout(context) };
}
function finish(context, changed, baseline, results) {
  const budgets = compareBudgets(context, baseline.rollout), sites = siteChanges(baseline.sites, baseline.headSites);
  const coverage = coverageResults(context.policy.coverage, readCoverage(context.cwd, context.policy.coverage));
  return report(context, { ...changed, baselineChanges: [...budgets, ...rolloutSites(sites, baseline)], coverage, findings: checkSites(results, rolloutContext(baseline)) });
}
function report(context, checks) {
  const failures = [...checks.numeric, ...checks.findings, ...checks.baselineChanges.filter(change => change.failure), ...checks.coverage.filter(result => result.failure)];
  return { status: failures.length ? 'failed' : 'passed', base: context.comparison.base, target: context.comparison.target, head: context.comparison.head, policy: context.policy, policyChanged: context.comparison.files.some(file => file.path === 'quality-policy.json'), policyBefore: baseJson(context, 'quality-policy.json', null), ...checks, failures };
}
function compareBudgets(context, rollout) {
  const before = baseJson(context, 'eslint-suppressions.json', {}), after = JSON.parse(readFileSync(resolve(context.cwd, 'eslint-suppressions.json'), 'utf8'));
  return budgetChanges(before, after, context.comparison.files, budgetTrees(context)).map(change => ({ ...change, failure: change.failure && !(rollout && newRules.includes(change.rule)) }));
}
function budgetTrees(context) {
  return { beforePaths: trackedPaths(context.cwd, context.comparison.base), afterPaths: trackedPaths(context.cwd, context.comparison.head) };
}
function trackedPaths(cwd, revision) {
  return new Set(git(cwd, ['ls-tree', '-r', '--name-only', '-z', revision]).split('\0').filter(Boolean));
}
export function baseJson(context, path, fallback) {
  const exists = git(context.cwd, ['ls-tree', '--name-only', context.comparison.base, '--', path]).trim();
  return exists ? JSON.parse(sourceAt(context.cwd, context.comparison.base, path)) : fallback;
}
const newRules = ['complexity', 'max-depth', 'sonarjs/cognitive-complexity', '@typescript-eslint/no-floating-promises', '@typescript-eslint/no-misused-promises', '@typescript-eslint/switch-exhaustiveness-check', 'sonarjs/no-duplicated-branches', 'sonarjs/no-identical-functions', 'sonarjs/no-identical-expressions'];
function isRollout(context) {
  const rollout = JSON.parse(readFileSync(new URL('../../quality-rollout.json', import.meta.url), 'utf8'));
  return context.comparison.base === rollout.base && baseJson(context, 'quality-policy.json', null) === null;
}
function rolloutSites(sites, baseline) {
  return sites.map(site => ({ ...site, failure: site.failure && !baseline.rollout }));
}
function rolloutContext(baseline) {
  return baseline.rollout ? { ...baseline, sites: baseline.headSites } : baseline;
}
