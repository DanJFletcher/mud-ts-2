import { execFileSync } from 'node:child_process';
export function git(cwd, args) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_EXTERNAL_DIFF: '', GIT_DIFF_OPTS: '' } });
}
export function revision(cwd, ref) {
  if (!ref) throw new Error('An explicit base and head revision are required');
  return git(cwd, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
}
export function comparison(cwd, target, headRef = 'HEAD') {
  const head = revision(cwd, headRef), targetSHA = revision(cwd, target);
  const base = git(cwd, ['merge-base', targetSHA, head]).trim();
  return { base, head, target: targetSHA, files: changedFiles(cwd, base, head) };
}
export function sourceAt(cwd, sha, path) {
  return git(cwd, ['show', `${sha}:${path}`]);
}
function changedFiles(cwd, base, head) {
  const fields = git(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--find-renames', '--name-status', '-z', base, head, '--']).split('\0');
  return decodePaths(fields).map(file => loadFile(cwd, { base, head }, file));
}
function decodePaths(fields, files = []) {
  if (!fields[0]) return files;
  const status = fields.shift(), oldPath = fields.shift();
  return decodePaths(fields, [...files, { status, oldPath, path: status.startsWith('R') ? fields.shift() : oldPath }]);
}
function loadFile(cwd, revisions, file) {
  const before = file.status === 'A' ? '' : sourceAt(cwd, revisions.base, file.oldPath);
  const after = file.status === 'D' ? '' : sourceAt(cwd, revisions.head, file.path);
  return { ...file, before, after, unchanged: before === after, hunks: loadHunks(cwd, revisions, file) };
}
function loadHunks(cwd, { base, head }, file) {
  const patch = git(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--find-renames', '--unified=0', base, head, '--', file.oldPath, file.path]);
  return [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map(hunkValues);
}
function hunkValues(match) {
  return { oldStart: Number(match[1]), oldCount: Number(match[2] ?? 1), newStart: Number(match[3]), newCount: Number(match[4] ?? 1) };
}
