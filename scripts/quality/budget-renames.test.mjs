import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetChanges } from './baselines.mjs';
import { checkChangedFunctions } from './gate-source.mjs';

const rule = { 'max-lines-per-function': { count: 2 } };
const source = 'import { value } from "./helper.js";\nexport const result = () => value;\n';

function migration(options = {}) {
  const file = { status: 'R090', oldPath: 'apps/old.ts', path: 'apps/world/new.ts', unchanged: false,
    before: source, after: source.replace('./helper.js', '../helper.js'), ...options.file };
  const files = [file, ...(options.files ?? [])];
  const trees = {
    beforePaths: new Set(['apps/old.ts', 'apps/helper.ts', ...(options.beforePaths ?? [])]),
    afterPaths: new Set(['apps/world/new.ts', 'apps/helper.ts', ...(options.afterPaths ?? [])].filter(path => !options.removedAfter?.includes(path))),
  };
  return budgetChanges({ 'apps/old.ts': rule }, options.budgets ?? { 'apps/world/new.ts': rule }, files, trees);
}

for (const declaration of [
  'import type { Value } from "./helper.js";',
  'import "./helper.js";',
  'export { value } from "./helper.js";',
  'export * from "./helper.js";',
]) {
  test(`verified migration supports ${declaration}`, () => {
    assert.deepEqual(migration({ file: { before: declaration, after: declaration.replace('./helper.js', '../helper.js') } }), []);
  });
}

test('dependencies can follow unique corresponding tracked renames', () => {
  const file = { after: source.replace('./helper.js', './helper.js') };
  const files = [{ status: 'R100', oldPath: 'apps/helper.ts', path: 'apps/world/helper.ts' }];
  assert.deepEqual(migration({ file, files, afterPaths: ['apps/world/helper.ts'], removedAfter: ['apps/helper.ts'] }), []);
});

for (const [name, options] of [
  ['body edit', { file: { after: source.replace('./helper.js', '../helper.js').replace('=> value', '=> value + 1') } }],
  ['comment edit', { file: { after: '// changed\n' + source.replace('./helper.js', '../helper.js') } }],
  ['format edit', { file: { after: source.replace('./helper.js', '../helper.js').replace('import {', 'import  {') } }],
  ['binding edit', { file: { after: source.replace('./helper.js', '../helper.js').replace('{ value }', '{ value as other }') } }],
  ['type modifier edit', { file: { after: source.replace('./helper.js', '../helper.js').replace('import {', 'import type {') } }],
  ['substitution', { file: { after: source.replace('./helper.js', '../other.js') }, afterPaths: ['apps/other.ts'] }],
  ['unchanged string retargeting', { file: { after: source }, afterPaths: ['apps/world/helper.ts'] }],
  ['unresolved import', { file: { after: source.replace('./helper.js', '../missing.js') } }],
  ['ambiguous extension', { afterPaths: ['apps/helper.tsx'] }],
  ['copy', { file: { status: 'C090' }, afterPaths: ['apps/old.ts'] }],
  ['retained source', { afterPaths: ['apps/old.ts'] }],
  ['destination collision', { beforePaths: ['apps/world/new.ts'] }],
  ['duplicate rename source', { files: [{ status: 'R090', oldPath: 'apps/old.ts', path: 'apps/duplicate.ts' }] }],
  ['dynamic import edit', { file: { before: 'const load = () => import("./helper.js");', after: 'const load = () => import("../helper.js");' } }],
  ['unchanged unsupported loader', { file: { before: source + 'const load = () => import("./other.js");', after: source.replace('./helper.js', '../helper.js') + 'const load = () => import("./other.js");' } }],
  ['require edit', { file: { before: 'const load = require("./helper.js");', after: 'const load = require("../helper.js");' } }],
  ['glob edit', { file: { before: 'const load = import.meta.glob("./*.ts");', after: 'const load = import.meta.glob("../*.ts");' } }],
  ['parse failure', { file: { before: 'import {', after: 'import {' } }],
  ['query resolution', { file: { before: source.replace('./helper.js', './helper.js?raw'), after: source.replace('./helper.js', '../helper.js?raw') } }],
]) {
  test(`budget migration rejects ${name}`, () => assert.ok(migration(options).some(change => change.failure)));
}

test('migration permits decreased counts but rejects increases, new rules and duplicate transfer', () => {
  assert.ok(migration({ budgets: { 'apps/world/new.ts': { 'max-lines-per-function': { count: 1 } } } }).every(change => !change.failure));
  for (const budgets of [
    { 'apps/world/new.ts': { 'max-lines-per-function': { count: 3 } } },
    { 'apps/world/new.ts': { ...rule, complexity: { count: 1 } } },
    { 'apps/old.ts': rule, 'apps/world/new.ts': rule },
  ]) assert.ok(migration({ budgets }).some(change => change.failure));
});

test('dependency renames with a colliding destination do not establish identity', () => {
  const files = [
    { status: 'R090', oldPath: 'apps/helper.ts', path: 'apps/world/helper.ts' },
    { status: 'R090', oldPath: 'apps/other.ts', path: 'apps/world/helper.ts' },
  ];
  const options = { files, file: { after: source }, beforePaths: ['apps/other.ts'], afterPaths: ['apps/world/helper.ts'], removedAfter: ['apps/helper.ts'] };
  assert.ok(migration(options).some(change => change.failure));
});

test('eligible import edits still select functions sharing their changed line', async () => {
  const before = 'import { value } from "./helper.js"; export function legacy(a,b,c,d,e) { return value; }\n';
  const after = before.replace('./helper.js', '../helper.js');
  assert.deepEqual(migration({ file: { before, after } }), []);
  const file = { path: 'apps/world/new.ts', before, after, unchanged: false,
    hunks: [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 }] };
  const policy = { functions: { complexity: 10, cognitive: 10, depth: 3, lines: 5, parameters: 4 } };
  const report = await checkChangedFunctions({ files: [file] }, policy);
  assert.ok(report.selected.some(selected => selected.name === 'legacy'));
  assert.ok(report.numeric.some(finding => finding.rule === 'max-params'));
});
