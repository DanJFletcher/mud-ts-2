import {
  CharacterAbilityResourceSpentEventSchema,
  CharacterClassCatalogSchema,
  CharacterClassSelectedEventSchema,
  ChooseCharacterClassCommandSchema,
  type CharacterClassCatalog,
  type CharacterClassSnapshot,
  type CharacterProjection,
  type CapabilityToken,
} from '@mudd/contracts';
import {
  replayCharacter, RuleViolationError,
  type EnginePlugin, type EngineCommandContext, type StreamGuard,
} from '@mudd/engine-core';
import { maximumHealthForLevel } from './character-stats.js';

export interface ClassCombatPolicy {
  readonly catalog: CharacterClassCatalog;
  select(classId: string | undefined): CharacterClassSnapshot;
  resolve(character: CharacterProjection, abilityId: string | undefined, encounterId: string, actionId: string): {
    damage: number;
    event: { type: string; version: number; payload: Record<string, unknown> };
  };
}
export const classCombatPolicyCapability = Object.freeze({
  id: 'mudd.ruleset.character-classes.v1', version: '1',
}) satisfies CapabilityToken<ClassCombatPolicy>;

/** Read guards serialize adoption against every shared combat lifecycle. */
export async function classAdoptionGuards(context: EngineCommandContext, characterId: string, allowedStream?: string): Promise<StreamGuard[]> {
  const guards: StreamGuard[] = [];
  const characterEvents = await context.store.readStream(context.worldInstanceId, characterId);
  for (const streamId of ['world-team-combat', `world-interactions:${context.worldInstanceId}`]) {
    const events = await context.store.readStream(context.worldInstanceId, streamId);
    guards.push({ streamId, expectedVersion: events.at(-1)?.aggregateVersion ?? 0 });
    if (streamId === allowedStream) continue;
    const latest = new Map<string, Record<string, unknown>>();
    for (const event of events) {
      const payload = event.payload as Record<string, unknown>;
      const encounter = payload.encounter as Record<string, unknown> | undefined;
      if (encounter && typeof encounter.encounterId === 'string') latest.set(encounter.encounterId, encounter);
    }
    for (const encounter of latest.values()) {
      const participants = encounter.participants as { characterId?: string }[] | undefined;
      if ((encounter.status === 'active' || encounter.status === 'resolving') &&
          participants?.some((participant) => participant.characterId === characterId)) {
        throw new RuleViolationError('CLASS_COMBAT_ACTIVE: Choose a class outside active combat.');
      }
      if (streamId === 'world-team-combat' && participants?.some((participant) => participant.characterId === characterId) &&
          !characterEvents.some((event) => event.type === 'character.team_combat_outcome_applied' &&
            event.payload.encounterId === encounter.encounterId)) {
        throw new RuleViolationError('CLASS_COMBAT_ACTIVE: Wait for the combat outcome to finish before choosing a class.');
      }
    }
  }
  return guards;
}

export function createClassRulesetPlugin(input: CharacterClassCatalog): EnginePlugin {
  // Copy definitions at registration, not mutable authoring references.
  const catalog = CharacterClassCatalogSchema.parse(structuredClone(input));
  const policy: ClassCombatPolicy = {
    catalog,
    select(classId) {
      const definition = catalog.classes.find((entry) => entry.id === classId);
      if (!definition) throw new RuleViolationError('CLASS_INVALID: Choose a class from this world’s catalog.');
      return { ...structuredClone(definition), catalogId: catalog.id, catalogRevision: catalog.revision };
    },
    resolve(character, abilityId, encounterId, actionId) {
      const snapshot = character.characterClass;
      const ability = snapshot?.coreAction;
      if (!snapshot || snapshot.catalogId !== catalog.id || !ability || ability.id !== abilityId) {
        throw new RuleViolationError('ABILITY_NOT_OWNED: This character does not have that action.');
      }
      const { resource, amount } = ability.cost;
      const pool = character.resources[resource];
      if (pool.current < amount) throw new RuleViolationError(`ABILITY_RESOURCE_LOW: You need ${amount} ${resource} to use ${ability.label}.`);
      const weapon = character.inventory.find((item) => item.id === character.equipment.weaponItemId);
      const damage = Math.max(1, ability.baseDamage +
        Math.floor((character.attributes[ability.scalingAttribute] - 10) / 5) +
        (ability.weaponBonus ? weapon?.equipment?.attackBonus ?? 0 : 0));
      const payload = CharacterAbilityResourceSpentEventSchema.shape.payload.parse({
        characterId: character.characterId, encounterId, actionId, abilityId: ability.id,
        abilityRevision: ability.revision, cost: ability.cost, remaining: pool.current - amount,
      });
      return { damage, event: { type: 'character.ability_resource_spent', version: 1, payload } };
    },
  };
  return {
    manifest: {
      id: 'mudd.ruleset.character-classes', version: '1.0.0', apiVersion: '1.0',
      category: 'ruleset', provides: [classCombatPolicyCapability.id],
      eventSchemaVersions: { 'character.class_selected': 1, 'character.ability_resource_spent': 1 },
    },
    validateWorld(world) {
      if (JSON.stringify(world.classCatalog) !== JSON.stringify(catalog)) {
        throw new Error('Class ruleset capability must match the selected world catalog.');
      }
    },
    register({ provideCapability, registerCommand }) {
      provideCapability(classCombatPolicyCapability, policy);
      registerCommand('character.class.choose', ChooseCharacterClassCommandSchema, async (command, context) => {
        const character = replayCharacter(await context.store.readStream(context.worldInstanceId, command.characterId));
        if (!character || character.archived) throw new RuleViolationError('CLASS_CHARACTER_UNAVAILABLE: This character is not available.');
        if (character.characterClass) throw new RuleViolationError('CLASS_ALREADY_SELECTED: A selected class cannot be changed.');
        if (character.combat?.status === 'active' || character.health?.current === 0) {
          throw new RuleViolationError('CLASS_COMBAT_ACTIVE: Choose a class while alive and outside combat.');
        }
        const guards = await classAdoptionGuards(context, character.characterId);
        const snapshot = policy.select(command.payload.classId);
        const level = character.advancement?.level ?? 1;
        const previousMaximum = character.health?.maximum ?? maximumHealthForLevel(level, character.attributes.constitution);
        const maximum = maximumHealthForLevel(level, snapshot.attributes.constitution);
        // No healing on adoption, even if a legacy character never recorded health.
        const health = { current: Math.min(character.health?.current ?? previousMaximum, maximum), maximum };
        const payload = CharacterClassSelectedEventSchema.shape.payload.parse({
          characterId: character.characterId, characterClass: snapshot, attributes: snapshot.attributes, health,
        });
        return { streamId: character.characterId, expectedVersion: command.expectedVersion, guards,
          events: [{ type: 'character.class_selected', version: 1, payload }] };
      });
    },
  };
}
