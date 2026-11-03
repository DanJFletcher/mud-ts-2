import { describe, expect, it, vi } from 'vitest';
import { ORRAVETH_WORLD_INSTANCE_ID } from '@mudd/world-orraveth';
import { useServerHarness, state, instanceId } from './server-harness.js';

describe('game-commands-queries through the server', () => {
  const harness = useServerHarness();
  const { sendWorldCommand, enterWorld, move, readRoom } = harness;
  it('validates character command schemas and selected-world ownership before dispatch', async () => {
    const postCommand = (body: unknown) => fetch(`${harness.baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify(body),
    });

    const wrongWorld = await postCommand({
      type: 'character.create',
      version: 1,
      commandId: 'wrong-world-command',
      worldInstanceId: 'another-world',
      payload: { name: 'Rill' },
    });
    expect(wrongWorld.status).toBe(400);
    expect(await wrongWorld.json()).toEqual({
      message: 'Choose a command for the selected world.',
    });

    for (const type of [
      'character.create',
      'character.rename',
      'character.archive',
      'character.restore',
    ]) {
      const invalid = await postCommand({ type, worldInstanceId: instanceId });
      expect(invalid.status, type).toBe(400);
      expect(await invalid.json()).toMatchObject({ message: expect.stringContaining('Invalid character') });
    }
  });

  it('rejects archiving the active character and commands for another player’s character', async () => {
    await enterWorld('alice', 'character-alice');
    const postCommand = (body: unknown) => fetch(`${harness.baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify(body),
    });

    const archive = await postCommand({
      type: 'character.archive',
      version: 1,
      commandId: 'archive-active-character',
      worldInstanceId: instanceId,
      characterId: 'character-alice',
      expectedVersion: 0,
      payload: {},
    });
    expect(archive.status).toBe(409);
    expect(await archive.json()).toEqual({
      message: 'Leave the world before archiving this character.',
    });

    const rename = await postCommand({
      type: 'character.rename',
      version: 1,
      commandId: 'rename-bobs-character',
      worldInstanceId: instanceId,
      characterId: 'character-bob',
      expectedVersion: 0,
      payload: { name: 'Not Alice’s character' },
    });
    expect(rename.status).toBe(404);
    expect(await rename.json()).toEqual({
      message: 'That character does not belong to this world.',
    });
  });

  it('returns a request-scoped server error for command dispatch failures', async () => {
    state.nextCommandResult = {
      receipt: {
        ok: false,
        code: 'INTERNAL_ERROR',
        message: 'The command failed in the engine.',
      },
      commitOutcome: 'committed',
      commandId: 'failed-create',
    };
    const response = await fetch(`${harness.baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify({
        type: 'character.create',
        version: 1,
        commandId: 'failed-create',
        worldInstanceId: instanceId,
        payload: { name: 'Rill' },
      }),
    });

    expect(response.status).toBe(500);
    const body = await response.json() as { message: string; requestId: string; };
    expect(body.message).toBe('The command failed in the engine.');
    expect(body.requestId).toEqual(expect.any(String));
  });

  it('routes thrown command dispatch errors through the request error handler', async () => {
    state.dispatchError = new Error('Engine dispatch threw.');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await fetch(`${harness.baseUrl}/api/commands`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-user': 'alice',
        },
        body: JSON.stringify({
          type: 'character.create',
          version: 1,
          commandId: 'throwing-command',
          worldInstanceId: instanceId,
          payload: { name: 'Rill' },
        }),
      });

      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({
        message: 'The game server could not complete that request.',
        requestId: response.headers.get('x-request-id'),
      });
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining('Request failed'),
        expect.any(Error),
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it('keeps game, chat, and interaction stream read failures behind the request error handler', async () => {
    await enterWorld('alice', 'character-alice');
    state.readStreamError = new Error('Stream read failed.');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (const path of [
        '/api/game',
        '/api/chat?roomId=npc-room',
        '/api/interactions',
      ]) {
        const response = await fetch(`${harness.baseUrl}${path}`, {
          headers: { 'x-test-user': 'alice' },
        });
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({
          message: 'The game server could not complete that request.',
          requestId: response.headers.get('x-request-id'),
        });
      }
      expect(errorLog).toHaveBeenCalledTimes(3);
    } finally {
      state.readStreamError = null;
      errorLog.mockRestore();
    }
  });

  it('fails closed when party or team-combat prechecks return invalid projections', async () => {
    await enterWorld('alice', 'character-alice');
    const postCommand = (body: unknown) => fetch(`${harness.baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify(body),
    });
    const movement = {
      type: 'character.move',
      version: 1,
      worldInstanceId: instanceId,
      characterId: 'character-alice',
      expectedVersion: 0,
      payload: { exitId: 'exit-north' },
    };
    state.queryOverrides.set('team.combat.info', { ok: true, value: {} });

    const invalidTeamStatus = await postCommand({
      ...movement,
      commandId: 'invalid-team-status',
    });
    expect(invalidTeamStatus.status).toBe(500);
    expect(await invalidTeamStatus.json()).toEqual({
      message: 'The team combat state could not be checked.',
    });

    state.queryOverrides.delete('team.combat.info');
    state.queryOverrides.set('party.info', { ok: true, value: {} });
    const invalidPartyStatus = await postCommand({
      type: 'combat.action',
      version: 1,
      commandId: 'invalid-party-status',
      worldInstanceId: instanceId,
      characterId: 'character-alice',
      expectedVersion: 0,
      payload: { action: 'attack', targetNpcId: 'wild-deer' },
    });
    expect(invalidPartyStatus.status).toBe(500);
    expect(await invalidPartyStatus.json()).toEqual({
      message: 'The party status could not be checked before combat.',
    });
  });

  it('routes party members to cooperative controls instead of solo combat', async () => {
    await enterWorld('alice', 'character-alice');
    state.queryOverrides.set('party.info', {
      ok: true,
      value: {
        party: {
          groupId: 'party-one',
          groupType: 'party',
          ownerPlayerId: 'player-alice',
          maxMembers: 4,
          isPublic: false,
          status: 'active',
          members: [{
            playerId: 'player-alice',
            characterId: 'character-alice',
            displayName: 'Alice',
          }],
          createdAt: '2026-10-28T12:00:00.000Z',
          leaderName: 'Alice',
        },
        revision: 1,
        activity: [],
      },
    });
    const response = await fetch(`${harness.baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify({
        type: 'combat.action',
        version: 1,
        commandId: 'party-solo-attack',
        worldInstanceId: instanceId,
        characterId: 'character-alice',
        expectedVersion: 0,
        payload: { action: 'attack', targetNpcId: 'wild-deer' },
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      message: 'Use the cooperative encounter controls to begin combat with your party.',
    });
  });

  it('keeps a successful move response when its location projection fails or throws', async () => {
    await enterWorld('mover', 'character-mover');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      state.queryOverrides.set('location.describe', {
        ok: false,
        code: 'NOT_FOUND',
        message: 'The location could not be described.',
      });
      const unavailableProjection = await move(
        'mover',
        'character-mover',
        'to-arrival-room',
        'move-with-unavailable-projection',
      );
      expect(unavailableProjection.status).toBe(200);
      expect(await unavailableProjection.json()).not.toHaveProperty('movementProjection');

      state.queryOverrides.set('location.describe', () => {
        throw new Error('Projection service unavailable.');
      });
      const thrownProjection = await move(
        'mover',
        'character-mover',
        'back-to-entry',
        'move-with-thrown-projection',
      );
      expect(thrownProjection.status).toBe(200);
      expect(await thrownProjection.json()).not.toHaveProperty('movementProjection');

      state.queryOverrides.delete('location.describe');
      state.queryOverrides.set('character.stats', { ok: true, value: {} });
      const invalidProjection = await move(
        'mover',
        'character-mover',
        'to-arrival-room',
        'move-with-invalid-projection',
      );
      expect(invalidProjection.status).toBe(200);
      expect(await invalidProjection.json()).not.toHaveProperty('movementProjection');
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('movement_projection_unavailable'));
      expect(warning).toHaveBeenCalledTimes(3);
      const schemaWarning = JSON.parse(warning.mock.calls[2]?.[0] as string) as {
        schemaIssues?: Array<{ path: string; code: string; }>;
      };
      expect(schemaWarning.schemaIssues?.length).toBeGreaterThan(0);
      state.queryOverrides.delete('character.stats');
    } finally {
      warning.mockRestore();
    }
  });

  it('settles and returns the game projection with world commands only for clients that ask', async () => {
    await enterWorld('alice', 'character-alice');
    state.nextCommandResult = {
      receipt: { ok: true, commandId: 'take-with-projection' },
      commitOutcome: 'committed',
      completingEffects: 1,
    };
    const withProjection = await sendWorldCommand('alice', {
      type: 'character.take',
      commandId: 'take-with-projection',
      characterId: 'character-alice',
      payload: { itemId: 'shared-lantern' },
    }, { projection: true });

    expect(withProjection.status).toBe(200);
    const body = await withProjection.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      receipt: { ok: true, commandId: 'take-with-projection' },
      gameProjection: {
        character: { characterId: 'character-alice', locationId: 'npc-room' },
        location: { locationId: 'npc-room' },
      },
    });
    expect(body).not.toHaveProperty('movementProjection');
    expect(body).not.toHaveProperty('completingEffects');
    expect(state.settledCommands).toEqual([{
      session: expect.objectContaining({ actorId: 'player-alice', worldInstanceId: instanceId }),
      result: expect.objectContaining({ completingEffects: 1 }),
    }]);

    // Without the header the response is unchanged and nothing settles early,
    // but the background worker still starts for the command's effects.
    const effectBatchesBefore = state.processPendingEffectsStarted;
    const withoutProjection = await sendWorldCommand('alice', {
      type: 'character.take',
      commandId: 'take-without-projection',
      characterId: 'character-alice',
      payload: { itemId: 'shared-lantern' },
    });
    expect(withoutProjection.status).toBe(200);
    expect(await withoutProjection.json()).toEqual({ receipt: { ok: true }, commitOutcome: 'committed' });
    expect(state.settledCommands).toHaveLength(1);
    await vi.waitFor(() => expect(state.processPendingEffectsStarted).toBeGreaterThan(effectBatchesBefore));
  });

  it('includes a settled victory corpse and its loot in the same game projection', async () => {
    await enterWorld('alice', 'character-alice');
    const corpse = {
      id: 'corpse:practice-sentinel',
      label: 'Practice Sentinel’s corpse',
      description: 'The body of the Practice Sentinel lies here.',
      readable: false,
      takeable: false,
      containerKind: 'corpse',
      contents: [{
        id: 'corpse-item:practice-badge',
        label: 'Practice badge',
        description: 'A small wooden badge.',
      }],
    };
    state.queryOverrides.set('location.describe', () => ({
      ok: true,
      value: {
        worldInstanceId: instanceId,
        locationId: 'npc-room',
        revision: 0,
        title: 'NPC Room',
        shortName: 'NPC Room',
        qualifiedName: 'NPC Room',
        locationGroups: [],
        description: 'A quiet test room.',
        exits: [],
        objects: state.settledCommands.length > 0 ? [corpse] : [],
        occupants: [],
        safeResting: false,
      },
    }));
    state.nextCommandResult = {
      receipt: { ok: true, commandId: 'victory-with-corpse-projection' },
      commitOutcome: 'committed',
      completingEffects: 1,
    };

    const response = await sendWorldCommand('alice', {
      type: 'combat.action',
      commandId: 'victory-with-corpse-projection',
      characterId: 'character-alice',
      payload: { action: 'attack', targetNpcId: 'mara' },
    }, { projection: true });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      gameProjection?: { location?: { objects?: Array<Record<string, unknown>>; }; };
    };
    expect(body.gameProjection?.location?.objects).toEqual([corpse]);
    expect(state.settledCommands).toHaveLength(1);
    expect(state.settledCommands[0]?.result).toMatchObject({ completingEffects: 1 });
  });

  it('withholds the projection when a command’s own effects cannot be settled', async () => {
    await enterWorld('alice', 'character-alice');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const drop = (commandId: string) => sendWorldCommand('alice', {
      type: 'character.drop',
      commandId,
      characterId: 'character-alice',
      payload: { itemId: 'shared-lantern' },
    }, { projection: true });
    try {
      state.settleCommandEffectsResult = false;
      state.nextCommandResult = {
        receipt: { ok: true, commandId: 'drop-unsettled' },
        commitOutcome: 'committed',
        completingEffects: 1,
      };
      const unsettled = await drop('drop-unsettled');
      expect(unsettled.status).toBe(200);
      expect(await unsettled.json()).not.toHaveProperty('gameProjection');
      expect(info).toHaveBeenCalledWith(expect.stringContaining('"event":"command_projection_deferred"'));
      expect(info).toHaveBeenLastCalledWith(expect.stringContaining('"reason":"effects_unsettled"'));

      state.settleCommandEffectsError = new Error('Effect claim failed.');
      state.nextCommandResult = {
        receipt: { ok: true, commandId: 'drop-claim-failure' },
        commitOutcome: 'committed',
        completingEffects: 1,
      };
      const failedClaim = await drop('drop-claim-failure');
      expect(failedClaim.status).toBe(200);
      expect(await failedClaim.json()).toMatchObject({ receipt: { ok: true, commandId: 'drop-claim-failure' } });
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('"event":"command_effects_unsettled"'));

      // A duplicate cannot report its original's effects, so it is not projected.
      const settledBefore = state.settledCommands.length;
      state.nextCommandResult = { receipt: { ok: true, commandId: 'drop-retried' }, commitOutcome: 'duplicate' };
      const duplicate = await drop('drop-retried');
      expect(await duplicate.json()).not.toHaveProperty('gameProjection');
      expect(state.settledCommands).toHaveLength(settledBefore);
      expect(info).toHaveBeenLastCalledWith(expect.stringContaining('"reason":"duplicate"'));

      // With nothing to settle, the engine is not asked and the projection follows.
      state.settleCommandEffectsResult = true;
      state.nextCommandResult = {
        receipt: { ok: true, commandId: 'equip-without-effects' },
        commitOutcome: 'committed',
        completingEffects: 0,
      };
      const noEffects = await sendWorldCommand('alice', {
        type: 'character.equip',
        commandId: 'equip-without-effects',
        characterId: 'character-alice',
        payload: { itemId: 'practice-sword' },
      }, { projection: true });
      expect(await noEffects.json()).toHaveProperty('gameProjection.location.locationId', 'npc-room');
      expect(state.settledCommands).toHaveLength(settledBefore);

      state.queryOverrides.set('location.describe', {
        ok: false,
        code: 'NOT_FOUND',
        message: 'The location could not be described.',
      });
      const unavailable = await sendWorldCommand('alice', {
        type: 'character.stand',
        commandId: 'stand-without-location',
        characterId: 'character-alice',
      }, { projection: true });
      expect(unavailable.status).toBe(200);
      expect(await unavailable.json()).not.toHaveProperty('gameProjection');
      expect(warning).toHaveBeenLastCalledWith(expect.stringContaining('"event":"command_projection_unavailable"'));
      state.queryOverrides.delete('location.describe');
    } finally {
      info.mockRestore();
      warning.mockRestore();
    }
  });

  it('returns opted-in moves the game projection field and keeps it for older clients', async () => {
    await enterWorld('mover', 'character-mover');
    const projected = await sendWorldCommand('mover', {
      type: 'character.move',
      commandId: 'projected-move',
      characterId: 'character-mover',
      payload: { exitId: 'to-quiet-room' },
    }, { projection: true });
    expect(projected.status).toBe(200);
    const projectedBody = await projected.json() as Record<string, unknown>;
    expect(projectedBody).toHaveProperty('gameProjection.location.locationId', 'quiet-room');
    expect(projectedBody).not.toHaveProperty('movementProjection');

    // A retried move is still projected, as before.
    const retried = await sendWorldCommand('mover', {
      type: 'character.move',
      commandId: 'projected-move',
      characterId: 'character-mover',
      payload: { exitId: 'to-quiet-room' },
    }, { projection: true });
    expect(await retried.json()).toMatchObject({
      commitOutcome: 'duplicate',
      gameProjection: { location: { locationId: 'quiet-room' } },
    });

    const legacy = await move('mover', 'character-mover', 'back-to-entry');
    const legacyBody = await legacy.json() as Record<string, unknown>;
    expect(legacyBody).toHaveProperty('movementProjection.location.locationId', 'entry-room');
    expect(legacyBody).not.toHaveProperty('gameProjection');
    expect(state.settledCommands).toEqual([]);
  });

  it('returns a game snapshot only after a character enters the world', async () => {
    const headers = { 'x-test-user': 'alice' };
    const unavailable = await fetch(`${harness.baseUrl}/api/game`, { headers });
    expect(unavailable.status).toBe(409);
    expect(await unavailable.json()).toEqual({
      message: 'Choose a character before entering the world.',
    });

    await enterWorld('alice', 'character-alice');
    const snapshot = await fetch(`${harness.baseUrl}/api/game`, { headers });
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({
      serverTime: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
      player: { id: 'player-alice', displayName: 'Alice' },
      character: {
        characterId: 'character-alice',
        name: 'Alice',
        locationId: 'npc-room',
      },
      location: {
        locationId: 'npc-room',
        title: 'NPC Room',
        description: 'A quiet test room.',
      },
      stats: { attackPower: 0, spellPower: 0 },
      map: { currentLocationId: 'npc-room' },
    });
  });

  it('projects room-specific fishing, woodcutting, and bulletin-board options', async () => {
    state.characterWorldInstanceOverrides.set('character-alice', ORRAVETH_WORLD_INSTANCE_ID);
    const entered = await fetch(`${harness.baseUrl}/api/world-session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
        'x-mudd-world-instance': ORRAVETH_WORLD_INSTANCE_ID,
      },
      body: JSON.stringify({
        characterId: 'character-alice',
        worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
      }),
    });
    expect(entered.status).toBe(200);
    const character = state.characters['character-alice'];
    const originalLocationId = character.locationId;
    const originalLocations = state.world.locations.slice();
    const testLocations = [
      { id: 'bellwold-river-bridge', name: 'South Bridge', exits: [], npcs: [] },
      { id: 'bellwold-southbound-track', name: 'Southbound Track', exits: [], npcs: [] },
      { id: 'bellwold-south-common', name: 'South Common', exits: [], npcs: [] },
    ];
    state.world.locations.push(...testLocations);

    try {
      character.locationId = 'bellwold-river-bridge';
      const bridge = await fetch(`${harness.baseUrl}/api/game`, {
        headers: {
          'x-test-user': 'alice',
          'x-mudd-world-instance': ORRAVETH_WORLD_INSTANCE_ID,
        },
      });
      expect(bridge.status).toBe(200);
      expect((await bridge.json()).availableFishingSpots).toContainEqual(
        expect.objectContaining({ id: 'bellwold-south-bridge-fishing' }),
      );

      character.locationId = 'bellwold-southbound-track';
      const track = await fetch(`${harness.baseUrl}/api/game`, {
        headers: {
          'x-test-user': 'alice',
          'x-mudd-world-instance': ORRAVETH_WORLD_INSTANCE_ID,
        },
      });
      expect(track.status).toBe(200);
      expect((await track.json()).availableWoodcuttingTrees).toContainEqual(
        expect.objectContaining({ id: 'bellwold-southbound-pine' }),
      );

      character.locationId = 'bellwold-south-common';
      const common = await fetch(`${harness.baseUrl}/api/game`, {
        headers: {
          'x-test-user': 'alice',
          'x-mudd-world-instance': ORRAVETH_WORLD_INSTANCE_ID,
        },
      });
      expect(common.status).toBe(200);
      expect((await common.json()).dailyActivities.boards).toContainEqual(
        expect.objectContaining({ id: 'bellwold-notice-board' }),
      );
    } finally {
      character.locationId = originalLocationId;
      state.world.locations.splice(0, state.world.locations.length, ...originalLocations);
    }
  });

  it('initializes a missing wallet when building a snapshot for a currency world', async () => {
    await enterWorld('alice', 'character-alice');
    const character = state.characters['character-alice'];
    const originalWallet = character.wallet;
    const originalCurrency = state.world.currency;
    const originalSupplySources = state.world.supplySources.slice();

    try {
      character.wallet = undefined as never;
      state.world.currency = { id: 'test-currency', name: 'Gold', symbol: 'g' };
      state.world.supplySources.push({
        id: 'npc-room-supply',
        locationId: 'npc-room',
        label: 'Test supply source',
        dailyLimit: 1,
        supply: { typeId: 'test-item', label: 'Test item', description: 'A test supply.' },
      } as never);

      const response = await fetch(`${harness.baseUrl}/api/game`, {
        headers: { 'x-test-user': 'alice', 'x-mudd-world-instance': instanceId },
      });

      expect(response.status).toBe(200);
      const snapshot = await response.json();
      expect(snapshot.currency).toEqual({ id: 'test-currency', name: 'Gold', symbol: 'g' });
      expect(snapshot.character.wallet).toEqual({ currencyId: 'test-currency', balance: 10 });
      expect(character.wallet).toEqual({ currencyId: 'test-currency', balance: 10 });
      expect(snapshot.dailyActivities.sources).toContainEqual(expect.objectContaining({
        id: 'npc-room-supply',
        locationId: 'npc-room',
      }));
    } finally {
      character.wallet = originalWallet;
      state.world.currency = originalCurrency;
      state.world.supplySources.splice(0, state.world.supplySources.length, ...originalSupplySources);
    }
  });

  it('reports unavailable characters and location/stat projection failures in game snapshots', async () => {
    await enterWorld('alice', 'character-alice');
    const getGame = () => fetch(`${harness.baseUrl}/api/game`, {
      headers: { 'x-test-user': 'alice' },
    });

    state.characterReplayOverride = undefined;
    const unavailableCharacter = await getGame();
    expect(unavailableCharacter.status).toBe(409);
    expect(await unavailableCharacter.json()).toEqual({
      message: 'That character is no longer available.',
    });
    state.characterReplayOverride = null;

    const failures = [
      { queryType: 'location.describe', code: 'NOT_FOUND', status: 404, message: 'Room not found.' },
      { queryType: 'location.describe', code: 'FORBIDDEN', status: 403, message: 'Room access denied.' },
      { queryType: 'character.stats', code: 'INTERNAL_ERROR', status: 500, message: 'Stats projection failed.' },
      { queryType: 'character.stats', code: 'NOT_FOUND', status: 404, message: 'Stats not found.' },
    ] as const;
    for (const failure of failures) {
      state.queryOverrides.set(failure.queryType, {
        ok: false,
        code: failure.code,
        message: failure.message,
      });
      const response = await getGame();
      expect(response.status, `${failure.queryType}:${failure.code}`).toBe(failure.status);
      const body = await response.json() as { message: string; requestId?: string; };
      expect(body.message).toBe(failure.message);
      if (failure.status === 500) expect(body.requestId).toEqual(expect.any(String));
      state.queryOverrides.delete(failure.queryType);
    }
  });

  it('binds world commands to the active character and rejects PvP actions without an encounter', async () => {
    const postCommand = (userId: string, body: unknown) => fetch(`${harness.baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': userId,
      },
      body: JSON.stringify(body),
    });
    const movement = {
      type: 'character.move',
      version: 1,
      commandId: 'guard-move',
      worldInstanceId: instanceId,
      characterId: 'character-alice',
      expectedVersion: 0,
      payload: { exitId: 'exit-north' },
    };

    const withoutSession = await postCommand('alice', movement);
    expect(withoutSession.status).toBe(409);
    expect(await withoutSession.json()).toEqual({
      message: 'Enter the world with a character before taking world actions.',
    });

    await enterWorld('alice', 'character-alice');
    const wrongCharacter = await postCommand('alice', {
      ...movement,
      commandId: 'guard-wrong-character',
      characterId: 'character-bob',
    });
    expect(wrongCharacter.status).toBe(403);
    expect(await wrongCharacter.json()).toEqual({
      message: 'This world session is bound to a different character.',
    });

    const noEncounter = await postCommand('alice', {
      type: 'pvp.action',
      worldInstanceId: instanceId,
      characterId: 'character-alice',
      payload: {},
    });
    expect(noEncounter.status).toBe(409);
    expect(await noEncounter.json()).toEqual({
      message: 'There is no active PvP encounter for this character.',
    });

    const noTeamEncounter = await postCommand('alice', {
      type: 'team.combat.action',
      worldInstanceId: instanceId,
      characterId: 'character-alice',
      payload: {},
    });
    expect(noTeamEncounter.status).toBe(409);
    expect(await noTeamEncounter.json()).toEqual({
      message: 'There is no active team encounter for this character.',
    });
  });

  it('requires an interaction recipient and rejects players who are not online', async () => {
    const postChallenge = (payload: unknown) => fetch(`${harness.baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify({
        type: 'interaction.request',
        worldInstanceId: instanceId,
        characterId: 'character-alice',
        payload,
      }),
    });
    await enterWorld('alice', 'character-alice');

    const missingRecipient = await postChallenge({ kind: 'pvp.challenge' });
    expect(missingRecipient.status).toBe(400);
    expect(await missingRecipient.json()).toEqual({ message: 'Choose a player to challenge.' });

    const offlineRecipient = await postChallenge({
      kind: 'pvp.challenge',
      recipientCharacterId: 'character-offline',
    });
    expect(offlineRecipient.status).toBe(409);
    expect(await offlineRecipient.json()).toEqual({ message: 'That player is not online right now.' });

    await enterWorld('bob', 'character-bob');
    const bobSession = state.sessions.get('player-bob') as { lastSeenAt?: Date; };
    bobSession.lastSeenAt = new Date();
    const onlineRecipient = await postChallenge({
      kind: 'pvp.challenge',
      recipientCharacterId: 'character-bob',
    });
    expect(onlineRecipient.status).toBe(200);
  });

  it('restricts active PvP sessions to PvP actions', async () => {
    await enterWorld('alice', 'character-alice');
    state.interactionEncounter = {
      encounterId: 'pvp-encounter',
      requestId: 'pvp-request',
      locationId: 'npc-room',
      participants: [
        { characterId: 'character-alice', name: 'Alice', health: 10, maximumHealth: 10 },
        { characterId: 'character-bob', name: 'Bob', health: 10, maximumHealth: 10 },
      ],
      turnCharacterId: 'character-alice',
      round: 0,
      status: 'active',
      lastNarration: 'A duel begins.',
      updatedAt: new Date().toISOString(),
    };
    const postCommand = (body: unknown) => fetch(`${harness.baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify(body),
    });
    const baseCommand = {
      worldInstanceId: instanceId,
      characterId: 'character-alice',
    };

    const movement = await postCommand({
      ...baseCommand,
      type: 'character.move',
      payload: { exitId: 'exit-north' },
    });
    expect(movement.status).toBe(409);
    expect(await movement.json()).toEqual({
      message: 'Only combat actions are available during a PvP encounter.',
    });

    const newChallenge = await postCommand({
      ...baseCommand,
      type: 'interaction.request',
      payload: {},
    });
    expect(newChallenge.status).toBe(409);

    const pvpAction = await postCommand({
      ...baseCommand,
      type: 'pvp.action',
      payload: {},
    });
    expect(pvpAction.status).toBe(200);
  });

  it('restricts active team combat to combat actions while allowing party departure', async () => {
    await enterWorld('alice', 'character-alice');
    state.teamCombatProjection = {
      encounter: {
        encounterId: 'team-encounter',
        locationId: 'npc-room',
        participants: [
          {
            participantId: 'alice-participant',
            teamId: 'party-team',
            kind: 'player',
            characterId: 'character-alice',
            playerId: 'player-alice',
            displayName: 'Alice',
            health: 17,
            maximumHealth: 17,
            defending: false,
            status: 'active',
          },
          {
            participantId: 'bandit-participant',
            teamId: 'bandit-team',
            kind: 'npc',
            npcId: 'bandit',
            displayName: 'Bandit',
            health: 10,
            maximumHealth: 10,
            defending: false,
            status: 'active',
          },
        ],
        contributingPlayerIds: ['player-alice'],
        currentParticipantId: 'alice-participant',
        round: 1,
        status: 'active',
        lastNarration: 'The fight begins.',
        consumedItemIdsByCharacter: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
    const postCommand = (type: string) => fetch(`${harness.baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify({
        type,
        worldInstanceId: instanceId,
        characterId: 'character-alice',
        payload: {},
      }),
    });

    const movement = await postCommand('character.move');
    expect(movement.status).toBe(409);
    expect(await movement.json()).toEqual({
      message: 'Only combat actions are available during a team encounter.',
    });

    const departure = await postCommand('party.leave');
    expect(departure.status).toBe(200);
  });

  it('validates world queries and enriches location descriptions for the active character', async () => {
    const query = {
      type: 'location.describe',
      version: 1,
      queryId: 'location-query-test',
      worldInstanceId: instanceId,
      characterId: 'character-alice',
      payload: {},
    };
    const postQuery = (body: unknown) => fetch(`${harness.baseUrl}/api/queries`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify(body),
    });

    const malformed = await postQuery({ ...query, payload: { unexpected: true } });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ message: 'Invalid world query.' });

    const withoutSession = await postQuery(query);
    expect(withoutSession.status).toBe(409);
    expect(await withoutSession.json()).toEqual({
      message: 'Enter the world with a character before making a query.',
    });

    await enterWorld('alice', 'character-alice');
    const wrongCharacter = await postQuery({ ...query, characterId: 'character-bob' });
    expect(wrongCharacter.status).toBe(403);
    expect(await wrongCharacter.json()).toEqual({
      message: 'This world session is bound to a different character.',
    });

    const description = await postQuery(query);
    expect(description.status).toBe(200);
    expect(await description.json()).toMatchObject({
      ok: true,
      value: {
        worldInstanceId: instanceId,
        locationId: 'npc-room',
        title: 'NPC Room',
        description: 'A quiet test room.',
        occupants: [],
      },
    });
  });

  it('rejects queries for inactive characters and maps engine query errors to HTTP statuses', async () => {
    await enterWorld('alice', 'character-alice');
    const query = {
      type: 'party.info',
      version: 1,
      queryId: 'party-query-coverage',
      worldInstanceId: instanceId,
      characterId: 'character-alice',
      payload: {},
    };
    const postQuery = () => fetch(`${harness.baseUrl}/api/queries`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify(query),
    });

    state.characterReplayOverride = {
      ...state.characters['character-alice'],
      archived: true,
    };
    const archived = await postQuery();
    expect(archived.status).toBe(409);
    expect(await archived.json()).toEqual({
      message: 'Enter the world with an active character before making a query.',
    });

    state.characterReplayOverride = {
      ...state.characters['character-alice'],
      health: { current: 0, maximum: 10 },
    };
    const defeated = await postQuery();
    expect(defeated.status).toBe(409);
    expect(await defeated.json()).toEqual({
      message: 'Your character has died. Start a new character to begin again.',
    });
    state.characterReplayOverride = null;

    const failures = [
      { code: 'INTERNAL_ERROR', status: 500, message: 'The query failed.', correlationId: 'query-correlation-id' },
      { code: 'NOT_FOUND', status: 404, message: 'That party was not found.' },
      { code: 'RULE_VIOLATION', status: 422, message: 'The query is not allowed.' },
      { code: 'FORBIDDEN', status: 403, message: 'Access is denied.' },
    ] as const;
    for (const failure of failures) {
      state.queryOverrides.set('party.info', {
        ok: false,
        code: failure.code,
        message: failure.message,
        ...(failure.correlationId ? { correlationId: failure.correlationId } : {}),
      });
      const response = await postQuery();
      expect(response.status, failure.code).toBe(failure.status);
      const body = await response.json() as { ok: boolean; code: string; message: string; requestId?: string; };
      expect(body).toMatchObject({
        ok: false,
        code: failure.code,
        message: failure.message,
      });
      if (failure.code === 'INTERNAL_ERROR') {
        expect(body.requestId).toBe('query-correlation-id');
      }
    }

    state.queryOverrides.delete('party.info');
    const successful = await postQuery();
    expect(successful.status).toBe(200);
    expect(await successful.json()).toMatchObject({ ok: true, value: { party: null } });
  });

  it('uses the current request ID when an internal query error has no correlation ID', async () => {
    await enterWorld('alice', 'character-alice');
    state.queryOverrides.set('party.info', {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'The query failed without a correlation ID.',
    });
    try {
      const response = await fetch(`${harness.baseUrl}/api/queries`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-user': 'alice',
        },
        body: JSON.stringify({
          type: 'party.info',
          version: 1,
          queryId: 'uncorrelated-internal-query',
          worldInstanceId: instanceId,
          characterId: 'character-alice',
          payload: {},
        }),
      });

      expect(response.status).toBe(500);
      const body = await response.json() as { requestId: string; };
      expect(body.requestId).toBe(response.headers.get('x-request-id'));
    } finally {
      state.queryOverrides.delete('party.info');
    }
  });

  it('returns an interaction inbox for the active character', async () => {
    const unauthenticated = await fetch(`${harness.baseUrl}/api/interactions`);
    expect(unauthenticated.status).toBe(401);

    await enterWorld('alice', 'character-alice');
    const inbox = await fetch(`${harness.baseUrl}/api/interactions`, {
      headers: { 'x-test-user': 'alice' },
    });
    expect(inbox.status).toBe(200);
    expect(await inbox.json()).toEqual({ requests: [], encounter: null });
  });

  it('publishes once on entry, shares it with that room, and hides it from other rooms', async () => {
    await enterWorld('alice', 'character-alice');
    await enterWorld('bob', 'character-bob');

    const aliceChat = await readRoom('alice', 'npc-room');
    const bobChat = await readRoom('bob', 'npc-room');
    expect(aliceChat.response.status).toBe(200);
    expect(bobChat.response.status).toBe(200);
    expect(aliceChat.body.messages).toEqual([{
      speakerType: 'npc',
      speakerName: 'Mara',
      text: 'The north bridge is open.',
      id: expect.any(Number),
      roomId: 'npc-room',
      createdAt: expect.any(String),
    }]);
    expect(bobChat.body.messages).toEqual(aliceChat.body.messages);
    expect(state.messages).toHaveLength(1);

    await enterWorld('elsewhere', 'character-elsewhere');
    const otherRoomChat = await readRoom('elsewhere', 'other-room');
    expect(otherRoomChat.response.status).toBe(200);
    expect(otherRoomChat.body.messages).toEqual([]);

    const inaccessibleRoomChat = await readRoom('elsewhere', 'npc-room');
    expect(inaccessibleRoomChat.response.status).toBe(409);
  });

  it('returns a bounded request-body error with a request ID', async () => {
    const response = await fetch(`${harness.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.baseUrl,
        'x-test-user': 'alice',
      },
      body: JSON.stringify({ roomId: 'npc-room', text: 'x'.repeat(20_000) }),
    });
    const body = await response.json() as { message?: string; requestId?: string; };

    expect(response.status).toBe(413);
    expect(body.message).toBe('The request body is too large.');
    expect(body.requestId).toEqual(expect.any(String));
    expect(response.headers.get('x-request-id')).toBe(body.requestId);
  });
});
