import { describe, expect, it, vi } from 'vitest';
import { CharacterClassCatalogSchema, CharacterProjectionSchema } from '@mudd/contracts';
import { replayCharacter, RuleViolationError, type EngineCommandContext } from '@mudd/engine-core';
import {
  classAdoptionGuards,
  classCombatPolicyCapability,
  createClassRulesetPlugin,
} from './classes.js';

const replayCharacterMock = vi.hoisted(() => vi.fn());
vi.mock('@mudd/engine-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mudd/engine-core')>();
  return { ...actual, replayCharacter: replayCharacterMock };
});

const catalog = CharacterClassCatalogSchema.parse({
  id: 'test-classes',
  revision: 1,
  classes: [
    {
      id: 'vanguard',
      revision: 1,
      label: 'Vanguard',
      description: 'A steady front-line fighter.',
      primaryAttribute: 'strength',
      attributes: { strength: 15, intelligence: 10, constitution: 15, dexterity: 10 },
      coreAction: {
        id: 'heavy-strike',
        revision: 1,
        label: 'Heavy Strike',
        description: 'A forceful blow.',
        cost: { resource: 'stamina', amount: 2 },
        baseDamage: 4,
        scalingAttribute: 'strength',
        weaponBonus: true,
      },
    },
    {
      id: 'kindler',
      revision: 1,
      label: 'Kindler',
      description: 'A focused practitioner.',
      primaryAttribute: 'intelligence',
      attributes: { strength: 10, intelligence: 15, constitution: 10, dexterity: 15 },
      coreAction: {
        id: 'directed-heat',
        revision: 1,
        label: 'Directed Heat',
        description: 'A bounded working.',
        cost: { resource: 'mana', amount: 3 },
        baseDamage: 5,
        scalingAttribute: 'intelligence',
        weaponBonus: false,
      },
    },
  ],
});

function commandContext(streams: Record<string, Array<Record<string, unknown>>> = {}) {
  return {
    worldInstanceId: 'world-1',
    store: {
      readStream: vi.fn(async (_worldId: string, streamId: string) => streams[streamId] ?? []),
    },
  } as unknown as EngineCommandContext;
}

function encounterEvent(encounterId: string, status: string, characterId = 'hero') {
  return {
    aggregateVersion: 3,
    type: 'team.encounter_updated',
    payload: {
      encounter: {
        encounterId,
        status,
        participants: [{ characterId }],
      },
    },
  };
}

describe('class ruleset plugin', () => {
  it('selects a catalog class as an isolated, versioned snapshot', () => {
    const plugin = createClassRulesetPlugin(catalog);
    let policy: any;
    plugin.register({
      provideCapability: (token: { id: string }, value: unknown) => {
        if (token.id === classCombatPolicyCapability.id) policy = value;
      },
      registerCommand: vi.fn(),
    } as never);

    const selected = policy.select('vanguard');
    expect(selected).toMatchObject({
      id: 'vanguard',
      catalogId: 'test-classes',
      catalogRevision: 1,
    });
    selected.attributes.strength = 1;
    expect(policy.catalog.classes[0].attributes.strength).toBe(15);
    expect(() => policy.select('missing')).toThrow(RuleViolationError);
    expect(() => plugin.validateWorld!({ classCatalog: { id: 'other' } } as never, {} as never))
      .toThrow('Class ruleset capability must match the selected world catalog.');
    expect(() => plugin.validateWorld!({ classCatalog: catalog } as never, {} as never)).not.toThrow();
  });

  it('resolves owned class abilities with resource costs and weapon-aware damage', () => {
    const plugin = createClassRulesetPlugin(catalog);
    let policy: any;
    plugin.register({
      provideCapability: (_token: unknown, value: unknown) => { policy = value; },
      registerCommand: vi.fn(),
    } as never);
    const vanguard = policy.select('vanguard');
    const hero = CharacterProjectionSchema.parse({
      worldInstanceId: 'world-1',
      characterId: 'hero',
      name: 'Hero',
      locationId: 'market',
      revision: 1,
      characterClass: vanguard,
      attributes: { strength: 20, intelligence: 10, constitution: 10, dexterity: 10 },
      resources: { stamina: { current: 8, maximum: 10 }, mana: { current: 5, maximum: 5 } },
      inventory: [{
        id: 'sword',
        label: 'Iron sword',
        description: 'A plain sword.',
        equipment: { slot: 'weapon', attackBonus: 3 },
      }],
      equipment: { weaponItemId: 'sword', armorItemId: 'no-armor' },
    });

    expect(policy.resolve(hero, 'heavy-strike', 'encounter-1', 'action-1')).toMatchObject({
      damage: 9,
      event: {
        type: 'character.ability_resource_spent',
        payload: { characterId: 'hero', remaining: 6, abilityId: 'heavy-strike' },
      },
    });
    const kindler = CharacterProjectionSchema.parse({
      ...hero,
      characterClass: policy.select('kindler'),
      attributes: { strength: 10, intelligence: 20, constitution: 10, dexterity: 10 },
      resources: { stamina: { current: 1, maximum: 1 }, mana: { current: 4, maximum: 5 } },
    });
    expect(policy.resolve(kindler, 'directed-heat', 'encounter-1', 'action-2'))
      .toMatchObject({ damage: 7, event: { payload: { remaining: 1 } } });
    expect(() => policy.resolve(hero, 'not-owned', 'encounter-1', 'action-3'))
      .toThrow('ABILITY_NOT_OWNED');
    expect(() => policy.resolve(kindler, 'heavy-strike', 'encounter-1', 'action-4'))
      .toThrow('ABILITY_NOT_OWNED');
    const exhausted = CharacterProjectionSchema.parse({
      ...hero,
      resources: { stamina: { current: 1, maximum: 10 }, mana: { current: 5, maximum: 5 } },
    });
    expect(() => policy.resolve(exhausted, 'heavy-strike', 'encounter-1', 'action-5'))
      .toThrow('ABILITY_RESOURCE_LOW');
  });

  it('registers the class capability and class-selection command', () => {
    const plugin = createClassRulesetPlugin(catalog);
    const provideCapability = vi.fn();
    const registerCommand = vi.fn();
    plugin.register({ provideCapability, registerCommand } as never);
    expect(provideCapability).toHaveBeenCalledWith(classCombatPolicyCapability, expect.any(Object));
    expect(registerCommand).toHaveBeenCalledWith(
      'character.class.choose',
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('adopts a class without healing and returns optimistic stream guards', async () => {
    const plugin = createClassRulesetPlugin(catalog);
    let choose: ((command: any, context: any) => Promise<unknown>) | undefined;
    plugin.register({
      provideCapability: vi.fn(),
      registerCommand: (_name: string, _schema: unknown, handler: (command: any, context: any) => Promise<unknown>) => {
        choose = handler;
      },
    } as never);
    replayCharacterMock.mockReturnValue({
      characterId: 'hero',
      archived: false,
      attributes: { strength: 10, intelligence: 10, constitution: 10, dexterity: 10 },
      advancement: { level: 1 },
      health: { current: 3, maximum: 8 },
    });
    const context = commandContext({
      'world-team-combat': [{ aggregateVersion: 2, type: 'team.changed', payload: {} }],
      'world-interactions:world-1': [{ aggregateVersion: 4, type: 'interaction.changed', payload: {} }],
    });
    const result = await choose!({
      characterId: 'hero',
      expectedVersion: 5,
      payload: { classId: 'vanguard' },
    }, context) as any;
    expect(replayCharacter).toHaveBeenCalled();
    expect(result).toMatchObject({
      streamId: 'hero',
      expectedVersion: 5,
      guards: [
        { streamId: 'world-team-combat', expectedVersion: 2 },
        { streamId: 'world-interactions:world-1', expectedVersion: 4 },
      ],
      events: [{
        type: 'character.class_selected',
        payload: {
          characterId: 'hero',
          characterClass: { id: 'vanguard', catalogId: 'test-classes' },
          health: { current: 3 },
        },
      }],
    });
  });

  it('rejects unavailable, archived, already-classed, defeated, or fighting characters', async () => {
    const plugin = createClassRulesetPlugin(catalog);
    let choose: ((command: any, context: any) => Promise<unknown>) | undefined;
    plugin.register({
      provideCapability: vi.fn(),
      registerCommand: (_name: string, _schema: unknown, handler: (command: any, context: any) => Promise<unknown>) => {
        choose = handler;
      },
    } as never);
    const context = commandContext();
    const command = { characterId: 'hero', expectedVersion: 0, payload: { classId: 'vanguard' } };

    replayCharacterMock.mockReturnValue(undefined);
    await expect(choose!(command, context)).rejects.toThrow('CLASS_CHARACTER_UNAVAILABLE');
    replayCharacterMock.mockReturnValue({ characterId: 'hero', archived: true });
    await expect(choose!(command, context)).rejects.toThrow('CLASS_CHARACTER_UNAVAILABLE');
    replayCharacterMock.mockReturnValue({ characterId: 'hero', characterClass: { id: 'existing' } });
    await expect(choose!(command, context)).rejects.toThrow('CLASS_ALREADY_SELECTED');
    replayCharacterMock.mockReturnValue({
      characterId: 'hero',
      attributes: { constitution: 10 },
      health: { current: 0, maximum: 8 },
    });
    await expect(choose!(command, context)).rejects.toThrow('CLASS_COMBAT_ACTIVE');
    replayCharacterMock.mockReturnValue({
      characterId: 'hero',
      attributes: { constitution: 10 },
      health: { current: 4, maximum: 8 },
      combat: { status: 'active' },
    });
    await expect(choose!(command, context)).rejects.toThrow('CLASS_COMBAT_ACTIVE');
  });
});

describe('class adoption guards', () => {
  it('returns stream-version guards when no shared combat blocks adoption', async () => {
    const context = commandContext({
      'hero': [{ aggregateVersion: 2, type: 'character.created', payload: {} }],
      'world-team-combat': [{ aggregateVersion: 4, type: 'team.encounter_updated', payload: {} }],
      'world-interactions:world-1': [{ aggregateVersion: 7, type: 'interaction.changed', payload: {} }],
    });
    await expect(classAdoptionGuards(context, 'hero')).resolves.toEqual([
      { streamId: 'world-team-combat', expectedVersion: 4 },
      { streamId: 'world-interactions:world-1', expectedVersion: 7 },
    ]);
  });

  it('rejects active shared encounters but skips the stream authorized by its caller', async () => {
    const team = encounterEvent('team-1', 'active');
    const context = commandContext({ 'world-team-combat': [team] });
    await expect(classAdoptionGuards(context, 'hero')).rejects.toThrow(
      'CLASS_COMBAT_ACTIVE: Choose a class outside active combat.',
    );
    await expect(classAdoptionGuards(context, 'hero', 'world-team-combat')).resolves.toEqual([
      { streamId: 'world-team-combat', expectedVersion: 3 },
      { streamId: 'world-interactions:world-1', expectedVersion: 0 },
    ]);
  });

  it('blocks a team class change until its combat outcome is applied', async () => {
    const context = commandContext({
      'world-team-combat': [encounterEvent('team-1', 'completed')],
    });
    await expect(classAdoptionGuards(context, 'hero')).rejects.toThrow(
      'CLASS_COMBAT_ACTIVE: Wait for the combat outcome to finish before choosing a class.',
    );

    const resolved = commandContext({
      hero: [{
        aggregateVersion: 6,
        type: 'character.team_combat_outcome_applied',
        payload: { encounterId: 'team-1' },
      }],
      'world-team-combat': [encounterEvent('team-1', 'completed')],
    });
    await expect(classAdoptionGuards(resolved, 'hero')).resolves.toHaveLength(2);
  });

  it('uses only the latest encounter state and blocks active player interactions', async () => {
    const context = commandContext({
      'world-interactions:world-1': [encounterEvent('pvp-1', 'resolving')],
    });
    await expect(classAdoptionGuards(context, 'hero')).rejects.toThrow(
      'CLASS_COMBAT_ACTIVE: Choose a class outside active combat.',
    );
    const noLongerActive = commandContext({
      'world-team-combat': [
        encounterEvent('team-1', 'active'),
        encounterEvent('team-1', 'completed'),
      ],
    });
    const outcomeApplied = commandContext({
      hero: [{
        aggregateVersion: 6,
        type: 'character.team_combat_outcome_applied',
        payload: { encounterId: 'team-1' },
      }],
      'world-team-combat': [
        encounterEvent('team-1', 'active'),
        encounterEvent('team-1', 'completed'),
      ],
    });
    await expect(classAdoptionGuards(noLongerActive, 'hero')).rejects.toThrow(
      'CLASS_COMBAT_ACTIVE: Wait for the combat outcome to finish before choosing a class.',
    );
    await expect(classAdoptionGuards(outcomeApplied, 'hero')).resolves.toHaveLength(2);
  });
});
