import { describe, expect, it, vi } from 'vitest';
import { CharacterProjectionSchema } from '@mudd/contracts';
import { RuleViolationError } from '@mudd/engine-core';
import { partyCombatPolicyPlugin } from './party-combat-policy.js';

function character(id: string, overrides: Record<string, unknown> = {}) {
  return {
    ...CharacterProjectionSchema.parse({
      worldInstanceId: 'world-1',
      characterId: id,
      name: id,
      locationId: 'market',
      revision: 1,
      health: { current: 6, maximum: 6 },
    }),
    ...overrides,
  };
}

function harness(options: {
  party?: Record<string, unknown>;
  members?: Array<{ playerId: string; characterId: string; displayName: string }>;
  characters?: Record<string, unknown>;
  teamEvents?: Array<Record<string, unknown>>;
  pvpEvents?: Array<Record<string, unknown>>;
} = {}) {
  let policy: any;
  const characterLoads: string[] = [];
  const activePartyForPlayer = vi.fn(async () => options.party);
  const listActiveCharacters = vi.fn(async () => options.members ?? []);
  const characters = options.characters ?? {};
  partyCombatPolicyPlugin.register({
    requireCapability: (token: { id: string }) => {
      if (token.id === 'mudd.party.state.v1') return { activePartyForPlayer };
      if (token.id === 'mudd.character.state.v1') {
        return {
          load: vi.fn(async (_context: unknown, id: string) => {
            characterLoads.push(id);
            return characters[id];
          }),
        };
      }
      return { listActiveCharacters };
    },
    provideCapability: (_token: unknown, value: unknown) => { policy = value; },
  } as never);
  const context = {
    worldInstanceId: 'world-1',
    session: { playerId: 'player-1' },
    store: {
      readStream: vi.fn(async (_worldId: string, streamId: string) =>
        streamId === 'world-team-combat' ? (options.teamEvents ?? []) : (options.pvpEvents ?? [])),
    },
  };
  return { policy, context, activePartyForPlayer, listActiveCharacters, characterLoads };
}

const PARTY = {
  groupId: 'party-1',
  maxMembers: 3,
  members: [{ playerId: 'player-1' }, { playerId: 'player-2' }, { playerId: 'player-3' }],
};
const MEMBERS = [
  { playerId: 'player-2', characterId: 'char-2', displayName: 'Second' },
  { playerId: 'player-3', characterId: 'char-3', displayName: 'Third' },
  { playerId: 'player-4', characterId: 'char-outsider', displayName: 'Outsider' },
  { playerId: 'player-1', characterId: 'char-1', displayName: 'Initiator' },
];

describe('party combat roster policy', () => {
  it('returns no roster when the initiator has no active party', async () => {
    const { policy, context } = harness();
    await expect(policy.resolveIfPartyPresent(context, 'char-1', 'market')).resolves.toBeUndefined();
    await expect(policy.resolve(context, 'char-1', 'market')).rejects.toThrow(
      'Join or create a party before starting cooperative combat.',
    );
  });

  it('resolves eligible party members in stable order and respects the party size limit', async () => {
    const { policy, context, listActiveCharacters, characterLoads } = harness({
      party: PARTY,
      members: MEMBERS,
      characters: {
        'char-1': character('char-1'),
        'char-2': character('char-2'),
        'char-3': character('char-3'),
        'char-outsider': character('char-outsider'),
      },
    });
    const roster = await policy.resolveIfPartyPresent(context, 'char-1', 'market');
    expect(roster).toMatchObject({
      sourceGroupId: 'party-1',
      maxPlayers: 3,
      players: [
        { playerId: 'player-1', characterId: 'char-1' },
        { playerId: 'player-2', characterId: 'char-2' },
        { playerId: 'player-3', characterId: 'char-3' },
      ],
    });
    expect(listActiveCharacters).toHaveBeenCalledWith(context, 'market');
    expect(characterLoads).toEqual(['char-2', 'char-3', 'char-1']);
  });

  it('filters archived, misplaced, defeated, active-combat, and missing characters', async () => {
    const { policy, context } = harness({
      party: {
        ...PARTY,
        maxMembers: 8,
        members: Array.from({ length: 8 }, (_, index) => ({ playerId: `player-${index + 1}` })),
      },
      members: [
        { playerId: 'player-1', characterId: 'char-1', displayName: 'Initiator' },
        { playerId: 'player-2', characterId: 'archived', displayName: 'Archived' },
        { playerId: 'player-3', characterId: 'elsewhere', displayName: 'Elsewhere' },
        { playerId: 'player-4', characterId: 'defeated', displayName: 'Defeated' },
        { playerId: 'player-5', characterId: 'active', displayName: 'Active combat' },
        { playerId: 'player-6', characterId: 'defeat-combat', displayName: 'Defeated combat' },
        { playerId: 'player-7', characterId: 'missing', displayName: 'Missing' },
      ],
      teamEvents: [{ type: 'team.combat_started', payload: {} }],
      characters: {
        'char-1': character('char-1'),
        archived: character('archived', { archived: true }),
        elsewhere: character('elsewhere', { locationId: 'different-room' }),
        defeated: character('defeated', { health: { current: 0, maximum: 6 } }),
        active: character('active', { combat: { status: 'active' } }),
        'defeat-combat': character('defeat-combat', { combat: { status: 'defeat' } }),
      },
    });
    const roster = await policy.resolveIfPartyPresent(context, 'char-1', 'market');
    expect(roster?.players.map(({ characterId }: { characterId: string }) => characterId)).toEqual(['char-1']);
  });

  it('excludes active PvP participants and resolves the remaining party roster', async () => {
    const { policy, context } = harness({
      party: PARTY,
      members: MEMBERS,
      characters: {
        'char-1': character('char-1'),
        'char-2': character('char-2'),
        'char-3': character('char-3'),
        'char-outsider': character('char-outsider'),
      },
      pvpEvents: [{
        type: 'pvp.encounter.started',
        version: 1,
        aggregateVersion: 1,
        payload: {
          encounter: {
            encounterId: 'duel-one',
            requestId: 'request-one',
            locationId: 'market',
            participants: [
              { characterId: 'char-2', name: 'Second', health: 6, maximumHealth: 6 },
              { characterId: 'char-3', name: 'Third', health: 6, maximumHealth: 6 },
            ],
            turnCharacterId: 'char-2',
            round: 1,
            status: 'active',
            lastNarration: 'The duel begins.',
            updatedAt: '2026-10-27T12:00:00.000Z',
          },
        },
      }],
    });
    await expect(policy.resolve(context, 'char-1', 'market')).resolves.toMatchObject({
      sourceGroupId: 'party-1',
      players: [{ playerId: 'player-1', characterId: 'char-1' }],
    });
  });

  it('requires the initiator to be present, alive, and eligible', async () => {
    const absent = harness({ party: PARTY, members: [] });
    await expect(absent.policy.resolveIfPartyPresent(absent.context, 'char-1', 'market'))
      .rejects.toBeInstanceOf(RuleViolationError);
    const defeated = harness({
      party: PARTY,
      members: [{ playerId: 'player-1', characterId: 'char-1', displayName: 'Initiator' }],
      characters: { 'char-1': character('char-1', { health: { current: 0, maximum: 6 } }) },
    });
    await expect(defeated.policy.resolveIfPartyPresent(defeated.context, 'char-1', 'market'))
      .rejects.toThrow('You must be online, alive, and in this room to begin the party encounter.');
  });
});
