import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GameSnapshotSchema } from '@mudd/client-sdk';
import { parseWorldCommand, type ActionIntent } from './intents.js';
import { useActionDispatch } from './use-action-dispatch.js';
import { readableObjectsForQuickActions } from '../features/inventory/action-selectors.js';

function fixture() {
  return GameSnapshotSchema.parse({ player: { id: 'player', displayName: 'Player' },
    character: { characterId: 'character', worldInstanceId: 'world', name: 'Arin', locationId: 'room', revision: 0 },
    location: { worldInstanceId: 'world', locationId: 'room', revision: 0, title: 'Room', shortName: 'Room',
      qualifiedName: 'Room', locationGroups: [], description: 'Room', exits: [], occupants: [], objects: [
        { id: 'first', label: 'Bulletin board', description: 'One', readable: true, takeable: false,
          readAction: { type: 'daily-board', boardId: 'one' } },
        { id: 'second', label: 'Bulletin board', description: 'Two', readable: true, takeable: false,
          readAction: { type: 'daily-board', boardId: 'two' } },
        { id: 'ordinary', label: 'Bulletin board', description: 'Text', readable: true, takeable: false },
      ] }, dailyActivities: { cycle: '2026-11-02', boards: [{ id: 'one', name: 'Jobs' }, { id: 'two', name: 'Jobs' }], sources: [] },
  });
}

describe('semantic read dispatch', () => {
  it('uses exact board identity and keeps unrelated same-named objects as ordinary text', async () => {
    const snapshot = fixture();
    const openDailyBoard = vi.fn(async () => undefined), readObject = vi.fn(async () => undefined);
    const options = { snapshot, openDailyBoard, pending: false, listingIds: [], inventory: { readObject }, addEntry: vi.fn() } as unknown as Parameters<typeof useActionDispatch>[0];
    const { result } = renderHook(() => useActionDispatch(options));
    await result.current(parseWorldCommand('read second', snapshot) as ActionIntent);
    expect(openDailyBoard).toHaveBeenCalledExactlyOnceWith('two');
    expect(readObject).not.toHaveBeenCalled();
    await result.current(parseWorldCommand('read ordinary', snapshot) as ActionIntent);
    expect(readObject).toHaveBeenCalledExactlyOnceWith('ordinary');
    expect(readableObjectsForQuickActions(snapshot).map((object) => object.id)).toEqual(['ordinary']);
  });

  it.each(['removed', 'association', 'location', 'character', 'world', 'board unavailable'])('rejects stale %s without substituting a target', async (change) => {
    const original = fixture();
    const intent = parseWorldCommand('read second', original) as ActionIntent;
    const snapshot = structuredClone(original);
    if (change === 'removed') snapshot.location!.objects[1]!.id = 'replacement';
    if (change === 'association') snapshot.location!.objects[1]!.readAction = { type: 'daily-board', boardId: 'one' };
    if (change === 'location') snapshot.location!.locationId = 'elsewhere';
    if (change === 'character') snapshot.character!.characterId = 'other';
    if (change === 'world') snapshot.character!.worldInstanceId = 'other';
    if (change === 'board unavailable') snapshot.dailyActivities!.boards = snapshot.dailyActivities!.boards.slice(0, 1);
    const openDailyBoard = vi.fn(), readObject = vi.fn(), addEntry = vi.fn();
    const { result } = renderHook(() => useActionDispatch({ snapshot, openDailyBoard, pending: false, listingIds: [],
      inventory: { readObject }, addEntry } as unknown as Parameters<typeof useActionDispatch>[0]));
    await result.current(intent);
    expect(openDailyBoard).not.toHaveBeenCalled();
    expect(readObject).not.toHaveBeenCalled();
    expect(addEntry).toHaveBeenCalledWith('error', expect.stringContaining('no longer available'));
  });
});
