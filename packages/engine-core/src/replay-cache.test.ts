import { describe, expect, it } from 'vitest';
import {
  replayCharacter,
  replayCharacterUncached,
  retainCharacterReplayPrefix,
} from './replay.js';
import type { StoredGameEvent } from './types.js';

const event = (revision: number, name: string): StoredGameEvent => ({
  worldInstanceId: 'world', streamId: 'character', aggregateId: 'character',
  aggregateVersion: revision, eventId: `e-${revision}`, causationCommandId: `c-${revision}`,
  actorId: 'player', tick: revision, occurredAt: '2026-10-24T00:00:00.000Z',
  type: revision === 1 ? 'character.created' : 'character.renamed', version: 1,
  payload: revision === 1
    ? { characterId: 'character', playerId: 'player', name, startingLocationId: 'room' }
    : { characterId: 'character', name },
});

const eventWith = (
  revision: number,
  type: string,
  payload: Record<string, unknown>,
  version = 1,
): StoredGameEvent => ({
  ...event(revision, `Name ${revision}`),
  type,
  version,
  payload,
});

describe('character replay checkpoints', () => {
  it('matches cold replay for unchanged histories and incremental append', () => {
    const history = Array.from({ length: 2000 }, (_, i) => event(i + 1, `Name ${i}`));
    retainCharacterReplayPrefix(history);
    expect(replayCharacter(history)).toEqual(replayCharacterUncached(history));
    const copy = replayCharacter(history)!;
    copy.name = 'tampered'; copy.visitedLocationIds.push('unvisited');
    expect(replayCharacter(history)).toEqual(replayCharacterUncached(history));
    const next = [...history, event(2001, 'New name')];
    retainCharacterReplayPrefix(next, history);
    expect(replayCharacter(next)).toEqual(replayCharacterUncached(next));
    expect(replayCharacter(history)?.revision).toBe(2000);
  });
  it('does a cold replay for independently loaded history and checks tail continuity', () => {
    const history = [event(1, 'First')];
    retainCharacterReplayPrefix(history);
    replayCharacter(history);
    const independentlyLoaded = structuredClone([...history, event(2, 'Second')]);
    retainCharacterReplayPrefix(independentlyLoaded, history);
    expect(replayCharacter(independentlyLoaded)?.name).toBe('Second');
    const invalidTail = [...history, event(3, 'Third')];
    retainCharacterReplayPrefix(invalidTail, history);
    expect(() => replayCharacter(invalidTail)).toThrow('Non-contiguous');
  });
  it('never caches mutable caller-owned arrays or permits edits to registered history', () => {
    const mutable = [event(1, 'First')];
    expect(replayCharacter(mutable)?.name).toBe('First');
    mutable[0]!.payload.name = 'Edited';
    expect(replayCharacter(mutable)?.name).toBe('Edited');
    retainCharacterReplayPrefix(mutable);
    expect(() => { mutable[0]!.payload.name = 'Illegal'; }).toThrow();
  });

  it('isolates independent respawn tails from a cached team-defeat prefix', () => {
    const prefix = [
      event(1, 'Rowan'),
      eventWith(2, 'character.team_combat_outcome_applied', {
        characterId: 'character',
        encounterId: 'team-defeat',
        result: 'defeat',
        health: { current: 0, maximum: 6 },
        consumedItemIds: [],
      }),
    ];
    retainCharacterReplayPrefix(prefix);
    const defeat = replayCharacter(prefix);
    expect(defeat).toMatchObject({
      locationId: 'room',
      health: { current: 0, maximum: 6 },
    });

    const respawnTail = (locationId: string) => eventWith(3, 'character.respawned', {
      characterId: 'character',
      cause: 'team-pve',
      encounterId: 'team-defeat',
      deathLocationId: 'room',
      respawnLocationId: locationId,
      health: { current: 6, maximum: 6 },
    });
    const northbound = [...prefix, respawnTail('north-gate')];
    const southbound = [...prefix, respawnTail('south-gate')];
    retainCharacterReplayPrefix(northbound, prefix);
    retainCharacterReplayPrefix(southbound, prefix);

    const northProjection = replayCharacter(northbound);
    const southProjection = replayCharacter(southbound);
    expect(northProjection).toMatchObject({
      locationId: 'north-gate',
      health: { current: 6, maximum: 6 },
    });
    expect(southProjection).toMatchObject({
      locationId: 'south-gate',
      health: { current: 6, maximum: 6 },
    });
    expect(replayCharacter(prefix)).toMatchObject({
      locationId: 'room',
      health: { current: 0, maximum: 6 },
    });
    expect(northProjection).toEqual(replayCharacterUncached(northbound));
    expect(southProjection).toEqual(replayCharacterUncached(southbound));
  });

  it('retains a spent ability action ID when replaying an appended checkpoint tail', () => {
    const created = eventWith(1, 'character.created', {
      characterId: 'character',
      playerId: 'player',
      name: 'Rowan',
      startingLocationId: 'room',
      attributes: { strength: 10, intelligence: 10, constitution: 10, dexterity: 10 },
      characterClass: {
        id: 'scout',
        revision: 1,
        catalogId: 'catalog',
        catalogRevision: 1,
        label: 'Scout',
        description: 'A replay fixture.',
        primaryAttribute: 'dexterity',
        attributes: { strength: 10, intelligence: 10, constitution: 10, dexterity: 10 },
        coreAction: {
          id: 'quick-strike',
          revision: 1,
          label: 'Quick strike',
          description: 'A test action.',
          cost: { resource: 'stamina', amount: 2 },
          baseDamage: 1,
          scalingAttribute: 'dexterity',
          weaponBonus: false,
        },
      },
      health: { current: 6, maximum: 6 },
      resources: {
        stamina: { current: 10, maximum: 10 },
        mana: { current: 10, maximum: 10 },
      },
    }, 3);
    const firstSpend = eventWith(2, 'character.ability_resource_spent', {
      characterId: 'character',
      encounterId: 'encounter-one',
      actionId: 'action-one',
      abilityId: 'quick-strike',
      abilityRevision: 1,
      cost: { resource: 'stamina', amount: 2 },
      remaining: 8,
    });
    const prefix = [created, firstSpend];
    retainCharacterReplayPrefix(prefix);
    expect(replayCharacter(prefix)?.resources.stamina.current).toBe(8);

    const duplicateSpend = eventWith(3, 'character.ability_resource_spent', {
      ...firstSpend.payload,
      encounterId: 'encounter-two',
      remaining: 6,
    });
    const duplicateHistory = [...prefix, duplicateSpend];
    retainCharacterReplayPrefix(duplicateHistory, prefix);
    const expected = 'Invalid ability resource spending.';

    expect(() => replayCharacter(duplicateHistory)).toThrow(expected);
    expect(() => replayCharacterUncached(duplicateHistory)).toThrow(expected);
  });

  it('replays a team victory prefix and appended advancement with cold parity', () => {
    const prefix = [
      event(1, 'Rowan'),
      eventWith(2, 'character.team_combat_outcome_applied', {
        characterId: 'character',
        encounterId: 'team-victory',
        result: 'victory',
        health: { current: 4, maximum: 6 },
        consumedItemIds: [],
      }),
    ];
    retainCharacterReplayPrefix(prefix);
    expect(replayCharacter(prefix)?.advancement).toBeUndefined();

    const history = [
      ...prefix,
      eventWith(3, 'character.advancement_awarded', {
        characterId: 'character',
        encounterId: 'team-victory',
        experienceAwarded: 10,
        totalExperience: 10,
        level: 2,
        maximumHealth: 8,
        source: 'team-pve',
      }, 2),
    ];
    retainCharacterReplayPrefix(history, prefix);

    const projected = replayCharacter(history);
    expect(projected?.advancement).toEqual({
      experience: 10,
      level: 2,
      lastRewardedEncounterId: 'team-victory',
    });
    expect(projected).toEqual(replayCharacterUncached(history));
  });
});
