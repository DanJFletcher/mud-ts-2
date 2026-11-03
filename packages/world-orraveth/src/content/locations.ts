import type { WorldPackContent } from '@mudd/contracts';

export function mergeLocationContent(
  ...fragments: WorldPackContent['locationContent'][]
): WorldPackContent['locationContent'] {
  const result: WorldPackContent['locationContent'] = {};
  for (const fragment of fragments) {
    for (const [id, content] of Object.entries(fragment)) {
      if (Object.hasOwn(result, id)) throw new Error(`Duplicate location content key ${id}`);
      result[id] = content;
    }
  }
  return result;
}
