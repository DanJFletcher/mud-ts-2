import { relative } from 'node:path';
import { readFileSync } from 'node:fs';
import { siteRecord, siteAllowed } from './baselines.mjs';
import { isMigratedRule } from './analysis.mjs';
import { sourceAt } from './git.mjs';
export function checkSites(results, context) {
  const findings = results.flatMap(result => migratedSites(result, context.cwd));
  return findings.map(finding => assessSite(finding, context)).filter(Boolean);
}
export function migratedSites(result, cwd) {
  const source = readFileSync(result.filePath, 'utf8');
  return result.messages.filter(message => isMigratedRule(message.ruleId)).map(message => siteRecord(relative(cwd, result.filePath), message, source));
}
function assessSite(finding, context) {
  const matches = matchingSites(finding, context);
  if (matches.length === 1) return null;
  return { ...finding, failure: true, message: matches.length > 1 ? 'Ambiguous legacy occurrence; inspect/prune quality-sites.json' : 'New or changed typed/smell finding has no unchanged occurrence allowance' };
}
export function matchingSites(finding, context) {
  const file = context.comparison.files.find(file => file.path === finding.path);
  const before = file?.before ?? sourceAt(context.cwd, context.comparison.base, finding.path);
  return context.sites.filter(site => mappedMatch(site, finding, { file, before, headSites: context.headSites }));
}
function mappedMatch(site, finding, { file, before, headSites }) {
  const remapped = { ...site, path: file?.oldPath === site.path ? file.path : site.path };
  return siteAllowed(remapped, finding, { before, after: file?.after ?? before, hunks: file?.hunks ?? [] }) && headSites.some(headSite => JSON.stringify(headSite) === JSON.stringify(site));
}
export function siteChanges(before, after) {
  const old = new Set(before.map(site => JSON.stringify(site))), current = new Set(after.map(site => JSON.stringify(site)));
  return [...siteDelta(current, old, 'added', true), ...siteDelta(old, current, 'removed', false)];
}
function siteDelta(left, right, change, failure) {
  return [...left].filter(site => !right.has(site)).map(site => ({ ...JSON.parse(site), change, failure, message: `Site baseline allowance ${change}` }));
}
