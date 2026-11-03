import { readFileSync } from 'node:fs';
import { z } from 'zod';
const maximum = z.number().int().positive();
const percentage = z.number().min(0).max(100).finite();
const floors = z.object({ path: z.string().min(1), lines: percentage, branches: percentage, functions: percentage, statements: percentage }).strict();
const schema = z.object({
  version: z.literal(1),
  functions: z.object({ complexity: maximum, cognitive: maximum, depth: maximum, lines: maximum, parameters: maximum }).strict(),
  coverage: z.record(floors).refine(value => Object.keys(value).length > 0, 'Coverage workspaces are required'),
}).strict();
export function validatePolicy(value) {
  return schema.parse(value);
}
export function readPolicy(path = 'quality-policy.json') {
  return validatePolicy(JSON.parse(readFileSync(path, 'utf8')));
}
export function numericRules({ functions: limits }) {
  return { ...complexityRules(limits), ...sizeRules(limits) };
}
function complexityRules(limits) {
  return { complexity: ['error', limits.complexity], 'sonarjs/cognitive-complexity': ['error', limits.cognitive], 'max-depth': ['error', limits.depth] };
}
function sizeRules(limits) {
  return { 'max-lines-per-function': ['error', { max: limits.lines, skipBlankLines: true, skipComments: true }], 'max-params': ['error', limits.parameters] };
}
export const numericExemptions = ['**/*.{test,spec,stories}.{ts,tsx,js,mjs,cjs}', '**/tests/**', '**/__tests__/**'];
