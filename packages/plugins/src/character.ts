import type { EnginePlugin } from '@mudd/engine-core';
import { replayCharacter } from '@mudd/engine-core';
import {
  worldItemsStateCapability,
  type WorldItemsStateCapability,
} from './world-items.js';
import {
  autonomousNpcStateCapability,
  type AutonomousNpcStateCapability,
} from './autonomous-npcs.js';
import { classCombatPolicyCapability, type ClassCombatPolicy } from './classes.js';
import {
  temporaryCampfiresCapability,
  type TemporaryCampfiresCapability,
} from './temporary-campfires.js';
import {
  characterStateCapability,
  type CharacterStateCapability,
} from './character/state.js';
import { registerCharacterRecovery } from './character/recovery.js';
import {
  registerCharacterCreation,
  registerCharacterManagement,
} from './character/lifecycle.js';
import { registerCharacterInventory } from './character/inventory.js';
import {
  registerCharacterQueries,
  registerCharacterReadCommand,
} from './character/queries.js';

export {
  assertCharacterAlive,
  assertCharacterStanding,
  characterStateCapability,
  isInSharedCombat,
} from './character/state.js';
export type { CharacterStateCapability } from './character/state.js';
export {
  activeSharedCombatCharacterIds,
  isCharacterInActiveCombat,
  staminaRecoveryEvent,
  staminaRecoveryEventForCommand,
  vitalRecoveryPausedEvent,
} from './character/state.js';
export { teamFleeStaminaEffect } from './character/recovery.js';

export const characterPlugin: EnginePlugin = {
  validateWorld(world, context) {
    const policy = context.optionalCapability<ClassCombatPolicy>(classCombatPolicyCapability);
    if (Boolean(world.classCatalog) !== Boolean(policy)) {
      throw new Error('A world class catalog requires its class ruleset capability, and vice versa.');
    }
  },
  manifest: {
    id: 'mudd.character',
    version: '1.0.0',
    apiVersion: '2.0',
    category: 'core',
    provides: ['mudd.character.state.v1'],
    requiredPlugins: { 'mudd.world-items': '^1.0.0' },
    eventSchemaVersions: {
      'character.created': 3,
      'character.stamina_spent': 1,
      'character.stamina_recovery_settled': 1,
      'character.vital_recovery_settled': 1,
      'character.posture_changed': 1,
      'character.equipment_changed': 1,
      'character.shared_item_received': 1,
      'character.shared_item_relinquished': 1,
      'character.corpse_gold_received': 1,
      'character.respawned': 1,
    },
  },
  register({
    registerCommand,
    registerSystemCommand,
    registerQuery,
    registerEffect,
    provideCapability,
    requireCapability,
    optionalCapability,
  }) {
    const worldItems = requireCapability<WorldItemsStateCapability>(worldItemsStateCapability);
    const autonomousNpcs = optionalCapability<AutonomousNpcStateCapability>(autonomousNpcStateCapability);
    const temporaryCampfires = optionalCapability<TemporaryCampfiresCapability>(temporaryCampfiresCapability);
    const state: CharacterStateCapability = {
      async load(context, characterId) {
        if ('characterProjection' in context && context.characterProjection?.characterId === characterId) {
          return context.characterProjection;
        }
        return replayCharacter(await context.store.readStream(context.worldInstanceId, characterId));
      },
    };
    provideCapability(characterStateCapability, state);

    registerCharacterRecovery(
      { registerCommand, registerSystemCommand, registerEffect },
      state,
    );
    registerCharacterCreation({ registerCommand, optionalCapability });
    registerCharacterInventory({ registerCommand }, state, worldItems);
    registerCharacterReadCommand({ registerCommand }, state);
    registerCharacterManagement({ registerCommand }, state);
    registerCharacterQueries(
      { registerQuery },
      { state, worldItems, autonomousNpcs, temporaryCampfires },
    );
  },
};
