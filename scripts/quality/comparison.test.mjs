import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { repository } from './tests/repository.mjs';
import { comparison } from './git.mjs';
import { inventory, selectFunctions } from './selection.mjs';
test('explicit revisions report their base and head', t => {
  const repo = repository(t, { 'fixture.ts': 'export const value = 1;\n' });
  writeFileSync(join(repo.cwd, 'head.ts'), 'export const head = 1;\n');
  const head = repo.commit();

  const result = comparison(repo.cwd, repo.base, head);

  assert.equal(result.base, repo.base);
  assert.equal(result.head, head);
});

test('byte-identical renames preserve paths with spaces', t => {
  const repo = repository(t, { 'old name.ts': 'export const f = () => 1;\n' });
  renameSync(join(repo.cwd, 'old name.ts'), join(repo.cwd, 'new name.ts'));
  const head = repo.commit();

  const result = comparison(repo.cwd, repo.base, head);

  assert.equal(result.files[0].oldPath, 'old name.ts');
  assert.equal(result.files[0].path, 'new name.ts');
  assert.equal(result.files[0].unchanged, true);
});

test('missing revisions fail explicitly', t => {
  const repo = repository(t, { 'fixture.ts': 'export const value = 1;\n' });

  assert.throws(() => comparison(repo.cwd, 'missing', repo.base));
});

test('maintenance comparisons use the merge base', t => {
  const repo = repository(t, { 'fixture.ts': 'export const value = 1;\n' });
  writeFileSync(join(repo.cwd, 'head.ts'), 'export const head = 1;\n');
  const head = repo.commit();
  repo.git('checkout', '-qb', 'maintenance', repo.base);
  writeFileSync(join(repo.cwd, 'maintenance.ts'), 'export const maintenance = 1;\n');
  const maintenance = repo.commit();

  assert.equal(comparison(repo.cwd, maintenance, head).base, repo.base);
});

const executableFunctionForms =
  'function* f() { yield 1; }\nconst a = async (x: number): Promise<number> => x;\nconst b = function() {};\nclass C { constructor() {} get x() { return 1; } set x(v) {} m() { return [1].map(n => n+1); } }';

test('inventory includes executable TypeScript and JavaScript function forms', () => {
  assert.equal(inventory(executableFunctionForms).length, 8);
});

test('insertions select every executable function form', () => {
  const selected = selectFunctions('', executableFunctionForms, [
    { oldStart: 0, oldCount: 0, newStart: 1, newCount: 4 },
  ]);

  assert.equal(selected.length, 8);
});

test('invalid source fails inventory', () => {
  assert.throws(() => inventory('function {'));
});

const selectionFixture =
  'function outer() {\n  return [1].map(x => x + 1);\n}\nfunction neighbor() {\n  return 1;\n}\n';

test('body edits select the containing function and its nested function', () => {
  const changedBody = selectionFixture.replace('x + 1', 'x + 2');
  const selectedNames = selectFunctions(selectionFixture, changedBody, [
    { oldStart: 2, oldCount: 1, newStart: 2, newCount: 1 },
  ]).map(func => func.name);

  assert.deepEqual(selectedNames, ['outer', '<anonymous>']);
});

test('inserted headings do not select shifted functions', () => {
  const shiftedSource = '// heading\n' + selectionFixture;
  const selected = selectFunctions(selectionFixture, shiftedSource, [
    { oldStart: 0, oldCount: 0, newStart: 1, newCount: 1 },
  ]);

  assert.equal(selected.length, 0);
});

test('signature edits select the changed function', () => {
  const changedSignature = selectionFixture.replace('outer()', 'outer(x: number)');
  const selected = selectFunctions(selectionFixture, changedSignature, [
    { oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 },
  ]);

  assert.equal(selected[0].name, 'outer');
});

const deletionFixture =
  'function outer() {\n  const unused = () => 1;\n  console.log(1);\n  return 2;\n}\nfunction sibling() { return 3; }\n';
const withoutNestedFunction = deletionFixture.replace('  const unused = () => 1;\n', '');

test('nested deletions select the surviving outer function', () => {
  const selectedNames = selectFunctions(deletionFixture, withoutNestedFunction, [
    { oldStart: 2, oldCount: 1, newStart: 1, newCount: 0 },
  ]).map(func => func.name);

  assert.deepEqual(selectedNames, ['outer']);
});

test('deleted top-level functions do not select surviving siblings', () => {
  const sourceWithDeletedFunction = 'function gone() {\n  return 1;\n}\n' + deletionFixture;
  const selected = selectFunctions(sourceWithDeletedFunction, deletionFixture, [
    { oldStart: 1, oldCount: 3, newStart: 0, newCount: 0 },
  ]);

  assert.equal(selected.length, 0);
});

test('CRLF deletions preserve function selection', () => {
  const before = deletionFixture.replaceAll('\n', '\r\n');
  const after = withoutNestedFunction.replaceAll('\n', '\r\n');
  const selected = selectFunctions(before, after, [
    { oldStart: 2, oldCount: 1, newStart: 1, newCount: 0 },
  ]);

  assert.equal(selected.length, 1);
});

test('TypeScript angle assertions use the TypeScript parser', () => {
  const source = 'const f = <T>(value: T) => <T>value;';

  assert.equal(inventory(source, 'fixture.ts').length, 1);
});

test('JSX uses the TSX parser', () => {
  const source = 'const View = () => <div>Hello</div>;';

  assert.equal(inventory(source, 'fixture.tsx').length, 1);
});

const formattingFixture = 'function typed(): number {\n  return 1;\n}\nconst a = () => 2; const b = () => 3;\n';

test('return-type edits select the typed function', () => {
  const changedReturnType = formattingFixture.replace(': number', ': unknown');
  const selectedNames = selectFunctions(formattingFixture, changedReturnType, [
    { oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 },
  ]).map(func => func.name);

  assert.deepEqual(selectedNames, ['typed']);
});

test('formatting edits select the containing function', () => {
  const changedIndentation = formattingFixture.replace('  return', '    return');
  const selectedNames = selectFunctions(formattingFixture, changedIndentation, [
    { oldStart: 2, oldCount: 1, newStart: 2, newCount: 1 },
  ]).map(func => func.name);

  assert.deepEqual(selectedNames, ['typed']);
});

test('same-line function edits retain conservative selection', () => {
  const changedArrow = formattingFixture.replace('=> 2', '=> 4');
  const selectedNames = selectFunctions(formattingFixture, changedArrow, [
    { oldStart: 4, oldCount: 1, newStart: 4, newCount: 1 },
  ]).map(func => func.name);

  assert.deepEqual(selectedNames, ['a', 'b']);
});

test('move hunks map the typed function once', () => {
  const movedSource =
    'const a = () => 2; const b = () => 3;\nfunction typed(): number {\n  return 1;\n}\n';
  const hunks = [
    { oldStart: 1, oldCount: 3, newStart: 0, newCount: 0 },
    { oldStart: 4, oldCount: 0, newStart: 2, newCount: 3 },
  ];
  const selectedNames = selectFunctions(formattingFixture, movedSource, hunks)
    .filter(func => func.name === 'typed')
    .map(func => func.name);

  assert.deepEqual(selectedNames, ['typed']);
});

test('duplicate anonymous functions map to the changed occurrence', () => {
  const source =
    'const first = function() {\n return 1;\n};\nconst second = function() {\n return 1;\n};\n';
  const changedSource = source.replace(' return 1;\n', '');
  const selectedNames = selectFunctions(source, changedSource, [
    { oldStart: 2, oldCount: 1, newStart: 1, newCount: 0 },
  ]).map(func => func.name);

  assert.deepEqual(selectedNames, ['first']);
});
test('rename-plus-edit retains the old source path', t => {
  const original = 'export const original = () => 1;\n'.repeat(5);
  const repo = repository(t, { 'original.ts': original });
  renameSync(join(repo.cwd, 'original.ts'), join(repo.cwd, 'renamed.ts'));
  writeFileSync(
    join(repo.cwd, 'renamed.ts'),
    'export const changed = () => 2;\n' + 'export const original = () => 1;\n'.repeat(4),
  );
  const head = repo.commit();
  const renamed = comparison(repo.cwd, repo.base, head).files.find(file => file.path === 'renamed.ts');

  assert.equal(renamed.oldPath, 'original.ts');
  assert.equal(renamed.unchanged, false);
});

test('copies at a destination count as additions', t => {
  const original = 'export const original = () => 1;\n'.repeat(5);
  const repo = repository(t, { 'original.ts': original });
  writeFileSync(join(repo.cwd, 'copy.ts'), 'export const copied = () => 1;\n');
  const head = repo.commit();
  const copied = comparison(repo.cwd, repo.base, head).files.find(file => file.path === 'copy.ts');

  assert.equal(selectFunctions(copied.before, copied.after, copied.hunks).length, 1);
});
test('array holes in valid production code do not break function inventory', () => {
  assert.equal(inventory('export const hole = () => [1, , 3];').length, 1);
});
