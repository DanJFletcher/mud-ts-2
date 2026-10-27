import {
  CharacterRespawnedEventSchema,
  characterHasEquippedItem,
  type CharacterProjection,
  type InventoryItemProjection,
} from '@mudd/contracts';
import type { EngineCommandContext, ProposedDomainEvent, ProposedEventEffect } from '@mudd/engine-core';
import { createWorldItemDrop } from './world-items.js';

export interface PreparedRespawn {
  event: ProposedDomainEvent;
  effects: ProposedEventEffect[];
}

export function prepareCharacterRespawn(
  character: CharacterProjection,
  context: Pick<EngineCommandContext, 'world' | 'makeId' | 'rng'>,
  cause: 'pve' | 'pvp' | 'team-pve',
  encounterId: string,
  deathLocationId: string,
  excludedItemIds: readonly string[] = [],
  maximumHealth = character.health?.maximum ?? 6,
): PreparedRespawn | undefined {
  const respawnLocationId = context.world.respawn?.locationId;
  if (!respawnLocationId) return undefined;
  if (!context.world.locations.some((location) => location.id === respawnLocationId)) {
    throw new Error('The configured respawn location is missing from this world.');
  }

  const excluded = new Set(excludedItemIds);
  const eligible = character.inventory.filter((item) =>
    !excluded.has(item.id) &&
    item.questBound !== true &&
    !context.world.locations.some((location) =>
      location.takeables?.some((takeable) => takeable.id === item.id && takeable.questBound === true)) &&
    !characterHasEquippedItem(character.equipment, item.id));
  const selected = eligible.length ? eligible[context.rng.roll(eligible.length) - 1] : undefined;
  if (eligible.length && !selected) {
    throw new Error('The authoritative RNG returned an out-of-range item selection.');
  }

  let droppedItem: { sourceItemId: string; item: InventoryItemProjection } | undefined;
  const effects: ProposedEventEffect[] = [];
  if (selected) {
    const worldItemId = selected.sharedItemId ?? context.makeId();
    const drop = createWorldItemDrop(worldItemId, character.characterId, deathLocationId, selected);
    droppedItem = { sourceItemId: selected.id, item: drop.item };
    effects.push(drop.effect);
  }
  const payload = {
    characterId: character.characterId,
    cause,
    encounterId,
    deathLocationId,
    respawnLocationId,
    health: { current: maximumHealth, maximum: maximumHealth },
    ...(droppedItem ? { droppedItem } : {}),
  };
  CharacterRespawnedEventSchema.shape.payload.parse(payload);
  return {
    event: { type: 'character.respawned', version: 1, payload },
    effects,
  };
}
