import { inventory } from './selection.mjs';
export function sourceContext(source, message, path) {
  const offset = source.split('\n').slice(0, message.line - 1).reduce((length, line) => length + line.length + 1, 0) + message.column - 1;
  const owner = inventory(source, path).filter(fn => fn.start <= offset && fn.end >= offset).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
  return owner ? source.slice(owner.start, owner.end) : source.split(/\r?\n/).slice(message.line - 1, message.endLine ?? message.line).join('\n');
}
