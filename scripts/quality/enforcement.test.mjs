import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numericFindings } from './analysis.mjs';
import { selectFunctions } from './selection.mjs';
import { budgetChanges, siteAllowed } from './baselines.mjs';
import { coverageResults } from './coverage.mjs';
const policy={functions:{complexity:10,cognitive:10,depth:3,lines:5,parameters:4}};
test('numeric findings cover the selected function, not just changed lines', async () => {
 const source = '/* eslint-disable */\nfunction legacy(x) {\n'
  + Array.from({ length: 11 }, (_, index) => `  if (x === ${index}) return ${index};`).join('\n')
  + '\n}\nfunction untouched() {\n'
  + '  console.log(1);\n'.repeat(8)
  + '}\n';
 const changedSource = source.replace('return 0', 'return -1');
 const selectedFunctions = selectFunctions(changedSource, source, [
  { oldStart: 3, oldCount: 1, newStart: 3, newCount: 1 },
 ]);
 const findings = await numericFindings(source, selectedFunctions, policy, 'fixture.ts');

 assert.ok(findings.some(finding =>
  finding.rule === 'complexity'
  && finding.measured === 12
  && finding.limit === 10
  && finding.function === 'legacy'));
 assert.ok(findings.every(finding => finding.function === 'legacy'));
 assert.ok(findings.some(finding => finding.rule === 'max-lines-per-function'));
});
test('budget increases fail', () => {
 const previousBudget = {'old.ts': { complexity: { count: 2 } }};
 const increasedBudget = {'old.ts': { complexity: { count: 3 } }};

 assert.equal(budgetChanges(previousBudget, increasedBudget, []).filter(change => change.failure).length, 1);
});

test('budget decreases are allowed', () => {
 const previousBudget = {'old.ts': { complexity: { count: 2 } }};
 const decreasedBudget = {'old.ts': { complexity: { count: 1 } }};

 assert.equal(budgetChanges(previousBudget, decreasedBudget, []).filter(change => change.failure).length, 0);
});

test('unchanged renames preserve budget allowances', () => {
 const previousBudget = {'old.ts': { complexity: { count: 2 } }};
 const renamedBudget = {'new.ts': { complexity: { count: 2 } }};
 const rename = [{ oldPath: 'old.ts', path: 'new.ts', unchanged: true }];

 assert.equal(budgetChanges(previousBudget, renamedBudget, rename).filter(change => change.failure).length, 0);
});

test('edited renames do not preserve budget allowances', () => {
 const previousBudget = {'old.ts': { complexity: { count: 2 } }};
 const renamedBudget = {'new.ts': { complexity: { count: 2 } }};
 const editedRename = [{ oldPath: 'old.ts', path: 'new.ts', unchanged: false }];

 assert.equal(budgetChanges(previousBudget, renamedBudget, editedRename).filter(change => change.failure).length, 1);
});

test('import-only renames retain allowances when dependencies keep identity', () => {
 const previousBudget = {'apps/old.ts': {'max-lines-per-function': { count: 2 } }};
 const renamedBudget = {'apps/world/new.ts': {'max-lines-per-function': { count: 2 } }};
 const source = 'import { value } from "./helper.js";\nexport const current = () => value;\n';
 const files = [{
  status: 'R090',
  oldPath: 'apps/old.ts',
  path: 'apps/world/new.ts',
  unchanged: false,
  before: source,
  after: source.replace('./helper.js', '../helper.js'),
 }];
 const trees = {
  beforePaths: new Set(['apps/old.ts', 'apps/helper.ts']),
  afterPaths: new Set(['apps/world/new.ts', 'apps/helper.ts']),
 };

 assert.deepEqual(budgetChanges(previousBudget, renamedBudget, files, trees), []);
});

const originalSiteSource = 'const a = x - x;\nconst b = 1;\n';
const originalSite = {
 rule: 'sonarjs/no-identical-expressions',
 path: 'f.ts',
 line: 1,
 column: 11,
 anchor: 'const a = x - x;',
};

test('unchanged occurrences retain site allowances', () => {
 const comparison = { before: originalSiteSource, after: originalSiteSource, hunks: [] };

 assert.equal(siteAllowed(originalSite, { ...originalSite }, comparison), true);
});

test('copied occurrences cannot inherit site allowances', () => {
 const copiedSource = originalSiteSource + 'const a = x - x;\n';
 const comparison = {
  before: originalSiteSource,
  after: copiedSource,
  hunks: [{ oldStart: 2, oldCount: 0, newStart: 3, newCount: 1 }],
 };

 assert.equal(siteAllowed(originalSite, { ...originalSite, line: 3 }, comparison), false);
});

test('edited occurrences lose site allowances', () => {
 const editedSource = originalSiteSource.replace('a', 'c');
 const comparison = {
  before: originalSiteSource,
  after: editedSource,
  hunks: [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 }],
 };

 assert.equal(siteAllowed(originalSite, { ...originalSite }, comparison), false);
});

const coveragePackages = {
 a: { path: 'a', lines: 80, branches: 70, functions: 60, statements: 80 },
 b: { path: 'b', lines: 80, branches: 70, functions: 60, statements: 80 },
};
const coverageThresholds = {
 lines: { pct: 80 },
 branches: { pct: 70 },
 functions: { pct: 60 },
 statements: { pct: 80 },
};

test('inclusive coverage floors allow exact matches', () => {
 const reports = { a: { total: coverageThresholds }, b: { total: coverageThresholds } };

 assert.equal(coverageResults(coveragePackages, reports).filter(result => result.failure).length, 0);
});

test('coverage failures identify the package below its floor', () => {
 const reports = {
  a: { total: { ...coverageThresholds, lines: { pct: 79 } } },
  b: { total: coverageThresholds },
 };

 assert.ok(coverageResults(coveragePackages, reports).some(result => result.failure && result.package === 'a'));
});

test('missing package coverage reports fail closed', () => {
 const results = coverageResults(coveragePackages, {});

 assert.ok(results.some(result => result.failure));
});

test('missing coverage totals fail closed', () => {
 const results = coverageResults(coveragePackages, { a: { total: {} } });

 assert.ok(results.some(result => result.failure));
});

test('invalid coverage percentages fail closed', () => {
 const invalidTotal = { ...coverageThresholds, lines: { pct: 'Unknown' } };
 const results = coverageResults(coveragePackages, { a: { total: invalidTotal } });

 assert.ok(results.some(result => result.failure));
});
test('changed functions invalidate unchanged diagnostic-line allowances', async () => {
 const { siteRecord } = await import('./baselines.mjs');
 const before = 'function f(x) {\n  return x - x;\n}\n';
 const after = before.replace('x - x', 'x - x + 1');
 const message = { ruleId: 'sonarjs/no-identical-functions', line: 1, column: 1 };
 const previousSite = siteRecord('f.ts', message, before);
 const currentSite = siteRecord('f.ts', message, after);
 const comparison = {
  before,
  after,
  hunks: [{ oldStart: 2, oldCount: 1, newStart: 2, newCount: 1 }],
 };

 assert.equal(siteAllowed(previousSite, currentSite, comparison), false);
});

test('unavailable diff hunks cannot exempt changed production files', async () => {
 const { checkChangedFunctions } = await import('./gate-source.mjs');
 const changedFile = {
  path: 'apps/f.ts',
  before: 'const f = () => 1;',
  after: 'const f = () => 2;',
  hunks: [],
  unchanged: false,
 };

 await assert.rejects(
  checkChangedFunctions({ files: [changedFile] }, policy),
  /hunk/i,
 );
});

test('site-ledger decreases are reported without failing', async () => {
 const { siteChanges } = await import('./gate-sites.mjs');
 const removedSite = { rule: 'smell', path: 'f.ts', line: 1, column: 1, anchor: 'f();' };
 const changes = siteChanges([removedSite], []);

 assert.equal(changes.length, 1);
 assert.equal(changes[0].failure, false);
 assert.equal(changes[0].change, 'removed');
});
test('nesting findings report the actual depth', async () => {
 const { inventory } = await import('./selection.mjs');
 const source = 'function f(a) { if(a) { if(a.b) { if(a.b.c) { if(a.b.c.d) { return 1; } } } } }';
 const findings = await numericFindings(source, inventory(source), policy, 'fixture.ts');

 assert.ok(findings.some(finding =>
  finding.rule === 'max-depth' && finding.measured === 4 && finding.limit === 3));
});

test('parameter findings report the actual parameter count', async () => {
 const { inventory } = await import('./selection.mjs');
 const source = 'const f = (a,b,c,d,e) => [a,b,c,d,e];';
 const findings = await numericFindings(source, inventory(source), policy, 'fixture.ts');

 assert.ok(findings.some(finding => finding.rule === 'max-params' && finding.measured === 5));
});

test('cognitive findings retain over-limit improvements', async () => {
 const makeFunction = count => 'function f(x) {\n'
  + Array.from({ length: count }, (_, index) => ` if(x === ${index}) return ${index};`).join('\n')
  + '\n}';
 const before = makeFunction(20);
 const after = makeFunction(12);
 const selectedFunctions = selectFunctions(before, after, [
  { oldStart: 14, oldCount: 8, newStart: 13, newCount: 0 },
 ]);
 const findings = await numericFindings(after, selectedFunctions, policy, 'fixture.ts');

 assert.ok(findings.some(finding =>
  finding.rule === 'sonarjs/cognitive-complexity'
  && finding.measured === 12
  && finding.limit === 10));
});

test('same-count replacements cannot transfer numeric allowances', async () => {
 const body = '  console.log(1);\n'.repeat(8);
 const before = 'function oldFunction() {\n' + body + '}\n';
 const after = 'function newFunction() {\n' + body + '}\n';
 const selectedFunctions = selectFunctions(before, after, [
  { oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 },
 ]);
 const findings = await numericFindings(after, selectedFunctions, policy, 'fixture.ts');

 assert.ok(findings.some(finding =>
  finding.function === 'newFunction'
  && finding.rule === 'max-lines-per-function'
  && finding.measured === 10));
});
test('ambiguous duplicate occurrences fail with inspect/prune guidance', async t => {
 const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
 const { tmpdir } = await import('node:os');
 const { join } = await import('node:path');
 const { checkSites } = await import('./gate-sites.mjs');
 const { siteRecord } = await import('./baselines.mjs');
 const cwd = mkdtempSync(join(tmpdir(), 'quality-ambiguous-'));
 t.after(() => rmSync(cwd, { recursive: true, force: true }));
 const source = 'export const f = x => x - x;\n';
 const message = {
  ruleId: 'sonarjs/no-identical-expressions',
  line: 1,
  column: source.indexOf('x - x') + 1,
 };
 const filePath = join(cwd, 'f.mjs');
 writeFileSync(filePath, source);
 const site = siteRecord('f.mjs', message, source);
 const files = [{
  path: 'f.mjs',
  oldPath: 'f.mjs',
  before: source,
  after: source,
  hunks: [],
 }];
 const results = checkSites(
  [{ filePath, messages: [message] }],
  {
   cwd,
   comparison: { files },
   sites: [site, site],
   headSites: [site, site],
  },
 );

 assert.equal(results.length, 1);
 assert.match(results[0].message, /ambiguous.*prune/i);
});
