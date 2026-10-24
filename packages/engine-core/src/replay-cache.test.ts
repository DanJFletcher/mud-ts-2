import { describe, expect, it } from 'vitest';
import { replayCharacter, replayCharacterUncached, retainCharacterReplayPrefix } from './replay.js';
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
});
