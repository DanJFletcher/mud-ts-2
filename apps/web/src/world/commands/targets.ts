export function findObjectMatches<T extends { id: string; label: string }>(
  target: string,
  objects: readonly T[],
): T[] {
  const normalizedTarget = target.trim().toLocaleLowerCase();
  const exactId = objects.filter((object) => object.id.toLocaleLowerCase() === normalizedTarget);
  if (exactId.length) return exactId;
  const exactLabel = objects.filter((object) => object.label.toLocaleLowerCase() === normalizedTarget);
  return exactLabel.length ? exactLabel
    : objects.filter((object) => object.label.toLocaleLowerCase().includes(normalizedTarget));
}

export function findItemContainerMatches<
  TItem extends { id: string; label: string; containerId?: string },
  TContainer extends { id: string; label: string },
>(
  target: string,
  items: readonly TItem[],
  containers: readonly TContainer[],
  requireItemInsideContainer = false,
): Array<{ item: TItem; container: TContainer }> {
  const words = target
    .trim()
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/\s+(?:from|in|into)\s+/gi, " ")
    .replace(/\s+(?:the|a|an)\s+/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  const matches = new Map<string, { item: TItem; container: TContainer }>();
  for (let itemWordCount = 1; itemWordCount < words.length; itemWordCount += 1) {
    const itemTarget = words.slice(0, itemWordCount).join(" ");
    const containerTarget = words.slice(itemWordCount).join(" ");
    for (const item of findObjectMatches(itemTarget, items)) {
      for (const container of findObjectMatches(containerTarget, containers)) {
        if (requireItemInsideContainer && item.containerId !== container.id) continue;
        matches.set(`${item.id}:${container.id}`, { item, container });
      }
    }
  }
  return [...matches.values()];
}

export function findNpcMatches<T extends { id: string; name: string }>(target: string, npcs: readonly T[]): T[] {
  const matches = findObjectMatches(target, npcs.map((npc) => ({ ...npc, label: npc.name })));
  return matches;
}

