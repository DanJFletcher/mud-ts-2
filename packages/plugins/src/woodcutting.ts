import {
  WoodcuttingActionAdvancedEventSchema,
  WoodcuttingActionStartedEventSchema,
  WoodcuttingActionStateSchema,
  StartWoodcuttingCommandSchema,
  AdvanceWoodcuttingCommandSchema,
  CancelWoodcuttingCommandSchema,
  WorldTreeHarvestedEventSchema,
  type WoodcuttingTreeDefinition,
  type WorldPackDraft,
} from '@mudd/contracts';
import { RuleViolationError, type EnginePlugin } from '@mudd/engine-core';
import {
  assertCharacterAlive,
  assertCharacterStanding,
  characterStateCapability,
  isInSharedCombat,
  type CharacterStateCapability,
} from './character.js';
import { interruptActiveTimedActions } from './timed-action-interruption.js';

export const WOODCUTTING_TREES_STREAM_ID = 'woodcutting-trees';

type TreeState = { remainingLogs: number; respawnsAt: string | null };

function levelForExperience(experience: number): number {
  let level = 1;
  while (level < 99 && experience >= 25 * level * level) level += 1;
  return level;
}

function projectTrees(events: readonly { type: string; payload: unknown }[]) {
  const trees = new Map<string, TreeState>();
  for (const event of events) {
    if (event.type !== 'world.tree_harvested') continue;
    const harvested = WorldTreeHarvestedEventSchema.shape.payload.parse(event.payload);
    trees.set(harvested.treeId, {
      remainingLogs: harvested.remainingLogs,
      respawnsAt: harvested.respawnsAt,
    });
  }
  return trees;
}

function currentTreeState(
  tree: WoodcuttingTreeDefinition,
  state: TreeState | undefined,
  now: Date,
): TreeState {
  if (!state || (state.respawnsAt && Date.parse(state.respawnsAt) <= now.getTime())) {
    return { remainingLogs: tree.maximumLogs, respawnsAt: null };
  }
  return state;
}

export type WoodcuttingTreePresence = {
  id: string;
  locationId: string;
  label: string;
  available: boolean;
  description: string;
};

export function projectWoodcuttingTreePresence(
  trees: readonly WoodcuttingTreeDefinition[],
  events: readonly { type: string; payload: unknown }[],
  now: Date,
): WoodcuttingTreePresence[] {
  const states = projectTrees(events);
  return trees.map((tree) => {
    const state = currentTreeState(tree, states.get(tree.id), now);
    const available = state.remainingLogs > 0;
    return {
      id: tree.id,
      locationId: tree.locationId,
      label: tree.label,
      available,
      description: available ? tree.roomDescription : tree.stumpDescription,
    };
  });
}

function axeChance(baseChance: number, level: number, power: number): number {
  return Math.min(90, baseChance + Math.floor((level - 1) / 5) + (power - 1) * 3);
}

function treeStreamVersion(events: readonly { aggregateVersion: number }[]) {
  return events.at(-1)?.aggregateVersion ?? 0;
}

export function validateWoodcuttingTrees(world: WorldPackDraft): void {
  const ids = new Set<string>();
  for (const tree of world.woodcuttingTrees) {
    if (ids.has(tree.id) || !world.locations.some(({ id }) => id === tree.locationId)) {
      throw new Error('Woodcutting trees require unique IDs and a valid location.');
    }
    ids.add(tree.id);
  }
}

export const woodcuttingPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.woodcutting',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'first-party',
    requires: [characterStateCapability.id],
    requiredPlugins: { 'mudd.character': '^1.0.0' },
    eventSchemaVersions: {
      'character.woodcutting_action_started': 1,
      'character.woodcutting_action_advanced': 1,
      'world.tree_harvested': 1,
    },
  },
  validateWorld: validateWoodcuttingTrees,
  register({ registerCommand, requireCapability }) {
    const characters = requireCapability<CharacterStateCapability>(characterStateCapability);

    registerCommand('woodcutting.start', StartWoodcuttingCommandSchema, async (command, context) => {
      const character = await characters.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      assertCharacterAlive(character);
      assertCharacterStanding(character);
      if (character.combat?.status === 'active' || await isInSharedCombat(context, character.characterId)) {
        throw new RuleViolationError('You cannot chop wood during combat.');
      }

      const tree = context.world.woodcuttingTrees.find((candidate) =>
        candidate.id === command.payload.treeId && candidate.locationId === character.locationId);
      if (!tree) throw new RuleViolationError('There is no tree by that name here.');
      const axe = character.inventory.find((item) => item.id === command.payload.axeItemId);
      if (!axe?.woodcuttingAxe) throw new RuleViolationError('You need to carry a woodcutting axe.');
      const skill = character.woodcutting ?? { experience: 0, level: 1 };
      if (skill.level < axe.woodcuttingAxe.requiredLevel) {
        throw new RuleViolationError(`Woodcutting level ${axe.woodcuttingAxe.requiredLevel} is required to use that axe.`);
      }

      const treeEvents = await context.store.readStream(context.worldInstanceId, WOODCUTTING_TREES_STREAM_ID);
      const stock = currentTreeState(tree, projectTrees(treeEvents).get(tree.id), context.now());
      if (stock.remainingLogs <= 0) {
        throw new RuleViolationError('Only a stump remains where that tree stood.');
      }

      const action = WoodcuttingActionStateSchema.parse({
        actionId: context.makeId(),
        treeId: tree.id,
        treeLabel: tree.label,
        axeItemId: axe.id,
        locationId: character.locationId,
        startedAt: context.now().toISOString(),
        ticksCompleted: 0,
        ticksRequired: 10,
      });
      const payload = { characterId: character.characterId, action };
      WoodcuttingActionStartedEventSchema.shape.payload.parse(payload);
      return {
        streamId: character.characterId,
        expectedVersion: command.expectedVersion,
        events: [
          ...interruptActiveTimedActions(character),
          { type: 'character.woodcutting_action_started', version: 1, payload },
        ],
      };
    });

    registerCommand('woodcutting.advance', AdvanceWoodcuttingCommandSchema, async (command, context) => {
      const character = await characters.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      const action = character.activeWoodcutting;
      if (!action || action.actionId !== command.payload.actionId) {
        throw new RuleViolationError('That woodcutting action is no longer active.');
      }
      const tree = context.world.woodcuttingTrees.find(({ id }) => id === action.treeId);
      const axeItem = character.inventory.find(({ id }) => id === action.axeItemId);
      const axe = axeItem?.woodcuttingAxe;
      const treeEvents = await context.store.readStream(context.worldInstanceId, WOODCUTTING_TREES_STREAM_ID);
      const state = tree ? currentTreeState(tree, projectTrees(treeEvents).get(tree.id), context.now()) : undefined;

      const finish = (
        status: 'interrupted' | 'tree-depleted',
        tickRolls: Array<{ tick: number; roll: number; success: boolean }> = [],
      ) => {
        const payload = {
          characterId: character.characterId,
          actionId: action.actionId,
          ticksCompleted: action.ticksCompleted,
          status,
          tickRolls,
          skillExperienceAwarded: 0,
          totalExperience: character.woodcutting?.experience ?? 0,
          level: character.woodcutting?.level ?? 1,
        };
        WoodcuttingActionAdvancedEventSchema.shape.payload.parse(payload);
        return {
          streamId: character.characterId,
          expectedVersion: command.expectedVersion,
          events: [{ type: 'character.woodcutting_action_advanced', version: 1, payload }],
        };
      };

      if (!tree || !state || !axe || character.locationId !== action.locationId ||
          character.combat?.status === 'active' || character.combat?.status === 'defeat' ||
          character.health?.current === 0 || character.staminaRecovery.posture === 'resting' ||
          await isInSharedCombat(context, character.characterId)) {
        return finish('interrupted');
      }
      assertCharacterAlive(character);
      assertCharacterStanding(character);
      if (state.remainingLogs <= 0) return finish('tree-depleted');

      const elapsedTicks = Math.min(
        action.ticksRequired,
        Math.floor((context.now().getTime() - Date.parse(action.startedAt)) / 1000),
      );
      const dueTicks = elapsedTicks - action.ticksCompleted;
      if (dueTicks <= 0) throw new RuleViolationError('Your axe is still swinging.');

      const skill = character.woodcutting ?? { experience: 0, level: 1 };
      const chance = axeChance(tree.baseChancePercent, skill.level, axe.power);
      const tickRolls: Array<{ tick: number; roll: number; success: boolean }> = [];
      let status: 'waiting' | 'logged' | 'no-log' = 'waiting';
      let ticksCompleted = action.ticksCompleted;
      for (let offset = 0; offset < dueTicks; offset += 1) {
        const roll = context.rng.roll(100);
        const success = roll <= chance;
        ticksCompleted += 1;
        tickRolls.push({ tick: ticksCompleted, roll: roll / 100, success });
        if (success) {
          status = 'logged';
          break;
        }
      }
      if (status !== 'logged' && ticksCompleted >= action.ticksRequired) status = 'no-log';

      let item: {
        id: string; typeId: string; label: string; description: string;
        stackable: true; quantity: number;
      } | undefined;
      let stackItemId: string | undefined;
      let stackQuantity: number | undefined;
      let totalExperience = skill.experience;
      let level = skill.level;
      let companions = undefined;
      let treeDepleted: boolean | undefined;

      if (status === 'logged') {
        const existingStack = character.inventory.find((entry) =>
          entry.stackable && entry.typeId === tree.logTypeId);
        if (existingStack) {
          stackItemId = existingStack.id;
          stackQuantity = (existingStack.quantity ?? 1) + 1;
        } else {
          item = {
            id: `logs-${context.makeId()}`,
            typeId: tree.logTypeId,
            label: tree.logLabel,
            description: tree.logDescription,
            stackable: true,
            quantity: 1,
          };
        }
        totalExperience += tree.experiencePerLog;
        level = levelForExperience(totalExperience);

        const remainingLogs = state.remainingLogs - 1;
        treeDepleted = remainingLogs === 0;
        const respawnsAt = remainingLogs === 0
          ? new Date(context.now().getTime() + tree.respawnSeconds * 1000).toISOString()
          : null;
        const treePayload = {
          treeId: tree.id,
          characterId: character.characterId,
          remainingLogs,
          respawnsAt,
        };
        WorldTreeHarvestedEventSchema.shape.payload.parse(treePayload);
        companions = [{
          streamId: WOODCUTTING_TREES_STREAM_ID,
          expectedVersion: treeStreamVersion(treeEvents),
          events: [{ type: 'world.tree_harvested', version: 1, payload: treePayload }],
        }];
      }

      const payload = {
        characterId: character.characterId,
        actionId: action.actionId,
        ticksCompleted,
        status,
        tickRolls,
        skillExperienceAwarded: status === 'logged' ? tree.experiencePerLog : 0,
        totalExperience,
        level,
        ...(status === 'logged' ? { logLabel: tree.logLabel } : {}),
        ...(status === 'logged' ? { logTypeId: tree.logTypeId } : {}),
        ...(item ? { item } : {}),
        ...(stackItemId ? { stackItemId, stackQuantity } : {}),
        ...(treeDepleted !== undefined ? { treeDepleted } : {}),
      };
      WoodcuttingActionAdvancedEventSchema.shape.payload.parse(payload);
      return {
        streamId: character.characterId,
        expectedVersion: command.expectedVersion,
        ...(companions ? { companions } : {}),
        events: [{ type: 'character.woodcutting_action_advanced', version: 1, payload }],
      };
    });

    registerCommand('woodcutting.cancel', CancelWoodcuttingCommandSchema, async (command, context) => {
      const character = await characters.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      const action = character.activeWoodcutting;
      if (!action || action.actionId !== command.payload.actionId) {
        throw new RuleViolationError('That woodcutting action is no longer active.');
      }
      const payload = {
        characterId: character.characterId,
        actionId: action.actionId,
        ticksCompleted: action.ticksCompleted,
        status: 'interrupted' as const,
        tickRolls: [],
        skillExperienceAwarded: 0,
        totalExperience: character.woodcutting?.experience ?? 0,
        level: character.woodcutting?.level ?? 1,
      };
      WoodcuttingActionAdvancedEventSchema.shape.payload.parse(payload);
      return {
        streamId: character.characterId,
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.woodcutting_action_advanced', version: 1, payload }],
      };
    });
  },
};
