import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import { numericRules } from './policy.mjs';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
const limits = { functions: { complexity: 2, cognitive: 2, depth: 1, lines: 5, parameters: 4 } };
const lint = new ESLint({ overrideConfigFile: true, overrideConfig: [{ files: ['**/*.ts'], languageOptions: { parser: tseslint.parser }, plugins: { sonarjs }, rules: numericRules(limits) }] });
test('numeric boundaries pass, exceeded limits report even an unchanged declaration', async () => {
  assert.equal((await lint.lintText('function f(x) {\n  return x ? 1 : 2;\n}', { filePath: 'fixture.ts' }))[0].errorCount, 0);
  const result = (await lint.lintText('function f(x) {\n  if (x) {\n    if (x.a) {\n      return 1;\n    }\n  }\n  return 0;\n}', { filePath: 'fixture.ts' }))[0];
  for (const rule of ['complexity', 'max-depth', 'max-lines-per-function', 'sonarjs/cognitive-complexity']) assert.ok(result.messages.some(message => message.ruleId === rule), rule);
});
test('repository analyzer keeps tests/stories exempt and checks JS production and typed findings', async () => {
  const configured = new ESLint();
  const long = 'export function f() {\n' + '  console.log(1);\n'.repeat(8) + '}';
  assert.ok((await configured.lintText(long, { filePath: 'scripts/quality/example.mjs' }))[0].messages.some(message => message.ruleId === 'max-lines-per-function'));
  assert.ok(!(await configured.lintText(long, { filePath: 'scripts/quality/example.test.mjs' }))[0].messages.some(message => message.ruleId === 'max-lines-per-function'));
  const typed = (await configured.lintText('async function f() {}\nf();\n[1].forEach(async () => {});\ntype State = "a" | "b";\nexport function g(s: State) { switch(s) { case "a": return 1; } }', { filePath: 'packages/client-sdk/src/index.ts' }))[0];
  for (const rule of ['@typescript-eslint/no-floating-promises', '@typescript-eslint/no-misused-promises', '@typescript-eslint/switch-exhaustiveness-check']) assert.ok(typed.messages.some(message => message.ruleId === rule), JSON.stringify(typed.messages));
  const smell = (await configured.lintText('export const a = x => x - x;', { filePath: 'scripts/quality/example.mjs' }))[0];
  assert.ok(smell.messages.some(message => message.ruleId === 'sonarjs/no-identical-expressions'));
  const story = (await configured.lintText(long, { filePath: 'packages/ui/src/components/DailyBoard.stories.tsx' }))[0];
  assert.equal(story.fatalErrorCount, 0);
  assert.ok(!story.messages.some(message => message.ruleId === 'max-lines-per-function'));
  const config = (await configured.lintFiles(['apps/web/vite.config.ts']))[0];
  assert.equal(config.fatalErrorCount, 0);
});
