import { mapLine } from './selection.mjs';
import { sourceContext } from './anchors.mjs';
import { importOnlyRename } from './budget-renames.mjs';
export function budgetChanges(before, after, files, trees = {}) {
  const old = remap(before, { files, ...trees });
  return [...new Set([...Object.keys(old), ...Object.keys(after)])].flatMap(path => ruleChanges(path, old[path] ?? {}, after[path] ?? {}));
}
function remap(before, context) {
  return Object.fromEntries(Object.entries(before).map(([path, rules]) => [budgetDestination(path, context), rules]));
}
function budgetDestination(path, context) {
  return context.files.find(file => file.oldPath === path && (file.unchanged || importOnlyRename(file, context)))?.path ?? path;
}
function ruleChanges(path, before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].map(rule => budgetDifference(path, rule, before[rule]?.count ?? 0, after[rule]?.count ?? 0)).filter(Boolean);
}
function budgetDifference(path, rule, before, after) {
  if (!Number.isInteger(after) || after < 0) throw new Error(`Invalid suppression count: ${path} ${rule}`);
  return before === after ? null : { path, rule, before, after, failure: after > before };
}
export function siteAllowed(site, finding, file) {
  return sameOccurrence(site, finding) && mapLine(site.line, file.hunks) === finding.line && unchangedAnchor(site, { finding, ...file });
}
function sameOccurrence(site, finding) {
  return site.rule === finding.rule && site.path === finding.path && site.column === finding.column && site.context === finding.context;
}
function unchangedAnchor(site, { finding, before, after, hunks }) {
  const oldLine = before.split(/\r?\n/)[site.line - 1], newLine = after.split(/\r?\n/)[finding.line - 1];
  return oldLine === site.anchor && newLine === site.anchor && !hunks.some(hunk => finding.line >= hunk.newStart && finding.line < hunk.newStart + hunk.newCount);
}
export function siteRecord(path, message, source) {
  return { path, rule: message.ruleId, line: message.line, column: message.column, endLine: message.endLine ?? message.line, endColumn: message.endColumn ?? message.column, anchor: source.split(/\r?\n/)[message.line - 1], context: sourceContext(source, message, path) };
}
export function validateLedger(ledger) {
  if (ledger.version !== 1 || !Array.isArray(ledger.sites)) throw new Error('Invalid site baseline');
  ledger.sites.forEach(validateSite);
  return ledger;
}
function validateSite(site) {
  if (!site.path || !site.rule || !Number.isInteger(site.line) || site.line < 1 || !Number.isInteger(site.column) || typeof site.anchor !== 'string') throw new Error('Invalid baseline site');
}
