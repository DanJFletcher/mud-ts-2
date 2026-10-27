import type { WorldPackDraft } from '@mudd/contracts';
import { EngineHost } from '@mudd/engine-core';
import {
  characterPlugin,
  dailyJobsPlugin,
  fishingPlugin,
  woodcuttingPlugin,
  craftingPlugin,
  createClassRulesetPlugin,
  createLocationGroupsPlugin,
  autonomousNpcsPlugin,
  combatPlugin,
  groupsPlugin,
  interactionPlugin,
  merchantPlugin,
  movementPlugin,
  roadTravelPlugin,
  npcDialoguePlugin,
  partyPlugin,
  partyQuestPlugin,
  partyCombatPolicyPlugin,
  teamCombatPlugin,
  worldItemsPlugin,
  objectLifecyclePlugin,
  corpseLifecyclePlugin,
} from '@mudd/core-plugins';
import { DEMO_WORLD_INSTANCE_ID, demoWorld } from '@mudd/world-demo';
import {
  ORRAVETH_WORLD_INSTANCE_ID,
  ORRAVETH_WORLD_SUMMARY,
  orravethWorld,
} from '@mudd/world-orraveth';
import type { EventStorePort, AuthorizationPort } from '@mudd/engine-core';
import { PostgresLocationGroupCatalogStore } from './location-group-store.js';
import { combatPresencePlugin } from './combat-presence-plugin.js';
import { worldEventEffectsPlugin } from './demo-event-effects-plugin.js';

export interface RegisteredWorld {
  readonly worldInstanceId: string;
  readonly world: WorldPackDraft;
  readonly summary: string;
  readonly introduction?: readonly string[];
  readonly coverImage?: string;
}

export interface WorldRuntime extends RegisteredWorld {
  readonly engine: EngineHost;
  readonly locationGroupsFeature: ReturnType<typeof createLocationGroupsPlugin>;
}

export const registeredWorlds: readonly RegisteredWorld[] = [
  {
    worldInstanceId: DEMO_WORLD_INSTANCE_ID,
    world: demoWorld,
    summary: 'A first journey through Mossgate, Glasswater, and the old bell tower.',
    introduction: [
      'Begin in Mossgate Clearing and follow the paths through Glasswater and the old bell tower.',
      'Meet travelers, uncover local puzzles, and make your way through a shared world. This is the MUDD demonstration world.',
    ],
  },
  {
    worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
    world: orravethWorld,
    summary: ORRAVETH_WORLD_SUMMARY,
    introduction: [
      'Start in Bellwold, a trading settlement near the Crown of Heskar frontier. Its market, homes, and roads hold stories of the people who live here.',
      'Talk with the townsfolk, explore beyond the village, and discover the wider world of Orraveth. The Orraveth Codex records its people, places, and history.',
    ],
  },
];

export function createWorldRuntimes(
  store: EventStorePort,
  authorization: AuthorizationPort,
): Map<string, WorldRuntime> {
  const runtimes = new Map<string, WorldRuntime>();
  for (const definition of registeredWorlds) {
    const locationGroupsFeature = createLocationGroupsPlugin(
      definition.world,
      new PostgresLocationGroupCatalogStore(),
    );
    const plugins = [
      ...(definition.world.classCatalog ? [createClassRulesetPlugin(definition.world.classCatalog)] : []),
      objectLifecyclePlugin,
      worldItemsPlugin,
      corpseLifecyclePlugin,
      locationGroupsFeature.plugin,
      autonomousNpcsPlugin,
      characterPlugin,
      groupsPlugin,
      partyPlugin,
      partyQuestPlugin,
      interactionPlugin,
      combatPlugin,
      combatPresencePlugin,
      partyCombatPolicyPlugin,
      teamCombatPlugin,
      movementPlugin,
      roadTravelPlugin,
      npcDialoguePlugin,
      merchantPlugin,
      dailyJobsPlugin,
      fishingPlugin,
      woodcuttingPlugin,
      craftingPlugin,
      worldEventEffectsPlugin,
    ];
    runtimes.set(definition.worldInstanceId, {
      ...definition,
      locationGroupsFeature,
      engine: new EngineHost(plugins, store, authorization, definition.world),
    });
  }
  return runtimes;
}

export async function startWorldRuntimes(runtimes: ReadonlyMap<string, WorldRuntime>): Promise<void> {
  const started: WorldRuntime[] = [];
  try {
    for (const runtime of runtimes.values()) {
      await runtime.engine.start();
      started.push(runtime);
    }
  } catch (error) {
    await Promise.all(started.reverse().map(({ engine }) => engine.stop().catch(() => undefined)));
    throw error;
  }
}

export async function stopWorldRuntimes(runtimes: ReadonlyMap<string, WorldRuntime>): Promise<void> {
  await Promise.all([...runtimes.values()].reverse().map(({ engine }) => engine.stop()));
}

export function toWorldSummary(world: RegisteredWorld) {
  return {
    worldInstanceId: world.worldInstanceId,
    packId: world.world.packId,
    name: world.world.displayName,
    summary: world.summary,
    ...(world.introduction ? { introduction: [...world.introduction] } : {}),
    ...(world.coverImage ? { coverImage: world.coverImage } : {}),
    ...(world.world.classCatalog ? { classCatalog: world.world.classCatalog } : {}),
  };
}
