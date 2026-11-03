import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import { numericRules } from './policy.mjs';
import { inventory } from './selection.mjs';
const metricNames = { complexity: 'complexity', 'sonarjs/cognitive-complexity': 'cognitive', 'max-depth': 'depth', 'max-lines-per-function': 'lines', 'max-params': 'parameters' };
const measurements = { complexity: /complexity of (\d+)/, 'sonarjs/cognitive-complexity': /from (\d+) to/, 'max-depth': /deeply \((\d+)\)/, 'max-lines-per-function': /lines \((\d+)\)/, 'max-params': /parameters \((\d+)\)/ };
export async function numericFindings(source, selected, policy, path) {
  const analyzer = new ESLint({ overrideConfigFile: true, allowInlineConfig: false, overrideConfig: [{ files: ['**/*.{ts,tsx,js,mjs,cjs}'], languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { sonarjs }, rules: numericRules(policy) }] });
  const [result] = await analyzer.lintText(source, { filePath: path });
  return attribute(result.messages, { source, selected, policy, path, functions: inventory(source, path) });
}
function attribute(messages, context) {
  if (messages.some(message => message.fatal)) throw new Error(`Numeric analysis failed: ${JSON.stringify(messages)}`);
  return messages.map(message => finding(message, context)).filter(Boolean);
}
function owner(message, { source, functions }) {
  const offset = source.split('\n').slice(0, message.line - 1).reduce((length, line) => length + line.length + 1, 0) + message.column - 1;
  return functions.filter(fn => fn.start <= offset && fn.end >= offset).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
}
function finding(message, context) {
  const fn = owner(message, context);
  if (!fn || !context.selected.some(selected => selected.start === fn.start)) return null;
  return { path: context.path, function: fn.name, line: message.line, column: message.column, rule: message.ruleId, measured: measuredValue(message), limit: context.policy.functions[metricNames[message.ruleId]], message: message.message, failure: true };
}
function measuredValue(message) {
  const match = message.message.match(measurements[message.ruleId]);
  if (!match) throw new Error(`Unknown analyzer measurement: ${message.ruleId}: ${message.message}`);
  return Number(match[1]);
}
export async function repositoryFindings(cwd) {
  const results = await new ESLint({ cwd, allowInlineConfig: false, errorOnUnmatchedPattern: false }).lintFiles(['apps', 'packages', 'engine-contracts', 'scripts/quality', 'eslint.config.mjs']);
  if (results.some(result => result.fatalErrorCount)) throw new Error(`Repository analysis failed: ${JSON.stringify(results.filter(result => result.fatalErrorCount))}`);
  return results;
}
export function isMigratedRule(rule) {
  return ['@typescript-eslint/no-floating-promises', '@typescript-eslint/no-misused-promises', '@typescript-eslint/switch-exhaustiveness-check', 'sonarjs/no-duplicated-branches', 'sonarjs/no-identical-functions', 'sonarjs/no-identical-expressions'].includes(rule);
}
