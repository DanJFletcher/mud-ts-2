const FAREWELL_LABELS = [
  "I should get going",
  "Goodbye",
  "I'll leave you to it",
  "Until next time",
  "I have to be off",
] as const;

/** Keeps one farewell phrase stable for each NPC while varying it between NPCs. */
export function getNpcFarewellLabel(npcId: string): (typeof FAREWELL_LABELS)[number] {
  let hash = 0;
  for (const character of npcId) {
    hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  }
  return FAREWELL_LABELS[hash % FAREWELL_LABELS.length]!;
}
