import type { GameSnapshot } from "@mudd/client-sdk";
import type { EquipmentSlot } from "@mudd/contracts";
import { parseCommandHeader } from "./metadata.js";
import { findItemContainerMatches, findNpcMatches, findObjectMatches } from "./targets.js";

export type EntityRef = { id: string; label: string; kind: "object" | "inventory" | "npc" | "exit" | "listing" | "tree" | "room" };
export type IntentContext = { worldId?: string; characterId?: string; locationId?: string };
type Scoped = { context: IntentContext; display?: string };
export type ActionIntent = Scoped & (
  | { kind: "look" | "take" | "drop" | "read" | "equip" | "loot" | "talk" | "shop" | "attack" | "buy" | "extinguish" | "go" | "fish" | "heal"; target: EntityRef }
  | { kind: "put" | "use" | "chop"; item: EntityRef; target: EntityRef }
  | { kind: "unequip"; slot: EquipmentSlot; itemId: string }
);
export type TextIntent = { kind: "text"; value: string; verb: string; target: string };
export function intentContext(snapshot: GameSnapshot | null): IntentContext {
  return { worldId: snapshot?.character?.worldInstanceId, characterId: snapshot?.character?.characterId,
    locationId: snapshot?.location?.locationId };
}
export function entityRef(id: string, label: string, kind: EntityRef["kind"]): EntityRef {
  return { id, label, kind };
}
export function sameIntentContext(context: IntentContext, snapshot: GameSnapshot | null): boolean {
  const current = intentContext(snapshot);
  return context.worldId === current.worldId && context.characterId === current.characterId &&
    context.locationId === current.locationId;
}
export function entityAvailable(target: EntityRef, snapshot: GameSnapshot | null, listingIds: readonly string[] = []): boolean {
  switch (target.kind) {
    case "object": return Boolean(snapshot?.location?.objects.some((item) => item.id === target.id));
    case "inventory": return Boolean(snapshot?.character?.inventory.some((item) => item.id === target.id));
    case "npc": return Boolean(snapshot?.location?.npcs?.some((npc) => npc.id === target.id));
    case "exit": return Boolean(snapshot?.location?.exits.some((exit) => exit.id === target.id && exit.available));
    case "listing": return listingIds.includes(target.id);
    case "tree": return Boolean(snapshot?.availableWoodcuttingTrees?.some((tree) => tree.id === target.id));
    case "room": return snapshot?.location?.locationId === target.id;
  }
}

/**
 * Resolves entity grammar from an authoritative view. Commands that require a
 * catalog/query or feature-specific validation retain a typed text intent for
 * the feature adapter. Ambiguous names never resolve to an arbitrary ID.
 */
export function parseWorldCommand(input: string, snapshot: GameSnapshot | null): ActionIntent | TextIntent | { kind: "error"; value: string; message: string } | undefined {
  const header = parseCommandHeader(input);
  if (!header) return;
  const text: TextIntent = { kind: "text", ...header };
  if (!snapshot?.character || !snapshot.location || !header.target) return text;
  const context = intentContext(snapshot);
  const objects = snapshot.location.objects;
  const inventory = snapshot.character.inventory;
  const make = (kind: Exclude<ActionIntent["kind"], "put" | "use" | "chop" | "unequip">, target: EntityRef) =>
    ({ kind, target, context, display: header.value });
  const unique = <T,>(items: T[]) => items.length === 1 ? items[0] : undefined;
  const objectRef = (item: { id: string; label: string }, kind: EntityRef["kind"]) => entityRef(item.id, item.label, kind);
  switch (header.verb) {
    // Text look queries refresh descriptions before resolving their target.
    // Clickable look controls already carry an exact selected identity.
    case "look": return text;
    case "use": {
      const pair = /^(.+?)\s+on\s+(.+)$/i.exec(header.target);
      if (!pair) {
        const item = unique(findObjectMatches(header.target, inventory));
        if (item?.fishingRod) return make("fish", objectRef(item, "inventory"));
        if (item?.consumable?.effect === "heal") return make("heal", objectRef(item, "inventory"));
        return text;
      }
      const item = unique(findObjectMatches(pair[1]!, inventory));
      if (!item) return text;
      const targets = item.woodcuttingAxe ? snapshot.availableWoodcuttingTrees ?? [] : objects;
      const targetName = item.woodcuttingAxe ? pair[2]!.replace(/\s+tree$/i, "").trim() : pair[2]!;
      const target = unique(findObjectMatches(targetName, targets));
      return target ? { kind: item.woodcuttingAxe ? "chop" : "use", context, display: header.value,
        item: objectRef(item, "inventory"), target: objectRef(target, item.woodcuttingAxe ? "tree" : "object") } : text;
    }
    case "take": {
      if (header.target.toLocaleLowerCase() === "all") return text;
      const item = unique(findObjectMatches(header.target, objects.filter((item) => item.takeable)));
      if (item) return make("take", objectRef(item, "object"));
      const pair = unique(findItemContainerMatches(header.target, objects.filter((item) => item.takeable),
        objects.filter((item) => item.containerKind), true));
      return pair ? make("take", objectRef(pair.item, "object")) : text;
    }
    case "put": {
      const pair = unique(findItemContainerMatches(header.target, inventory, objects.filter((item) => item.containerKind)));
      return pair ? { kind: "put", context, display: header.value,
        item: objectRef(pair.item, "inventory"), target: objectRef(pair.container, "object") } : text;
    }
    case "drop": case "equip": {
      const item = unique(findObjectMatches(header.target, inventory));
      return item && (header.verb !== "equip" || item.equipment)
        ? make(header.verb, objectRef(item, "inventory")) : text;
    }
    case "read": case "loot": case "extinguish": {
      // Bulletin aliases retain their feature-specific interpretation.
      if (header.verb === "read" && /^(?:(?:daily|notice|bulletin) )?(?:bulletin|board|bulletin board)$/i.test(header.target)) return text;
      const item = unique(findObjectMatches(header.target, objects));
      if (header.verb === "read" && !item?.readable) return text;
      if (header.verb === "loot" && item?.containerKind !== "corpse") return text;
      return item ? make(header.verb, objectRef(item, "object")) : text;
    }
    case "talk": case "shop": {
      if (/\s+about\s+/i.test(header.target)) return text;
      const npc = unique(findNpcMatches(header.target, snapshot.location.npcs ?? []));
      return npc ? make(header.verb, entityRef(npc.id, npc.name, "npc")) : text;
    }
    case "go": {
      const exits = snapshot.location.exits.filter((exit) => exit.available);
      const id = exits.find((exit) => exit.id === header.target);
      const matches = id ? [id] : exits.filter((exit) => exit.label.toLocaleLowerCase() === header.target.toLocaleLowerCase() ||
        exit.direction?.toLocaleLowerCase() === header.target.toLocaleLowerCase());
      const exit = unique(matches);
      return exit ? make("go", entityRef(exit.id, exit.label, "exit")) : text;
    }
    default: return text;
  }
}
