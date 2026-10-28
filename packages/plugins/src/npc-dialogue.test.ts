import { describe, expect, it, vi } from 'vitest';
import { CharacterProjectionSchema, dailyCycle, dailyPostings } from '@mudd/contracts';
import { npcDialoguePlugin } from './npc-dialogue.js';

const NPC_ID = 'town-guide';
const NPC = {
  id: NPC_ID,
  name: 'Mara',
  greeting: 'The bells keep the hours.',
  unknownTopicResponse: 'I have nothing to add.',
  topics: [{ keywords: ['bellwold', 'town'], response: 'Bellwold sits beside the old road.' }],
  dialogue: {
    prompt: 'What would you like to know?',
    choices: [
      { id: 'town', label: 'What is Bellwold like?', response: 'It is a close-knit town.', progressFlagId: 'asked-town' },
      {
        id: 'beyond',
        label: 'What lies beyond town?',
        response: 'The old road runs west.',
        progressFlagId: 'asked-beyond',
        requiresProgressFlagIds: ['asked-town'],
      },
      {
        id: 'repeatable-hidden',
        label: 'Ask about the market',
        response: 'The market opens early.',
        progressFlagId: 'asked-market',
        hideAfterProgressFlagIds: ['asked-town'],
      },
      {
        id: 'gift',
        label: 'Accept the old rod',
        response: 'Take care of it.',
        progressFlagId: 'accepted-rod',
        itemReward: {
          id: 'old-rod',
          typeId: 'old-fishing-rod',
          label: 'Old rod',
          description: 'A well-used fishing rod.',
          fishingRod: { qualityId: 'old', biteChancePercent: 10, waitSeconds: 10 },
        },
      },
    ],
  },
};

function character(overrides: Record<string, unknown> = {}) {
  return CharacterProjectionSchema.parse({
    worldInstanceId: 'world-1',
    characterId: 'player-1',
    name: 'Traveler',
    locationId: 'market',
    revision: 5,
    health: { current: 10, maximum: 10 },
    npcProgress: [],
    questProgress: [],
    dailyJobs: [],
    wallet: { currencyId: 'moss-mark', balance: 3 },
    ...overrides,
  });
}

function world(options: {
  npc?: Record<string, unknown>;
  quests?: Array<Record<string, unknown>>;
  dailyBoards?: Array<Record<string, unknown>>;
  takeables?: Array<Record<string, unknown>>;
} = {}) {
  return {
    locations: [{
      id: 'market',
      npcs: [options.npc ?? NPC],
      takeables: options.takeables ?? [],
    }],
    quests: options.quests ?? [],
    dailyBoards: options.dailyBoards ?? [],
    currency: { id: 'moss-mark', name: 'moss mark', symbol: 'm' },
  };
}

function harness(
  player: ReturnType<typeof character>,
  options: {
    npc?: Record<string, unknown>;
    quests?: Array<Record<string, unknown>>;
    dailyBoards?: Array<Record<string, unknown>>;
    takeables?: Array<Record<string, unknown>>;
    characterExists?: boolean;
    autonomousNpcs?: Array<Record<string, unknown>>;
  } = {},
) {
  const queries = new Map<string, (query: any, context: any) => Promise<unknown>>();
  const commands = new Map<string, (command: any, context: any) => Promise<unknown>>();
  const autonomousAtLocation = vi.fn(async () => options.autonomousNpcs ?? []);
  npcDialoguePlugin.register({
    registerQuery: (name: string, _schema: unknown, handler: (query: any, context: any) => Promise<unknown>) => {
      queries.set(name, handler);
    },
    registerCommand: (name: string, _schema: unknown, handler: (command: any, context: any) => Promise<unknown>) => {
      commands.set(name, handler);
    },
    requireCapability: () => ({
      load: vi.fn(async () => options.characterExists === false ? undefined : player),
    }),
    optionalCapability: () => options.autonomousNpcs
      ? { atLocation: autonomousAtLocation }
      : undefined,
  } as never);
  const context = {
    world: world(options),
    worldInstanceId: 'world-1',
    now: () => new Date('2026-10-27T12:00:00.000Z'),
  };
  return { queries, commands, context, autonomousAtLocation };
}

function talkQuery(player: ReturnType<typeof character>, npcId = NPC_ID, topic?: string) {
  return {
    characterId: player.characterId,
    payload: { npcId, ...(topic ? { topic } : {}) },
  };
}

function chooseCommand(player: ReturnType<typeof character>, choiceId: string) {
  return {
    characterId: player.characterId,
    expectedVersion: player.revision,
    payload: { npcId: NPC_ID, choiceId },
  };
}

describe('NPC talk projection', () => {
  it('returns the greeting for a character without a dialogue tree', async () => {
    const player = character();
    const { queries, context } = harness(player, {
      npc: { ...NPC, dialogue: undefined },
    });
    await expect(queries.get('npc.talk')!(talkQuery(player), context)).resolves.toMatchObject({
      text: NPC.greeting,
      choices: [],
    });
  });

  it('filters branching dialogue choices as progress advances', async () => {
    const player = character();
    const first = harness(player);
    await expect(first.queries.get('npc.talk')!(talkQuery(player), first.context)).resolves.toMatchObject({
      choices: [
        { id: 'town', label: 'What is Bellwold like?' },
        { id: 'repeatable-hidden', label: 'Ask about the market' },
        { id: 'gift', label: 'Accept the old rod' },
      ],
    });

    const progressed = character({
      npcProgress: [{ npcId: NPC_ID, progressFlagIds: ['asked-town'], lastChoiceId: 'town' }],
    });
    const next = harness(progressed);
    await expect(next.queries.get('npc.talk')!(talkQuery(progressed), next.context)).resolves.toMatchObject({
      text: NPC.dialogue.choices[0]!.response,
      choices: [
        { id: 'beyond', label: 'What lies beyond town?' },
        { id: 'gift', label: 'Accept the old rod' },
      ],
    });
  });

  it('answers topic queries using matching keywords and the unknown-topic response otherwise', async () => {
    const player = character();
    const { queries, context } = harness(player);
    await expect(queries.get('npc.talk')!(talkQuery(player, NPC_ID, 'Tell me about Bellwold'), context))
      .resolves.toMatchObject({ text: NPC.topics[0]!.response, choices: [] });
    await expect(queries.get('npc.talk')!(talkQuery(player, NPC_ID, 'the weather'), context))
      .resolves.toMatchObject({ text: NPC.unknownTopicResponse, choices: [] });
  });

  it('uses current daily-job responses in dialogue and topic queries, preferring completion', async () => {
    const board = {
      id: 'market-board',
      locationId: 'market',
      name: 'Market Board',
      slots: [[{
        id: 'bring-fish',
        poster: 'Tomas',
        title: 'Bring a fish',
        supplyTypeId: 'river-fish',
        quantity: 1,
        gold: 3,
        experience: 4,
      }]],
    };
    const cycle = dailyCycle(new Date('2026-10-27T12:00:00.000Z'));
    const job = dailyPostings(board, cycle)[0]!;
    const dailyResponses = [
      { boardId: board.id, jobId: job.id, status: 'active', response: 'You are still looking for a fish.' },
      { boardId: board.id, jobId: job.id, status: 'completed', response: 'The fish was delivered.' },
    ];
    const npc = {
      ...NPC,
      dailyJobResponses: dailyResponses,
      topics: [{
        ...NPC.topics[0]!,
        dailyJobResponses: dailyResponses,
      }],
    };
    const activePlayer = character({
      dailyJobs: [{ boardId: board.id, jobId: job.id, title: job.title, cycle, status: 'active' }],
    });
    const active = harness(activePlayer, { npc, dailyBoards: [board] });
    await expect(active.queries.get('npc.talk')!(talkQuery(activePlayer), active.context))
      .resolves.toMatchObject({ text: 'You are still looking for a fish.' });
    await expect(active.queries.get('npc.talk')!(
      talkQuery(activePlayer, NPC_ID, 'Tell me about Bellwold'),
      active.context,
    )).resolves.toMatchObject({ text: 'You are still looking for a fish.' });

    const completedPlayer = character({
      dailyJobs: [
        { boardId: board.id, jobId: job.id, title: job.title, cycle, status: 'active' },
        { boardId: board.id, jobId: job.id, title: job.title, cycle, status: 'completed' },
      ],
    });
    const completed = harness(completedPlayer, { npc, dailyBoards: [board] });
    await expect(completed.queries.get('npc.talk')!(talkQuery(completedPlayer), completed.context))
      .resolves.toMatchObject({ text: 'The fish was delivered.' });

    const stalePlayer = character({
      dailyJobs: [{ boardId: board.id, jobId: job.id, title: job.title, cycle: '2026-10-26', status: 'completed' }],
    });
    const stale = harness(stalePlayer, { npc, dailyBoards: [board] });
    await expect(stale.queries.get('npc.talk')!(talkQuery(stalePlayer), stale.context))
      .resolves.toMatchObject({ text: NPC.dialogue.prompt });
  });

  it('matches quest responses and reveals conditional dialogue as objectives change', async () => {
    const quest = {
      id: 'market-errand',
      version: '1',
      title: 'Market errand',
      summary: 'Return a keepsake.',
      giverNpcId: NPC_ID,
      turnInNpcId: NPC_ID,
      objectives: [{
        id: 'return-keepsake',
        label: 'Carry the keepsake',
        type: 'possess-item',
        itemId: 'keepsake',
      }],
    };
    const requiresItem = {
      questId: quest.id,
      status: 'active',
      requiresCompletedObjectiveIds: ['return-keepsake'],
      requiresIncompleteObjectiveIds: [],
    };
    const lacksItem = {
      questId: quest.id,
      status: 'active',
      requiresCompletedObjectiveIds: [],
      requiresIncompleteObjectiveIds: ['return-keepsake'],
    };
    const npc = {
      ...NPC,
      dialogue: {
        ...NPC.dialogue,
        questResponses: [
          {
            questId: 'missing-quest',
            requiresCompletedObjectiveIds: [],
            requiresIncompleteObjectiveIds: [],
            response: 'This quest is not here.',
          },
          {
            questId: quest.id,
            status: 'completed',
            requiresCompletedObjectiveIds: [],
            requiresIncompleteObjectiveIds: [],
            response: 'This response is for another state.',
          },
          {
            questId: quest.id,
            status: 'active',
            requiresCompletedObjectiveIds: [],
            requiresIncompleteObjectiveIds: [],
            response: 'A general errand reminder.',
          },
          { ...lacksItem, response: 'The keepsake is still missing.' },
          { ...requiresItem, response: 'You brought the keepsake back.' },
        ],
        choices: [
          {
            id: 'still-needed',
            label: 'I am still looking',
            response: 'Keep looking.',
            progressFlagId: 'still-needed',
            questCondition: lacksItem,
          },
          {
            id: 'return-item',
            label: 'I found the keepsake',
            response: 'Thank you.',
            progressFlagId: 'return-item',
            questCondition: requiresItem,
          },
        ],
      },
      topics: [{
        ...NPC.topics[0]!,
        questResponses: [{ ...lacksItem, response: 'The town still needs that keepsake.' }],
      }],
    };
    const activeQuest = [{ questId: quest.id, definitionVersion: quest.version, status: 'active' }];
    const withoutItem = character({ questProgress: activeQuest });
    const incomplete = harness(withoutItem, { npc, quests: [quest] });
    await expect(incomplete.queries.get('npc.talk')!(talkQuery(withoutItem), incomplete.context))
      .resolves.toMatchObject({
        text: 'The keepsake is still missing.',
        choices: [{ id: 'still-needed' }],
      });
    await expect(incomplete.queries.get('npc.talk')!(
      talkQuery(withoutItem, NPC_ID, 'Tell me about Bellwold'),
      incomplete.context,
    )).resolves.toMatchObject({ text: 'The town still needs that keepsake.' });

    const carryingItem = character({
      questProgress: activeQuest,
      inventory: [{ id: 'keepsake', label: 'Keepsake', description: 'A small token.' }],
    });
    const complete = harness(carryingItem, { npc, quests: [quest] });
    await expect(complete.queries.get('npc.talk')!(talkQuery(carryingItem), complete.context))
      .resolves.toMatchObject({
        text: 'You brought the keepsake back.',
        choices: [{ id: 'return-item' }],
      });
  });

  it('offers only quest actions that the character can currently take with this NPC', async () => {
    const quest = {
      id: 'market-errand',
      version: '1',
      title: 'Market errand',
      summary: 'Help the town.',
      giverNpcId: NPC_ID,
      turnInNpcId: NPC_ID,
      objectives: [],
    };
    const wrongGiverQuest = { ...quest, id: 'other-errand', giverNpcId: 'another-npc' };
    const partyQuest = { ...quest, id: 'party-errand', scope: 'party' };
    const npc = {
      ...NPC,
      dialogue: {
        ...NPC.dialogue,
        choices: [
          {
            id: 'accept',
            label: 'Accept the errand',
            response: 'Thank you.',
            progressFlagId: 'accepted-errand',
            questAction: { type: 'accept', questId: quest.id },
          },
          {
            id: 'wrong-giver',
            label: 'Accept another errand',
            response: 'Not here.',
            progressFlagId: 'wrong-giver',
            questAction: { type: 'accept', questId: wrongGiverQuest.id },
          },
          {
            id: 'party-quest',
            label: 'Accept the party errand',
            response: 'Use party commands.',
            progressFlagId: 'party-quest',
            questAction: { type: 'accept', questId: partyQuest.id },
          },
          {
            id: 'missing-quest',
            label: 'Accept a missing errand',
            response: 'Unavailable.',
            progressFlagId: 'missing-quest',
            questAction: { type: 'accept', questId: 'missing-quest' },
          },
          {
            id: 'turn-in',
            label: 'Report the errand',
            response: 'Well done.',
            progressFlagId: 'reported-errand',
            questAction: { type: 'turn-in', questId: quest.id },
          },
        ],
      },
    };
    const quests = [quest, wrongGiverQuest, partyQuest];
    const available = character();
    const waiting = harness(available, { npc, quests });
    await expect(waiting.queries.get('npc.talk')!(talkQuery(available), waiting.context))
      .resolves.toMatchObject({
        choices: [{ id: 'accept', label: 'Accept the errand' }],
      });

    const active = character({
      questProgress: [{ questId: quest.id, definitionVersion: quest.version, status: 'active' }],
    });
    const readyToReport = harness(active, { npc, quests });
    await expect(readyToReport.queries.get('npc.talk')!(talkQuery(active), readyToReport.context))
      .resolves.toMatchObject({
        choices: [{ id: 'turn-in', label: 'Report the errand' }],
      });
  });

  it('uses an autonomous NPC at the current location when that capability is present', async () => {
    const player = character();
    const roamingNpc = { ...NPC, id: 'roamer', name: 'Roaming Guide' };
    const { queries, context, autonomousAtLocation } = harness(player, {
      autonomousNpcs: [roamingNpc],
    });
    await expect(queries.get('npc.talk')!(talkQuery(player, 'roamer'), context))
      .resolves.toMatchObject({ npcId: 'roamer', npcName: 'Roaming Guide' });
    expect(autonomousAtLocation).toHaveBeenCalledWith(context, player.locationId);
  });

  it('rejects unavailable characters and people who are not in the room', async () => {
    const player = character();
    await expect(harness(player, { characterExists: false }).queries.get('npc.talk')!(
      talkQuery(player),
      harness(player).context,
    )).rejects.toThrow('That character is no longer available.');
    const { queries, context } = harness(player);
    await expect(queries.get('npc.talk')!(talkQuery(player, 'missing-person'), context))
      .rejects.toThrow('That person is not here.');
    await expect(queries.get('npc.talk')!(
      talkQuery(player),
      { ...context, world: { ...context.world, locations: [] } },
    )).rejects.toThrow('The character location is not present in this world version.');

    const archived = character({ archived: true });
    await expect(harness(archived).queries.get('npc.talk')!(
      talkQuery(archived),
      harness(archived).context,
    )).rejects.toThrow('That character is no longer available.');

    const roamingNpc = { ...NPC, id: 'roamer' };
    const autonomous = harness(player, { autonomousNpcs: [roamingNpc] });
    await expect(autonomous.queries.get('npc.talk')!(
      talkQuery(player, 'missing-roamer'),
      autonomous.context,
    )).rejects.toThrow('That person is not here.');
  });
});

describe('NPC dialogue choices', () => {
  it('records an available choice and rejects choices that are locked or already used', async () => {
    const player = character();
    const { commands, context } = harness(player);
    const result = await commands.get('npc.dialogue.choose')!(chooseCommand(player, 'town'), context);
    expect(result).toMatchObject({
      streamId: player.characterId,
      expectedVersion: player.revision,
      events: [{
        type: 'character.npc_dialogue_choice_made',
        payload: {
          npcId: NPC_ID,
          choiceId: 'town',
          progressFlagId: 'asked-town',
        },
      }],
    });
    await expect(commands.get('npc.dialogue.choose')!(chooseCommand(player, 'beyond'), context))
      .rejects.toThrow('That choice is not available here.');

    const progressed = character({
      npcProgress: [{ npcId: NPC_ID, progressFlagIds: ['asked-town'], lastChoiceId: 'town' }],
    });
    await expect(harness(progressed).commands.get('npc.dialogue.choose')!(
      chooseCommand(progressed, 'town'),
      context,
    )).rejects.toThrow('You have already asked about that.');

    const questLockedNpc = {
      ...NPC,
      dialogue: {
        ...NPC.dialogue,
        choices: [{
          id: 'quest-locked',
          label: 'Tell me about the errand',
          response: 'Not yet.',
          progressFlagId: 'quest-locked',
          questCondition: {
            questId: 'missing-quest',
            requiresCompletedObjectiveIds: [],
            requiresIncompleteObjectiveIds: [],
          },
        }],
      },
    };
    const locked = harness(player, { npc: questLockedNpc });
    await expect(locked.commands.get('npc.dialogue.choose')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { npcId: NPC_ID, choiceId: 'quest-locked' },
    }, locked.context)).rejects.toThrow('That choice is not available here.');
  });

  it('rejects missing characters and NPCs when selecting autonomous dialogue', async () => {
    const player = character();
    const missingCharacter = harness(player, { characterExists: false });
    await expect(missingCharacter.commands.get('npc.dialogue.choose')!(
      chooseCommand(player, 'town'),
      missingCharacter.context,
    )).rejects.toThrow('That character is no longer available.');

    const autonomous = harness(player, { autonomousNpcs: [{ ...NPC, id: 'roamer' }] });
    await expect(autonomous.commands.get('npc.dialogue.choose')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { npcId: 'missing-roamer', choiceId: 'town' },
    }, autonomous.context)).rejects.toThrow('That person is not here.');
  });

  it('grants dialogue gifts once and retains item metadata', async () => {
    const player = character();
    const { commands, context } = harness(player);
    const result = await commands.get('npc.dialogue.choose')!(chooseCommand(player, 'gift'), context);
    expect(result).toMatchObject({
      events: [
        { type: 'character.npc_dialogue_choice_made' },
        {
          type: 'character.item_granted',
          payload: {
            item: {
              id: 'old-rod',
              typeId: 'old-fishing-rod',
              fishingRod: { qualityId: 'old', biteChancePercent: 10, waitSeconds: 10 },
            },
          },
        },
      ],
    });
    const alreadyReceived = character({ inventory: [{ id: 'old-rod', label: 'Old rod', description: 'A rod.' }] });
    await expect(harness(alreadyReceived).commands.get('npc.dialogue.choose')!(
      chooseCommand(alreadyReceived, 'gift'),
      context,
    )).rejects.toThrow('You already received that item.');
  });

  it('accepts a character quest from its giver and rejects missing or party quests', async () => {
    const quest = {
      id: 'market-errand',
      version: '1',
      title: 'Market errand',
      summary: 'Help the town.',
      giverNpcId: NPC_ID,
      turnInNpcId: NPC_ID,
      objectives: [],
    };
    const npc = {
      ...NPC,
      dialogue: {
        ...NPC.dialogue,
        choices: [{
          id: 'accept',
          label: 'I can help',
          response: 'Thank you.',
          progressFlagId: 'accepted-errand',
          questAction: { type: 'accept', questId: quest.id },
        }],
      },
    };
    const player = character();
    const { commands, context } = harness(player, { npc, quests: [quest] });
    const accepted = await commands.get('npc.dialogue.choose')!(chooseCommand(player, 'accept'), context);
    expect(accepted).toMatchObject({
      events: [
        { type: 'character.npc_dialogue_choice_made' },
        { type: 'quest.accepted', payload: { questId: quest.id, definitionVersion: quest.version } },
      ],
    });
    const partyQuest = { ...quest, scope: 'party' };
    const party = harness(player, { npc, quests: [partyQuest] });
    await expect(party.commands.get('npc.dialogue.choose')!(
      chooseCommand(player, 'accept'),
      party.context,
    )).rejects.toThrow('Party quests are accepted through the party commands.');
    const missing = harness(player, { npc, quests: [] });
    await expect(missing.commands.get('npc.dialogue.choose')!(
      chooseCommand(player, 'accept'),
      missing.context,
    )).rejects.toThrow('That quest is not available in this world.');
    const wrongGiver = harness(player, {
      npc,
      quests: [{ ...quest, giverNpcId: 'another-npc' }],
    });
    await expect(wrongGiver.commands.get('npc.dialogue.choose')!(
      chooseCommand(player, 'accept'),
      wrongGiver.context,
    )).rejects.toThrow('That quest is no longer available.');
  });

  it('completes an active quest and grants its configured currency and carried-item reward', async () => {
    const quest = {
      id: 'market-errand',
      version: '1',
      title: 'Market errand',
      summary: 'Help the town.',
      giverNpcId: NPC_ID,
      turnInNpcId: NPC_ID,
      objectives: [],
      reward: { currencyId: 'moss-mark', amount: 5, itemIds: ['keepsake'] },
    };
    const npc = {
      ...NPC,
      dialogue: {
        ...NPC.dialogue,
        choices: [{
          id: 'turn-in',
          label: 'I finished the errand',
          response: 'Well done.',
          progressFlagId: 'reported-errand',
          questAction: { type: 'turn-in', questId: quest.id },
        }],
      },
    };
    const player = {
      ...character({ inventory: [{ id: 'keepsake', label: 'Keepsake', description: 'A small token.' }] }),
      questProgress: [{ questId: quest.id, status: 'active' }],
    } as ReturnType<typeof character>;
    const { commands, context } = harness(player, { npc, quests: [quest] });
    const result = await commands.get('npc.dialogue.choose')!(chooseCommand(player, 'turn-in'), context);
    expect(result).toMatchObject({
      events: [
        { type: 'character.npc_dialogue_choice_made' },
        { type: 'quest.completed', payload: { questId: quest.id, definitionVersion: '1' } },
        {
          type: 'character.quest_rewarded',
          payload: {
            questId: quest.id,
            currencyId: 'moss-mark',
            amount: 5,
            itemIds: ['keepsake'],
          },
        },
      ],
    });
  });

  it('requires a ready wallet, matching world currency, and carried quest items for rewards', async () => {
    const quest = {
      id: 'market-errand',
      version: '1',
      title: 'Market errand',
      summary: 'Help the town.',
      giverNpcId: NPC_ID,
      turnInNpcId: NPC_ID,
      objectives: [],
      reward: { currencyId: 'moss-mark', amount: 5, itemIds: ['keepsake'] },
    };
    const npc = {
      ...NPC,
      dialogue: {
        ...NPC.dialogue,
        choices: [{
          id: 'turn-in',
          label: 'I finished the errand',
          response: 'Well done.',
          progressFlagId: 'reported-errand',
          questAction: { type: 'turn-in', questId: quest.id },
        }],
      },
    };
    const activePlayer = {
      ...character({ inventory: [{ id: 'keepsake', label: 'Keepsake', description: 'A token.' }] }),
      questProgress: [{ questId: quest.id, status: 'active' }],
    } as ReturnType<typeof character>;
    const walletless = harness({ ...activePlayer, wallet: undefined } as ReturnType<typeof character>, {
      npc, quests: [quest],
    });
    await expect(walletless.commands.get('npc.dialogue.choose')!(
      chooseCommand(activePlayer, 'turn-in'),
      walletless.context,
    )).rejects.toThrow('This character’s wallet is not ready yet.');

    const wrongCurrency = harness({
      ...activePlayer,
      wallet: { currencyId: 'other', balance: 20 },
    } as ReturnType<typeof character>, { npc, quests: [quest] });
    await expect(wrongCurrency.commands.get('npc.dialogue.choose')!(
      chooseCommand(activePlayer, 'turn-in'),
      wrongCurrency.context,
    )).rejects.toThrow('This character’s wallet is not ready yet.');

    const fullWallet = harness({
      ...activePlayer,
      wallet: { currencyId: 'moss-mark', balance: 2_147_483_647 },
    } as ReturnType<typeof character>, { npc, quests: [quest] });
    await expect(fullWallet.commands.get('npc.dialogue.choose')!(
      chooseCommand(activePlayer, 'turn-in'),
      fullWallet.context,
    )).rejects.toThrow('Your wallet cannot hold that quest reward.');

    const wrongRewardCurrency = harness(activePlayer, {
      npc,
      quests: [{
        ...quest,
        reward: { ...quest.reward, currencyId: 'other-currency' },
      }],
    });
    await expect(wrongRewardCurrency.commands.get('npc.dialogue.choose')!(
      chooseCommand(activePlayer, 'turn-in'),
      wrongRewardCurrency.context,
    )).rejects.toThrow('That quest reward is not configured for this world.');

    const missingItem = harness({
      ...activePlayer,
      inventory: [],
    } as ReturnType<typeof character>, {
      npc,
      quests: [quest],
      takeables: [{ id: 'keepsake', label: 'Keepsake', description: 'A small token.' }],
    });
    await expect(missingItem.commands.get('npc.dialogue.choose')!(
      chooseCommand(activePlayer, 'turn-in'),
      missingItem.context,
    )).rejects.toThrow('You must carry Keepsake before claiming this quest reward.');
  });

  it('does not complete quests that are not active or whose objectives remain unfinished', async () => {
    const quest = {
      id: 'market-errand',
      version: '1',
      title: 'Market errand',
      summary: 'Help the town.',
      giverNpcId: NPC_ID,
      turnInNpcId: NPC_ID,
      objectives: [{ id: 'objective-1', type: 'visit-location', locationId: 'market' }],
    };
    const npc = {
      ...NPC,
      dialogue: {
        ...NPC.dialogue,
        choices: [{
          id: 'turn-in',
          label: 'I finished the errand',
          response: 'Not yet.',
          progressFlagId: 'reported-errand',
          questAction: { type: 'turn-in', questId: quest.id },
        }],
      },
    };
    const player = {
      ...character(),
      questProgress: [{ questId: quest.id, status: 'active', definitionVersion: quest.version }],
    } as ReturnType<typeof character>;
    const { commands, context } = harness(player, { npc, quests: [quest] });
    await expect(commands.get('npc.dialogue.choose')!(chooseCommand(player, 'turn-in'), context))
      .rejects.toThrow('You have more to do before reporting back.');
  });

  it('restarts conversations while preserving completed item and quest rewards', async () => {
    const player = character({
      npcProgress: [{
        npcId: NPC_ID,
        progressFlagIds: ['asked-town', 'accepted-rod'],
        lastChoiceId: 'town',
      }],
    });
    const { commands, context } = harness(player);
    const result = await commands.get('npc.dialogue.restart')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { npcId: NPC_ID },
    }, context);
    expect(result).toMatchObject({
      events: [{
        type: 'character.npc_dialogue_restarted',
        payload: {
          npcId: NPC_ID,
          preservedProgressFlagIds: ['accepted-rod'],
        },
      }],
    });

    const unavailable = harness(player, { characterExists: false });
    await expect(unavailable.commands.get('npc.dialogue.restart')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { npcId: NPC_ID },
    }, unavailable.context)).rejects.toThrow('That character is no longer available.');
  });

  it('rejects invalid dialogue selections and unavailable restarts', async () => {
    const player = character();
    const { commands, context } = harness(player);
    await expect(commands.get('npc.dialogue.choose')!(chooseCommand(player, 'missing'), context))
      .rejects.toThrow('That choice is not available here.');
    const defeated = character({ health: { current: 0, maximum: 10 } });
    await expect(harness(defeated).commands.get('npc.dialogue.choose')!(
      chooseCommand(defeated, 'town'),
      context,
    )).rejects.toThrow();
    await expect(commands.get('npc.dialogue.restart')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { npcId: 'missing' },
    }, context)).rejects.toThrow('That conversation is not available in this world.');
    await expect(commands.get('npc.dialogue.restart')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { npcId: NPC_ID },
    }, context)).rejects.toThrow('There is no conversation to restart.');
  });
});
