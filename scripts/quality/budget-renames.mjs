import { staticSpecifiers, withoutSpecifierContents, resolveStaticModule } from './module-specifiers.mjs';

export function importOnlyRename(file, context) {
  if (!uniqueRename(file, context)) return false;
  const before = staticSpecifiers(file.before, file.oldPath), after = staticSpecifiers(file.after, file.path);
  return matchingSource(file, before, after) && sameDependencies(file, before, after, context);
}
function uniqueRename(file, { files, beforePaths, afterPaths }) {
  return file.status?.startsWith('R') && beforePaths?.has(file.oldPath) && afterPaths?.has(file.path) &&
    !beforePaths.has(file.path) && !afterPaths.has(file.oldPath) &&
    files.filter(other => other.oldPath === file.oldPath || other.path === file.path).length === 1;
}
function matchingSource(file, before, after) {
  return before && after && before.length === after.length &&
    withoutSpecifierContents(file.before, before) === withoutSpecifierContents(file.after, after);
}
function sameDependencies(file, before, after, context) {
  return before.every((specifier, index) => sameDependency(file, specifier, after[index], context));
}
function sameDependency(file, before, after, context) {
  const original = resolveStaticModule(file.oldPath, before.text, context.beforePaths);
  const current = resolveStaticModule(file.path, after.text, context.afterPaths);
  return original !== null && current !== null && dependencyDestination(original, context) === current;
}
function dependencyDestination(path, context) {
  const renames = context.files.filter(file => file.oldPath === path && file.status?.startsWith('R'));
  if (!renames.length) return path;
  return renames.length === 1 && uniqueRename(renames[0], context) ? renames[0].path : null;
}
