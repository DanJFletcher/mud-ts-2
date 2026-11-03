import { parseForESLint } from '@typescript-eslint/parser';
const executable = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
export function inventory(source, path = 'fixture.ts') {
  const parsed = parseForESLint(source, { filePath: path, range: true, loc: true, tokens: true, comment: true, jsx: path.endsWith('tsx') });
  return visit(parsed.ast, { keys: parsed.visitorKeys, functions: [] }).functions;
}
function visit(node, context, parent) {
  if (executable.has(node.type) && node.body) context.functions.push(describe(node, parent));
  for (const key of context.keys[node.type] ?? []) visitChildren(node[key], context, node);
  return context;
}
function visitChildren(value, context, parent) {
  for (const child of [].concat(value ?? []).filter(Boolean)) visit(child, context, parent);
}
function describe(node, parent) {
  const span = parent?.type === 'MethodDefinition' ? parent : node;
  return { name: functionName(node, parent), start: span.range[0], end: span.range[1], line: span.loc.start.line, endLine: span.loc.end.line, nodeStart: node.range[0], nodeEnd: node.range[1] };
}
function functionName(node, parent) {
  return node.id?.name ?? parent?.key?.name ?? parent?.id?.name ?? '<anonymous>';
}
export function selectFunctions(before, after, hunks, path = 'fixture.ts') {
  const oldFunctions = inventory(before, path), functions = inventory(after, path);
  return functions.filter(fn => hunks.some(hunk => addedOverlap(fn, hunk)) || deletionSurvivor(fn, { oldFunctions, hunks }));
}
function addedOverlap(fn, hunk) {
  return hunk.newCount > 0 && fn.line <= hunk.newStart + hunk.newCount - 1 && fn.endLine >= hunk.newStart;
}
function deletedOverlap(fn, hunk) {
  return hunk.oldCount > 0 && fn.line <= hunk.oldStart + hunk.oldCount - 1 && fn.endLine >= hunk.oldStart;
}
function deletionSurvivor(fn, { oldFunctions, hunks }) {
  return oldFunctions.some(old => hunks.some(hunk => deletedOverlap(old, hunk)) && survivingSpan(old, hunks, fn));
}
function survivingSpan(old, hunks, fn) {
  const lines = Array.from({ length: old.endLine - old.line + 1 }, (_, index) => mapLine(old.line + index, hunks)).filter(line => line !== null);
  return lines.length > 0 && fn.line <= Math.min(...lines) && fn.endLine >= Math.max(...lines);
}
export function mapLine(line, hunks) {
  if (hunks.some(hunk => line >= hunk.oldStart && line < hunk.oldStart + hunk.oldCount)) return null;
  return line + hunks.filter(hunk => line > hunk.oldStart + hunk.oldCount - 1).reduce((shift, hunk) => shift + hunk.newCount - hunk.oldCount, 0);
}
