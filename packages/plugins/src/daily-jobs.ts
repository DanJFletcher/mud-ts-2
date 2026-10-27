import {
  DailyBoardQuerySchema, DailyBoardProjectionSchema, DailyJobCommandSchema,
  GatherSupplyCommandSchema, dailyCycle, dailyPostings,
  DailyJobChangedEventSchema, SupplyGatheredEventSchema,
  characterHasEquippedItem,
  type CharacterProjection, type WorldPackDraft,
} from '@mudd/contracts';
import { RuleViolationError, type EnginePlugin } from '@mudd/engine-core';
import { assertCharacterAlive, assertCharacterStanding, isInSharedCombat, characterStateCapability, type CharacterStateCapability } from './character.js';
import { maximumHealthForLevel, levelAfterExperience } from './character-stats.js';
import { worldItemsStateCapability, worldItemsStreamId, type WorldItemsStateCapability } from './world-items.js';

function available(character: CharacterProjection | undefined): asserts character is CharacterProjection {
  if (!character || character.archived) throw new RuleViolationError('Choose an available character first.');
}
function actionable(character: CharacterProjection) {
  assertCharacterAlive(character);
  assertCharacterStanding(character);
  if (character.combat?.status === 'active') throw new RuleViolationError('Finish the encounter first.');
}
function boardAt(world: WorldPackDraft, character: CharacterProjection, boardId: string) {
  const board = world.dailyBoards.find((candidate) => candidate.id === boardId);
  if (!board || character.locationId !== board.locationId) throw new RuleViolationError('Visit that bulletin board first.');
  return board;
}
function supplies(character: CharacterProjection, typeId: string) {
  return character.inventory.filter((item) => item.typeId === typeId && !item.questBound &&
    !characterHasEquippedItem(character.equipment, item.id));
}
function supplyCount(character: CharacterProjection, typeId: string) {
  return supplies(character, typeId).reduce((count, item) => count + (item.quantity ?? 1), 0);
}
function chooseSupplies(character: CharacterProjection, typeId: string, quantity: number) {
  let remaining = quantity;
  const items: CharacterProjection['inventory'] = [];
  const consumedItemIds: string[] = [];
  const consumedItemQuantities: Array<{ itemId: string; quantity: number }> = [];
  const eligible = supplies(character, typeId).sort((a, b) =>
    Number(Boolean(a.sharedItemId)) - Number(Boolean(b.sharedItemId)),
  );
  for (const item of eligible) {
    if (!remaining) break;
    const available = item.quantity ?? 1;
    const consumed = Math.min(available, remaining);
    items.push({ ...item, ...(item.stackable ? { quantity: consumed } : {}) });
    if (consumed === available) consumedItemIds.push(item.id);
    else consumedItemQuantities.push({ itemId: item.id, quantity: consumed });
    remaining -= consumed;
  }
  return remaining ? undefined : { items, consumedItemIds, consumedItemQuantities };
}

export const dailyJobsPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.daily-jobs', version: '1.0.0', apiVersion: '1.0', category: 'first-party',
    requires: [characterStateCapability.id, worldItemsStateCapability.id],
    requiredPlugins: { 'mudd.character': '^1.0.0', 'mudd.world-items': '^1.0.0' },
  },
  validateWorld(world) {
    const ids = new Set<string>();
    for (const board of world.dailyBoards) {
      if (ids.has(board.id) || !world.locations.some((room) => room.id === board.locationId) || !world.currency) {
        throw new Error('Daily boards require unique IDs, a valid location, and currency.');
      }
      ids.add(board.id);
      const jobs = board.slots.flat();
      if (new Set(jobs.map((job) => job.id)).size !== jobs.length) throw new Error('Duplicate daily job ID.');
    }
    const sources = new Set<string>();
    for (const source of world.supplySources) {
      if (sources.has(source.id) || !world.locations.some((room) => room.id === source.locationId)) {
        throw new Error('Supply sources require unique IDs and a valid location.');
      }
      sources.add(source.id);
    }
  },
  register({ registerCommand, registerQuery, requireCapability }) {
    const characters = requireCapability<CharacterStateCapability>(characterStateCapability);
    const worldItems = requireCapability<WorldItemsStateCapability>(worldItemsStateCapability);
    registerQuery('daily.board', DailyBoardQuerySchema, async (query, context) => {
      const character = await characters.load(context, query.characterId);
      available(character);
      const board = boardAt(context.world, character, query.payload.boardId);
      const cycle = dailyCycle(context.now());
      return DailyBoardProjectionSchema.parse({
        boardId: board.id, name: board.name, cycle,
        resetsAt: new Date(Date.parse(`${cycle}T00:00:00.000Z`) + 86400000).toISOString(),
        jobs: dailyPostings(board, cycle).map((offered) => {
          const accepted = character.dailyJobs.find((entry) => entry.boardId === board.id && entry.cycle === cycle && entry.jobId === offered.id);
          const job = accepted?.details ?? offered;
          return { ...job, carried: supplyCount(character, job.supplyTypeId), status: accepted?.status ?? 'available' };
        }),
      });
    });
    registerCommand('daily.job', DailyJobCommandSchema, async (command, context) => {
      const character = await characters.load(context, command.characterId);
      available(character);
      actionable(character);
      if (await isInSharedCombat(context, character.characterId)) throw new RuleViolationError('Finish the encounter first.');
      const board = boardAt(context.world, character, command.payload.boardId);
      const cycle = dailyCycle(context.now());
      if (command.payload.cycle !== cycle) throw new RuleViolationError('The bulletin refreshed. Read the new jobs.');
      const offered = dailyPostings(board, cycle).find((entry) => entry.id === command.payload.jobId);
      if (!offered) throw new RuleViolationError('That job is not posted today.');
      const previous = character.dailyJobs.find((entry) => entry.boardId === board.id && entry.cycle === cycle && entry.jobId === offered.id);
      const completing = command.payload.action === 'deliver';
      const job = completing ? previous?.details ?? offered : offered;
      if (completing ? previous?.status !== 'active' : previous !== undefined) {
        throw new RuleViolationError(completing ? 'Accept this job first; completed jobs cannot be delivered again.' : 'You already accepted this job.');
      }
      const currency = context.world.currency;
      if (!currency || character.wallet?.currencyId !== currency.id) throw new RuleViolationError('Your wallet is not ready.');
      const selection = completing ? chooseSupplies(character, job.supplyTypeId, job.quantity) : undefined;
      if (completing && !selection) throw new RuleViolationError(`Bring ${job.quantity} eligible supplies for this job.`);
      const items = selection?.items ?? [];
      const gold = completing ? job.gold : 0;
      const experience = completing ? job.experience : 0;
      if (character.wallet.balance + gold > 2147483647) throw new RuleViolationError('Your wallet is full.');
      const total = (character.advancement?.experience ?? 0) + experience;
      if (!Number.isSafeInteger(total)) throw new RuleViolationError('Experience limit reached.');
      const level = levelAfterExperience(character.advancement?.level ?? 1, total);
      const payload = DailyJobChangedEventSchema.shape.payload.parse({
        characterId: character.characterId,
        job: { boardId: board.id, cycle, jobId: job.id, title: job.title, details: job, status: completing ? 'completed' : 'active' },
        consumedItemIds: selection?.consumedItemIds ?? [],
        consumedItemQuantities: selection?.consumedItemQuantities ?? [],
        gold, experience, currencyId: currency.id,
        level, maximumHealth: maximumHealthForLevel(level, character.attributes.constitution),
      });
      const sharedIds = items.flatMap((item) => item.sharedItemId ? [item.sharedItemId] : []);
      const shared = sharedIds.length ? await worldItems.load(context) : undefined;
      if (shared && sharedIds.some((id) => !shared.items.some((item) =>
        item.worldItemId === id && item.holderCharacterId === character.characterId))) {
        throw new RuleViolationError('Those supplies are not yours to deliver.');
      }
      return { streamId: character.characterId, expectedVersion: command.expectedVersion,
        ...(shared ? { companions: [{
          streamId: worldItemsStreamId(context.worldInstanceId), expectedVersion: shared.revision,
          events: [{ type: 'world.items_consumed', version: 1,
            payload: { characterId: character.characterId, worldItemIds: sharedIds } }],
        }] } : {}),
        events: [{ type: 'character.daily_job_changed', version: 1, payload }] };
    });
    registerCommand('supply.gather', GatherSupplyCommandSchema, async (command, context) => {
      const character = await characters.load(context, command.characterId);
      available(character);
      actionable(character);
      if (await isInSharedCombat(context, character.characterId)) throw new RuleViolationError('Finish the encounter first.');
      const cycle = dailyCycle(context.now());
      if (command.payload.cycle !== cycle) throw new RuleViolationError('The day changed. Refresh your supplies.');
      const source = context.world.supplySources.find((entry) => entry.id === command.payload.sourceId && entry.locationId === character.locationId);
      if (!source) throw new RuleViolationError('You cannot collect that supply here.');
      const count = character.supplyCollections.find((entry) => entry.sourceId === source.id && entry.cycle === cycle)?.count ?? 0;
      if (count >= source.dailyLimit) throw new RuleViolationError('You have collected today’s allowance from this source.');
      const payload = SupplyGatheredEventSchema.shape.payload.parse({
        characterId: character.characterId, sourceId: source.id, cycle,
        item: { ...source.supply, id: `supply:${context.makeId()}` },
      });
      return { streamId: character.characterId, expectedVersion: command.expectedVersion,
        events: [{ type: 'character.supply_gathered', version: 1, payload }] };
    });
  },
};
