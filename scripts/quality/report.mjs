import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
export function summary(report) {
  return [`# PR quality: ${report.status}`, `Base: ${report.base ?? 'unresolved'} | Target: ${report.target ?? 'unresolved'} | Head: ${report.head ?? 'unresolved'}`, `Selected functions: ${report.selected?.length ?? 0}${report.selected?.length === 0 ? ' (no applicable functions changed)' : ''}`, `Policy changed: ${Boolean(report.policyChanged)}`, details(report)].join('\n\n') + '\n';
}
function details(report) {
  return ['Policy', 'PolicyBefore', 'Selected', 'Numeric', 'Findings', 'BaselineChanges', 'Coverage', 'Failures', 'Error'].filter(key => report[key[0].toLowerCase() + key.slice(1)] !== undefined).map(key => section(key, report[key[0].toLowerCase() + key.slice(1)])).join('\n\n');
}
function section(title, value) {
  return `## ${title}\n\n\`\`\`json\n${JSON.stringify(value, null, 2).replaceAll('`', '\\u0060')}\n\`\`\``;
}
export function writeReport(report, path) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(path.replace(/\.json$/, '') + '.md', summary(report));
}
export function publishSummary(report, path = process.env.GITHUB_STEP_SUMMARY) {
  if (path) appendFileSync(path, summary(report));
}
