import { describe, expect, it, vi } from 'vitest';
import { CharacterProjectionSchema } from '@mudd/contracts';
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

function world(options: { npc?: Record<string, unknown>; quests?: Array<Record<string, unknown>> } = {}) {
  return {
    locations: [{ id: 'market', npcs: [options.npc ?? NPC], takeables: [] }],
    quests: options.quests ?? [],
    dailyBoards: [],
    currency: { id: 'moss-mark', name: 'moss mark', symbol: 'm' },
  };
}

function harness(
  player: ReturnType<typeof character>,
  options: {
    npc?: Record<string, unknown>;
    quests?: Array<Record<string, unknown>>;
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

    const missingItem = harness({
      ...activePlayer,
      inventory: [],
    } as ReturnType<typeof character>, { npc, quests: [quest] });
    await expect(missingItem.commands.get('npc.dialogue.choose')!(
      chooseCommand(activePlayer, 'turn-in'),
      missingItem.context,
    )).rejects.toThrow('You must carry the required item before claiming this quest reward.');
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
