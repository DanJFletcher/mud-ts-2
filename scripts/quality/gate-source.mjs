import { selectFunctions } from './selection.mjs';
import { numericFindings } from './analysis.mjs';
import { isSource, isExempt } from './scope.mjs';
export async function checkChangedFunctions(comparison, policy) {
  const files = comparison.files.filter(file => isSource(file.path) && !isExempt(file.path) && !file.unchanged);
  const checks = await Promise.all(files.map(file => checkFile(file, policy)));
  return { selected: checks.flatMap(check => check.selected), numeric: checks.flatMap(check => check.findings) };
}
async function checkFile(file, policy) {
  if (file.hunks.length === 0) throw new Error(`No source diff hunks available: ${file.path}`);
  const selected = selectFunctions(file.before, file.after, file.hunks, file.path);
  return { selected: selected.map(fn => ({ path: file.path, ...fn })), findings: await numericFindings(file.after, selected, policy, file.path) };
}
