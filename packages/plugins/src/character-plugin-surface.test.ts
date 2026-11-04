import { describe, expect, it } from 'vitest';
import * as pluginExports from './index.js';
import * as characterModule from './character.js';
import { worldItemsStateCapability } from './world-items.js';

function collectRegistrations() {
  const commands: string[] = [];
  const systemCommands: string[] = [];
  const queries: string[] = [];
  const effects: string[] = [];
  let providedCapability: unknown;
  let providedImplementation: unknown;

  characterModule.characterPlugin.register({
    registerCommand: (name: string) => commands.push(name),
    registerSystemCommand: (name: string, _schema: unknown, _handler: unknown, version = 1) => {
      systemCommands.push(`${name}@${version}`);
    },
    registerQuery: (name: string) => queries.push(name),
    registerEffect: (name: string, version: number) => effects.push(`${name}@${version}`),
    provideCapability: (token: unknown, implementation: unknown) => {
      providedCapability = token;
      providedImplementation = implementation;
    },
    requireCapability: (token: { id: string }) => {
      if (token.id !== worldItemsStateCapability.id) {
        throw new Error(`Unexpected capability ${token.id}`);
      }
      return {} as never;
    },
    optionalCapability: () => undefined,
  } as never);

  return {
    commands: commands.sort(),
    systemCommands: systemCommands.sort(),
    queries: queries.sort(),
    effects: effects.sort(),
    providedCapability,
    providedImplementation,
  };
}

describe('character plugin public surface', () => {
  it('preserves its manifest and event schema versions', () => {
    expect(characterModule.characterPlugin.manifest).toEqual({
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
    });
  });

  it('preserves the complete command, query, and effect registration set', () => {
    const { providedCapability: _capability, providedImplementation: _implementation, ...registrations } =
      collectRegistrations();
    expect(registrations).toEqual({
      commands: [
        'character.archive',
        'character.create',
        'character.drop',
        'character.equip',
        'character.put',
        'character.read',
        'character.rename',
        'character.restore',
        'character.rest',
        'character.stand',
        'character.take',
        'character.unequip',
        'character.use',
      ].sort(),
      systemCommands: [
        'character.stamina.recover@1',
        'character.stamina.recover@2',
      ],
      queries: ['location.describe', 'object.inspect', 'object.read'],
      effects: ['mudd.character.team-flee-stamina@1'],
    });
  });

  it('keeps the current package exports identical to the character module exports', () => {
    expect(pluginExports.characterPlugin).toBe(characterModule.characterPlugin);
    expect(pluginExports.activeSharedCombatCharacterIds).toBe(characterModule.activeSharedCombatCharacterIds);
    expect(pluginExports.isCharacterInActiveCombat).toBe(characterModule.isCharacterInActiveCombat);
    expect(pluginExports.isInSharedCombat).toBe(characterModule.isInSharedCombat);
    expect(pluginExports.staminaRecoveryEvent).toBe(characterModule.staminaRecoveryEvent);
    expect(pluginExports.staminaRecoveryEventForCommand).toBe(characterModule.staminaRecoveryEventForCommand);
    expect(pluginExports.vitalRecoveryPausedEvent).toBe(characterModule.vitalRecoveryPausedEvent);
  });

  it('provides the same character-state capability token on every registration', () => {
    const first = collectRegistrations();
    const second = collectRegistrations();

    expect(first.providedCapability).toBe(characterModule.characterStateCapability);
    expect(second.providedCapability).toBe(first.providedCapability);
    expect(first.providedImplementation).toEqual(expect.objectContaining({
      load: expect.any(Function),
    }));
  });
});
