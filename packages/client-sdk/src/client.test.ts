import { describe, expect, it } from 'vitest';
import { MuddHttpClient } from './index.js';
import { EngineHost, InMemoryEventStore, projectQuestJournal, replayCharacter } from '@mudd/engine-core';
import { characterPlugin, merchantPlugin, movementPlugin, npcDialoguePlugin } from '@mudd/core-plugins';
import { DEMO_WORLD_INSTANCE_ID, demoWorld } from '@mudd/world-demo';
import { InitializeCharacterWalletCommandSchema } from '@mudd/contracts';

describe('MuddHttpClient', () => {
  it('rejects malformed successful HTTP responses instead of trusting a TypeScript cast', async () => {
    const client = new MuddHttpClient({
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      fetcher: async () => Response.json({ player: { id: 42, displayName: null } }),
    });

    await expect(client.getGame()).rejects.toThrow('The server returned an invalid response.');
  });

  it('sends Zod-validated commands and queries to the authoritative engine', async () => {
    const session = {
      sessionId: 'session-1',
      playerId: 'player-1',
      actorId: 'player-1',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      grantedPermissions: [],
      authenticated: true,
    } as const;
    const store = new InMemoryEventStore();
    const engine = new EngineHost(
      [characterPlugin, movementPlugin, npcDialoguePlugin, merchantPlugin],
      store,
      { canAccessInstance: async () => true, ownsCharacter: async () => true },
      demoWorld,
    );
    await engine.start();
    const fetcher: typeof fetch = async (input, init = {}) => {
      const path = String(input);
      const body = JSON.parse(String(init.body ?? '{}')) as unknown;
      const result = path.endsWith('/commands')
        ? await engine.dispatch(body, session)
        : await engine.query(body, session);
      return Response.json(result);
    };
    const client = new MuddHttpClient({ worldInstanceId: DEMO_WORLD_INSTANCE_ID, fetcher });
    const created = await client.createCharacter('Fern', 'sdk-create');
    expect(created.receipt.ok).toBe(true);
    const characterId = created.streamId!;
    const firstRoom = await client.look(characterId, 'sdk-look-1');
    expect(firstRoom.title).toBe('Mossgate Clearing');
    expect(firstRoom.description).toContain('One loose stone bears a pale stripe.');
    expect(firstRoom.npcs).toEqual([{
      id: 'mara-waykeeper',
      name: 'Mara',
      description: 'A path keeper stands beside the weathered marker, watching the northern trail.',
    }]);
    expect(firstRoom.objects).toEqual([
      {
        id: 'mossgate-marker',
        label: 'Weathered marker',
        description: 'A weathered stone marker, its carved arrow worn but still pointing east.',
        readable: true,
        takeable: false,
      },
      {
        id: 'mossgate-loose-stone',
        label: 'Loose stone',
        description: 'A smooth, palm-sized stone with a pale stripe running through it.',
        readable: false,
        takeable: true,
      },
    ]);
    const marker = await client.read(characterId, 'mossgate-marker', firstRoom.revision, 'sdk-read');
    expect(marker).toEqual({
      id: 'mossgate-marker',
      label: 'Weathered marker',
      text: 'OLD BELL TOWER — EAST',
    });
    await expect(client.read(characterId, 'unknown-object', firstRoom.revision + 1, 'sdk-read-missing'))
      .rejects.toThrow('That object is not readable from here.');
    const afterRead = await client.look(characterId, 'sdk-look-after-read');
    const openingDialogue = await client.talk(characterId, 'mara-waykeeper', undefined, 'sdk-talk-opening');
    expect(openingDialogue).toEqual({
      npcId: 'mara-waykeeper',
      npcName: 'Mara',
      text: 'The old paths still have their stories. What would you like to ask?',
      choices: [
        { id: 'ask-marker', label: 'Ask about the marker' },
        { id: 'accept-wayfinding-quest', label: "I'll follow the marker" },
      ],
    });
    await expect(client.talk(characterId, 'mara-waykeeper', 'bell', 'sdk-talk-topic'))
      .resolves.toMatchObject({
        npcName: 'Mara',
        text: 'The bell has not rung in years. The tower stands east of this clearing.',
        choices: [],
      });
    await expect(client.talk(characterId, 'mara-waykeeper', 'marker', 'sdk-talk-marker-unaccepted'))
      .resolves.toMatchObject({
        text: 'The marker is old, but the carving still points east toward the Old Bell Tower.',
        choices: [],
      });
    await expect(client.talk(characterId, 'mara-waykeeper', 'weather', 'sdk-talk-unknown-topic'))
      .resolves.toMatchObject({ text: 'Ask me about the marker or the bell tower.', choices: [] });
    const secondCreated = await client.createCharacter('Ash', 'sdk-create-second');
    const secondCharacterId = secondCreated.streamId!;
    await expect(client.talk(secondCharacterId, 'mara-waykeeper', undefined, 'sdk-talk-second-character'))
      .resolves.toMatchObject({
        text: 'The old paths still have their stories. What would you like to ask?',
        choices: [
          { id: 'ask-marker', label: 'Ask about the marker' },
          { id: 'accept-wayfinding-quest', label: "I'll follow the marker" },
        ],
      });

    const choice = await client.chooseNpcDialogue(characterId, 'mara-waykeeper', 'ask-marker', afterRead.revision, 'sdk-choose-marker');
    expect(choice.receipt).toMatchObject({ ok: true, newAggregateVersion: afterRead.revision + 1 });
    await expect(client.talk(characterId, 'mara-waykeeper', undefined, 'sdk-talk-after-choice'))
      .resolves.toEqual({
        npcId: 'mara-waykeeper',
        npcName: 'Mara',
        text: 'The marker points east to the Old Bell Tower. Its direction is still true.',
        choices: [
          { id: 'accept-wayfinding-quest', label: "I'll follow the marker" },
        ],
      });
    await expect(client.talk(secondCharacterId, 'mara-waykeeper', undefined, 'sdk-talk-second-character-after-choice'))
      .resolves.toMatchObject({ text: 'The old paths still have their stories. What would you like to ask?' });
    await expect(client.chooseNpcDialogue(characterId, 'mara-waykeeper', 'ask-marker', afterRead.revision + 1, 'sdk-choice-marker-again'))
      .rejects.toThrow('You have already asked about that.');

    const afterDialogue = await client.look(characterId, 'sdk-look-after-dialogue');
    const taken = await client.take(characterId, 'mossgate-loose-stone', afterDialogue.revision, 'sdk-take');
    expect(taken.receipt).toMatchObject({ ok: true, newAggregateVersion: afterDialogue.revision + 1 });
    await expect(client.inspect(characterId, 'mossgate-loose-stone', 'sdk-inspect-carried'))
      .resolves.toEqual({
        id: 'mossgate-loose-stone',
        label: 'Loose stone',
        description: 'A smooth, palm-sized stone with a pale stripe running through it.',
      });
    const afterTake = await client.look(characterId, 'sdk-look-after-take');
    expect(afterTake.revision).toBe(afterDialogue.revision + 1);
    expect(afterTake.objects).not.toContainEqual(expect.objectContaining({ id: 'mossgate-loose-stone' }));
    expect(afterTake.description).not.toContain('One loose stone bears a pale stripe.');
    const dropped = await client.drop(characterId, 'mossgate-loose-stone', afterTake.revision, 'sdk-drop');
    expect(dropped.receipt).toMatchObject({ ok: true, newAggregateVersion: afterTake.revision + 1 });
    const afterDrop = await client.look(characterId, 'sdk-look-after-drop');
    expect(afterDrop.description).toContain('One loose stone bears a pale stripe.');
    expect(afterDrop.objects).toContainEqual(expect.objectContaining({
      id: 'mossgate-loose-stone',
      takeable: true,
    }));
    const takenAgain = await client.take(characterId, 'mossgate-loose-stone', afterDrop.revision, 'sdk-take-again');
    expect(takenAgain.receipt).toMatchObject({ ok: true, newAggregateVersion: afterDrop.revision + 1 });
    const moved = await client.move(characterId, 'clearing-to-bridge', afterDrop.revision + 1, 'sdk-move');
    expect(moved.receipt.ok).toBe(true);
    const nextRoom = await client.look(characterId, 'sdk-look-2');
    expect(nextRoom.title).toBe('Glasswater Bridge');
    await expect(client.inspect(characterId, 'mossgate-loose-stone', 'sdk-inspect-carried-away'))
      .resolves.toMatchObject({ id: 'mossgate-loose-stone', label: 'Loose stone' });
    await expect(client.inspect(characterId, 'mossgate-marker', 'sdk-inspect-unavailable'))
      .rejects.toThrow('That object is not here or in your pack.');
    await expect(client.read(characterId, 'mossgate-marker', nextRoom.revision, 'sdk-read-from-bridge'))
      .rejects.toThrow('That object is not readable from here.');
    await expect(client.talk(characterId, 'mara-waykeeper', undefined, 'sdk-talk-away'))
      .rejects.toThrow('That person is not here.');
    await expect(client.chooseNpcDialogue(characterId, 'mara-waykeeper', 'ask-tower', nextRoom.revision, 'sdk-choice-away'))
      .rejects.toThrow('That person is not here.');
    await expect(client.use(
      characterId,
      'mossgate-loose-stone',
      'tower-cracked-bell',
      nextRoom.revision,
      'sdk-use-target-away',
    )).rejects.toThrow('That is not a usable target in this room.');
    const movedToTower = await client.move(characterId, 'bridge-to-tower', nextRoom.revision, 'sdk-move-tower');
    expect(movedToTower.receipt.ok).toBe(true);
    const tower = await client.look(characterId, 'sdk-look-tower');
    expect(tower.objects).toContainEqual(expect.objectContaining({
      id: 'tower-cracked-bell',
      readable: false,
      takeable: false,
    }));
    const firstUse = await client.use(
      characterId,
      'mossgate-loose-stone',
      'tower-cracked-bell',
      tower.revision,
      'sdk-use-bell',
    );
    expect(firstUse).toEqual({
      interactionId: 'ring-tower-bell-with-stone',
      response: 'You strike the cracked bell with the smooth stone. A low, uneven note rolls through the tower.',
    });
    const afterFirstUse = await client.look(characterId, 'sdk-look-after-use');
    const characterAfterFirstUse = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId));
    expect(characterAfterFirstUse?.itemUseObservations).toContainEqual({
      interactionId: 'ring-tower-bell-with-stone',
      itemId: 'mossgate-loose-stone',
      targetId: 'tower-cracked-bell',
      locationId: 'bell-tower',
    });
    expect(characterAfterFirstUse?.inventory).toContainEqual(expect.objectContaining({ id: 'mossgate-loose-stone' }));
    await expect(client.use(
      characterId,
      'mossgate-loose-stone',
      'tower-cracked-bell',
      afterFirstUse.revision,
      'sdk-use-bell-again',
    )).resolves.toEqual({
      interactionId: 'ring-tower-bell-with-stone',
      response: 'You strike the bell again. Its low note echoes through the stonework.',
    });
    const afterRepeatUse = await client.look(characterId, 'sdk-look-after-repeat-use');
    await expect(client.use(
      characterId,
      'mossgate-marker',
      'tower-cracked-bell',
      afterRepeatUse.revision,
      'sdk-use-unowned-item',
    )).rejects.toThrow('You are not carrying that item.');
    await expect(client.use(
      characterId,
      'mossgate-loose-stone',
      'mossgate-marker',
      afterRepeatUse.revision,
      'sdk-use-unknown-target',
    )).rejects.toThrow('That is not a usable target in this room.');
    await engine.stop();
  });

  it('solves the bell puzzle in order, opens the Underhollow, and completes its quest', async () => {
    const session = {
      sessionId: 'session-bell-puzzle',
      playerId: 'player-bell-puzzle',
      actorId: 'player-bell-puzzle',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      grantedPermissions: [],
      authenticated: true,
    } as const;
    const store = new InMemoryEventStore();
    const engine = new EngineHost(
      [characterPlugin, movementPlugin, npcDialoguePlugin, merchantPlugin],
      store,
      { canAccessInstance: async () => true, ownsCharacter: async () => true },
      demoWorld,
    );
    await engine.start();
    const fetcher: typeof fetch = async (input, init = {}) => {
      const body = JSON.parse(String(init.body ?? '{}')) as unknown;
      const result = String(input).endsWith('/commands')
        ? await engine.dispatch(body, session)
        : await engine.query(body, session);
      return Response.json(result);
    };
    const client = new MuddHttpClient({ worldInstanceId: DEMO_WORLD_INSTANCE_ID, fetcher });
    const created = await client.createCharacter('Lark', 'puzzle-create');
    const characterId = created.streamId!;

    const clearing = await client.look(characterId, 'puzzle-look-clearing');
    await client.take(characterId, 'mossgate-loose-stone', clearing.revision, 'puzzle-take-stone');
    const afterStone = await client.look(characterId, 'puzzle-look-after-stone');
    await client.move(characterId, 'clearing-to-bridge', afterStone.revision, 'puzzle-go-bridge');
    const bridge = await client.look(characterId, 'puzzle-look-bridge');
    const eddaOpening = await client.talk(characterId, 'edda-bellwright', undefined, 'puzzle-talk-edda');
    expect(eddaOpening.choices).toContainEqual({
      id: 'accept-bell-echo',
      label: 'Investigate the bell puzzle',
    });
    await client.chooseNpcDialogue(
      characterId,
      'edda-bellwright',
      'accept-bell-echo',
      bridge.revision,
      'puzzle-accept-quest',
    );
    const firstHint = await client.talk(characterId, 'edda-bellwright', 'hint', 'puzzle-hint-one');
    expect(firstHint.text).toContain('Hint 1');
    const afterAccept = await client.look(characterId, 'puzzle-look-after-accept');
    await client.take(characterId, 'glasswater-reed', afterAccept.revision, 'puzzle-take-reed');
    const bridgeWithReed = await client.look(characterId, 'puzzle-look-bridge-with-reed');
    await client.move(characterId, 'bridge-to-tower', bridgeWithReed.revision, 'puzzle-go-tower');

    const tower = await client.look(characterId, 'puzzle-look-tower');
    expect(tower.exits).toContainEqual(expect.objectContaining({
      id: 'tower-to-underhollow',
      available: false,
    }));
    await expect(client.move(
      characterId,
      'tower-to-underhollow',
      tower.revision,
      'puzzle-try-locked-stair',
    )).rejects.toThrow('That passage is still sealed.');

    const inscription = await client.read(
      characterId,
      'tower-bell-inscription',
      tower.revision,
      'puzzle-read-inscription',
    );
    expect(inscription.text).toContain('Pale first, hollow second.');
    await client.move(characterId, 'tower-to-bridge', tower.revision + 1, 'puzzle-return-for-hint-two');
    const bridgeForHintTwo = await client.look(characterId, 'puzzle-look-for-hint-two');
    const secondHint = await client.talk(characterId, 'edda-bellwright', 'hint', 'puzzle-hint-two');
    expect(secondHint.text).toContain('Hint 2');
    await client.move(characterId, 'bridge-to-tower', bridgeForHintTwo.revision, 'puzzle-return-for-bell');
    const towerForBell = await client.look(characterId, 'puzzle-look-for-bell');
    await expect(client.use(
      characterId,
      'glasswater-reed',
      'tower-cracked-bell',
      towerForBell.revision,
      'puzzle-reed-first',
    )).rejects.toThrow('The bell gives a dull click. Its first note is still missing; the inscription says pale first.');

    await expect(client.use(
      characterId,
      'mossgate-loose-stone',
      'tower-cracked-bell',
      towerForBell.revision,
      'puzzle-strike-with-stone',
    )).resolves.toMatchObject({
      interactionId: 'ring-tower-bell-with-stone',
      response: expect.stringContaining('A low, uneven note'),
    });
    const afterFirstNote = await client.look(characterId, 'puzzle-look-after-first-note');
    expect(afterFirstNote.exits).toContainEqual(expect.objectContaining({
      id: 'tower-to-underhollow',
      available: false,
    }));
    await client.move(characterId, 'tower-to-bridge', afterFirstNote.revision, 'puzzle-return-for-hint-three');
    const bridgeForHintThree = await client.look(characterId, 'puzzle-look-for-hint-three');
    const thirdHint = await client.talk(characterId, 'edda-bellwright', 'hint', 'puzzle-hint-three');
    expect(thirdHint.text).toContain('Hint 3');
    await client.move(characterId, 'bridge-to-tower', bridgeForHintThree.revision, 'puzzle-return-to-finish');
    const towerForReed = await client.look(characterId, 'puzzle-look-for-reed');
    await expect(client.use(
      characterId,
      'glasswater-reed',
      'tower-cracked-bell',
      towerForReed.revision,
      'puzzle-answer-with-reed',
    )).resolves.toMatchObject({
      interactionId: 'answer-tower-bell-with-reed',
      response: expect.stringContaining('a narrow stair opens beneath the bell'),
    });

    const afterSecondNote = await client.look(characterId, 'puzzle-look-after-second-note');
    expect(afterSecondNote.exits).toContainEqual(expect.objectContaining({
      id: 'tower-to-underhollow',
      available: true,
    }));
    const solvedState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(projectQuestJournal(solvedState, demoWorld)).toMatchObject([{
      questId: 'eddas-bell-echo',
      status: 'active',
      objectives: [
        { id: 'read-bell-inscription', completed: true },
        { id: 'strike-bell-with-stone', completed: true },
        { id: 'answer-bell-with-reed', completed: true },
        { id: 'visit-underhollow', completed: false },
      ],
    }]);

    await client.move(characterId, 'tower-to-underhollow', afterSecondNote.revision, 'puzzle-descend');
    const underhollow = await client.look(characterId, 'puzzle-look-underhollow');
    expect(underhollow.title).toBe('The Underhollow');
    await client.move(characterId, 'underhollow-to-tower', underhollow.revision, 'puzzle-return-up');
    const towerAgain = await client.look(characterId, 'puzzle-look-tower-again');
    await client.move(characterId, 'tower-to-bridge', towerAgain.revision, 'puzzle-return-bridge');
    const bridgeAgain = await client.look(characterId, 'puzzle-look-bridge-again');
    const eddaAfter = await client.talk(characterId, 'edda-bellwright', undefined, 'puzzle-talk-edda-after');
    expect(eddaAfter.choices).toContainEqual({
      id: 'report-bell-echo',
      label: 'I found the Underhollow',
    });
    await client.chooseNpcDialogue(
      characterId,
      'edda-bellwright',
      'report-bell-echo',
      bridgeAgain.revision,
      'puzzle-report-quest',
    );
    const completedState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(completedState.visitedLocationIds).toContain('bell-underhollow');
    expect(completedState.questProgress).toContainEqual(expect.objectContaining({
      questId: 'eddas-bell-echo',
      status: 'completed',
    }));
    await engine.stop();
  });

  it('records character-specific quest progress from reading and movement, then turns it in with Mara', async () => {
    const session = {
      sessionId: 'session-quest',
      playerId: 'player-quest',
      actorId: 'player-quest',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      grantedPermissions: [],
      authenticated: true,
    } as const;
    const store = new InMemoryEventStore();
    const engine = new EngineHost(
      [characterPlugin, movementPlugin, npcDialoguePlugin, merchantPlugin],
      store,
      { canAccessInstance: async () => true, ownsCharacter: async () => true },
      demoWorld,
    );
    await engine.start();
    const fetcher: typeof fetch = async (input, init = {}) => {
      const body = JSON.parse(String(init.body ?? '{}')) as unknown;
      const result = String(input).endsWith('/commands')
        ? await engine.dispatch(body, session)
        : await engine.query(body, session);
      return Response.json(result);
    };
    const client = new MuddHttpClient({ worldInstanceId: DEMO_WORLD_INSTANCE_ID, fetcher });
    const created = await client.createCharacter('Willow', 'quest-create');
    const characterId = created.streamId!;
    const opening = await client.talk(characterId, 'mara-waykeeper', undefined, 'quest-opening');
    expect(opening.choices).toContainEqual({
      id: 'accept-wayfinding-quest',
      label: "I'll follow the marker",
    });

    await client.chooseNpcDialogue(
      characterId,
      'mara-waykeeper',
      'accept-wayfinding-quest',
      1,
      'quest-accept',
    );
    const afterAccept = await client.look(characterId, 'quest-look-after-accept');
    await expect(client.talk(characterId, 'mara-waykeeper', undefined, 'quest-talk-after-accept'))
      .resolves.toMatchObject({
        text: 'I’ll mark the way for you. Read the weathered marker beside me to start.',
      });
    await expect(client.talk(characterId, 'mara-waykeeper', 'marker', 'quest-talk-marker-before-read'))
      .resolves.toMatchObject({
        text: 'The marker is old, but the carving still points east toward the Old Bell Tower.',
        choices: [],
      });
    const dialogueBeforeObjective = await client.talk(
      characterId,
      'mara-waykeeper',
      undefined,
      'quest-talk-before-marker',
    );
    expect(dialogueBeforeObjective.choices).not.toContainEqual({
      id: 'ask-tower',
      label: 'Ask about the bell tower',
    });
    await expect(client.chooseNpcDialogue(
      characterId,
      'mara-waykeeper',
      'ask-tower',
      afterAccept.revision,
      'quest-choice-before-marker',
    )).rejects.toThrow('That choice is not available here.');
    const acceptedState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(projectQuestJournal(acceptedState, demoWorld)).toMatchObject([{
      questId: 'mara-wayfinding',
      status: 'active',
      objectives: [
        { id: 'read-marker', completed: false },
        { id: 'visit-bell-tower', completed: false },
      ],
    }]);
    await expect(client.chooseNpcDialogue(
      characterId,
      'mara-waykeeper',
      'report-wayfinding-quest',
      afterAccept.revision,
      'quest-premature-turn-in',
    )).rejects.toThrow('You have more to do before reporting back.');

    const marker = await client.read(characterId, 'mossgate-marker', afterAccept.revision, 'quest-read-marker');
    expect(marker.text).toBe('OLD BELL TOWER — EAST');
    const afterRead = await client.look(characterId, 'quest-look-after-read');
    await expect(client.talk(characterId, 'mara-waykeeper', undefined, 'quest-talk-after-read'))
      .resolves.toMatchObject({
        text: 'You read the marker. Its arrow points east to the Old Bell Tower. Visit the tower, then come back and tell me what you found.',
      });
    await expect(client.talk(characterId, 'mara-waykeeper', 'marker', 'quest-talk-marker-after-read'))
      .resolves.toMatchObject({
        text: 'You’ve read the marker now. Its arrow points east to the Old Bell Tower.',
        choices: [],
      });
    await expect(client.talk(characterId, 'mara-waykeeper', undefined, 'quest-talk-choice-unlocked'))
      .resolves.toMatchObject({
        choices: expect.arrayContaining([{
          id: 'ask-tower',
          label: 'Ask about the bell tower',
        }]),
      });
    await client.move(characterId, 'clearing-to-tower', afterRead.revision, 'quest-visit-tower');
    const atTower = await client.look(characterId, 'quest-look-at-tower');
    expect(atTower.title).toBe('Old Bell Tower');
    const towerState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(projectQuestJournal(towerState, demoWorld)[0]?.objectives.every((objective) => objective.completed))
      .toBe(true);

    await client.move(characterId, 'tower-to-clearing', atTower.revision, 'quest-return-to-mara');
    const backAtMara = await client.look(characterId, 'quest-look-back-at-mara');
    const reportDialogue = await client.talk(characterId, 'mara-waykeeper', undefined, 'quest-report-dialogue');
    expect(reportDialogue.text)
      .toBe('You reached the Old Bell Tower. Tell me what you found when you are ready to report.');
    expect(reportDialogue.choices).toContainEqual({
      id: 'report-wayfinding-quest',
      label: 'I visited the Old Bell Tower',
    });
    await client.chooseNpcDialogue(
      characterId,
      'mara-waykeeper',
      'report-wayfinding-quest',
      backAtMara.revision,
      'quest-turn-in',
    );
    const completedState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(completedState.questProgress).toMatchObject([{
      questId: 'mara-wayfinding',
      status: 'completed',
    }]);
    expect(projectQuestJournal(completedState, demoWorld)).toMatchObject([{
      questId: 'mara-wayfinding',
      status: 'completed',
      objectives: [
        { id: 'read-marker', completed: true },
        { id: 'visit-bell-tower', completed: true },
      ],
    }]);

    const completedDialogue = await client.talk(
      characterId,
      'mara-waykeeper',
      undefined,
      'quest-talk-after-turn-in',
    );
    expect(completedDialogue.text).toBe('You brought back the story of the path. Thank you; I will remember it.');
    await expect(client.talk(characterId, 'mara-waykeeper', 'marker', 'quest-talk-marker-after-turn-in'))
      .resolves.toMatchObject({
        text: 'You read the marker and followed its direction all the way to the Old Bell Tower.',
        choices: [],
      });
    expect(completedDialogue.choices).not.toContainEqual({
      id: 'report-wayfinding-quest',
      label: 'I visited the Old Bell Tower',
    });

    const anotherCreated = await client.createCharacter('Cedar', 'quest-create-second-character');
    const anotherCharacterId = anotherCreated.streamId!;
    const anotherState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, anotherCharacterId))!;
    expect(projectQuestJournal(anotherState, demoWorld)).toEqual([]);
    await expect(client.talk(anotherCharacterId, 'mara-waykeeper', undefined, 'quest-talk-second-character'))
      .resolves.toMatchObject({
        text: 'The old paths still have their stories. What would you like to ask?',
      });
    await expect(client.talk(anotherCharacterId, 'mara-waykeeper', 'marker', 'quest-talk-marker-second-character'))
      .resolves.toMatchObject({
        text: 'The marker is old, but the carving still points east toward the Old Bell Tower.',
        choices: [],
      });
    await engine.stop();
  });

  it('buys character-owned merchant stock from an authoritative catalog', async () => {
    const session = {
      sessionId: 'merchant-session',
      playerId: 'merchant-player',
      actorId: 'merchant-player',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      grantedPermissions: [],
      authenticated: true,
    } as const;
    const store = new InMemoryEventStore();
    const engine = new EngineHost(
      [characterPlugin, movementPlugin, npcDialoguePlugin, merchantPlugin],
      store,
      { canAccessInstance: async () => true, ownsCharacter: async () => true },
      demoWorld,
    );
    await engine.start();
    const fetcher: typeof fetch = async (input, init = {}) => {
      const path = String(input);
      const body = JSON.parse(String(init.body ?? '{}')) as unknown;
      const result = path.endsWith('/commands')
        ? await engine.dispatch(body, session)
        : await engine.query(body, session);
      return Response.json(result);
    };
    const client = new MuddHttpClient({ worldInstanceId: DEMO_WORLD_INSTANCE_ID, fetcher });

    async function reachStalls(characterId: string, prefix: string) {
      const clearing = await client.look(characterId, `${prefix}-clearing`);
      await client.move(characterId, 'clearing-to-bridge', clearing.revision, `${prefix}-move-bridge`);
      const bridge = await client.look(characterId, `${prefix}-bridge`);
      await client.move(characterId, 'bridge-to-reedbank', bridge.revision, `${prefix}-move-stalls`);
    }

    const first = await client.createCharacter('Briar', 'merchant-create-first');
    const firstId = first.streamId!;
    await reachStalls(firstId, 'merchant-first');
    const firstCatalog = await client.getMerchantCatalog(firstId, 'sella-reedbank-merchant', 'merchant-catalog-first');
    expect(firstCatalog).toMatchObject({
      merchantName: 'Sella',
      currency: { id: 'moss-mark', balance: 12 },
      listings: [
        { id: 'reedbank-brass-lantern', price: 8, purchased: false },
        { id: 'reedbank-waxed-cord', price: 5, purchased: false },
      ],
    });
    const firstRoom = await client.look(firstId, 'merchant-first-room');
    await client.purchaseMerchantListing(
      firstId,
      'sella-reedbank-merchant',
      'reedbank-brass-lantern',
      firstRoom.revision,
      'merchant-buy-first-lantern',
    );
    const purchasedState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, firstId))!;
    expect(purchasedState.wallet).toEqual({ currencyId: 'moss-mark', balance: 4 });
    expect(purchasedState.inventory).toContainEqual({
      id: 'item-reedbank-brass-lantern',
      label: 'Brass lantern',
      description: 'A compact brass lantern with a sliding shutter and a soot-dark wick.',
    });
    expect(purchasedState.purchasedMerchantListingIds).toContain('reedbank-brass-lantern');
    const refreshedCatalog = await client.getMerchantCatalog(firstId, 'sella-reedbank-merchant', 'merchant-catalog-refreshed');
    expect(refreshedCatalog.listings.find((listing) => listing.id === 'reedbank-brass-lantern')?.purchased).toBe(true);
    const afterBuy = await client.look(firstId, 'merchant-first-after-buy');
    await expect(client.purchaseMerchantListing(
      firstId,
      'sella-reedbank-merchant',
      'reedbank-brass-lantern',
      afterBuy.revision,
      'merchant-buy-first-again',
    )).rejects.toThrow('You have already bought that item from this merchant.');
    await expect(client.purchaseMerchantListing(
      firstId,
      'sella-reedbank-merchant',
      'reedbank-waxed-cord',
      afterBuy.revision,
      'merchant-buy-first-unaffordable',
    )).rejects.toThrow('You need 5 moss mark to buy that.');

    const second = await client.createCharacter('Rowan', 'merchant-create-second');
    const secondId = second.streamId!;
    await reachStalls(secondId, 'merchant-second');
    const secondCatalog = await client.getMerchantCatalog(secondId, 'sella-reedbank-merchant', 'merchant-catalog-second');
    expect(secondCatalog.currency.balance).toBe(12);
    expect(secondCatalog.listings[0]?.purchased).toBe(false);
    const secondRoom = await client.look(secondId, 'merchant-second-room');
    const secondPurchase = await client.purchaseMerchantListing(
      secondId,
      'sella-reedbank-merchant',
      'reedbank-brass-lantern',
      secondRoom.revision,
      'merchant-buy-second-lantern',
    );
    expect(secondPurchase.receipt.ok).toBe(true);
    await engine.stop();
  });

  it('grants a legacy character wallet through one explicit initialization event', async () => {
    const store = new InMemoryEventStore();
    const engine = new EngineHost(
      [characterPlugin, movementPlugin, npcDialoguePlugin, merchantPlugin],
      store,
      { canAccessInstance: async () => true, ownsCharacter: async () => true },
      demoWorld,
    );
    await engine.start();
    const legacyCharacterId = 'legacy-character';
    await store.append({
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      streamId: legacyCharacterId,
      actorId: 'legacy-player',
      commandId: 'legacy-character-create',
      payloadHash: 'legacy-character-create-hash',
      expectedVersion: 0,
      events: [{
        type: 'character.created',
        version: 1,
        payload: {
          characterId: legacyCharacterId,
          playerId: 'legacy-player',
          name: 'Legacy',
          startingLocationId: 'mossgate-clearing',
        },
      }],
    });
    const session = {
      sessionId: 'legacy-session',
      playerId: 'legacy-player',
      actorId: 'legacy-player',
      selectedCharacterId: legacyCharacterId,
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      grantedPermissions: [],
      authenticated: true,
    } as const;
    const initialize = (commandId: string, expectedVersion: number) =>
      InitializeCharacterWalletCommandSchema.parse({
        type: 'character.wallet.initialize',
        version: 1,
        commandId,
        worldInstanceId: DEMO_WORLD_INSTANCE_ID,
        characterId: legacyCharacterId,
        expectedVersion,
        payload: {},
      });
    const initialized = await engine.dispatch(initialize('legacy-wallet-init', 1), session);
    expect(initialized.receipt.ok).toBe(true);
    const duplicate = await engine.dispatch(initialize('legacy-wallet-init-again', 2), session);
    expect(duplicate.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });
    const events = await store.readStream(DEMO_WORLD_INSTANCE_ID, legacyCharacterId);
    expect(events.filter((event) => event.type === 'character.wallet_initialized')).toHaveLength(1);
    expect(replayCharacter(events)?.wallet).toEqual({ currencyId: 'moss-mark', balance: 12 });
    await engine.stop();
  });
});
