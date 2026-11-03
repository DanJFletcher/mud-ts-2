import ts from 'typescript';
import { posix } from 'node:path';

export function staticSpecifiers(source, path) {
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  if (parsed.parseDiagnostics.length || containsUnsupportedLoader(parsed)) return null;
  return parsed.statements.filter(isRelativeDeclaration).map(node => specifierRange(node.moduleSpecifier, parsed));
}
function isRelativeDeclaration(node) {
  return (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier &&
    ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('.');
}
function specifierRange(node, parsed) {
  return { start: node.getStart(parsed) + 1, end: node.end - 1, text: node.text };
}
function containsUnsupportedLoader(node) {
  return isUnsupportedLoader(node) || ts.forEachChild(node, containsUnsupportedLoader);
}
function isUnsupportedLoader(node) {
  if (!ts.isCallExpression(node)) return false;
  return node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    ts.isIdentifier(node.expression) && node.expression.text === 'require' || isImportGlob(node.expression);
}
function isImportGlob(expression) {
  return ts.isPropertyAccessExpression(expression) && expression.name.text === 'glob' &&
    ts.isMetaProperty(expression.expression) && expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword;
}
export function withoutSpecifierContents(source, specifiers) {
  return specifiers.reduceRight((text, range) => text.slice(0, range.start) + '<module>' + text.slice(range.end), source);
}
export function resolveStaticModule(importer, specifier, paths) {
  if (!paths || /[?#\\]/.test(specifier) || !specifier.startsWith('.')) return null;
  const path = posix.normalize(posix.join(posix.dirname(importer), specifier));
  return path.startsWith('../') ? null : uniqueModule(path, paths);
}
function uniqueModule(path, paths) {
  const candidates = path.endsWith('.js') ? [path, path.slice(0, -3) + '.ts', path.slice(0, -3) + '.tsx'] : [path];
  const matches = candidates.filter(candidate => paths.has(candidate));
  return matches.length === 1 ? matches[0] : null;
}
