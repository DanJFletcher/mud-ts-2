import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InteractionInbox, TeamCombatEncounter } from '@mudd/contracts';
import type { GameSnapshot } from '@mudd/client-sdk';

const { apiFetch } = vi.hoisted(() => {
  const apiFetch = vi.fn();
  vi.stubGlobal('fetch', apiFetch);
  return { apiFetch };
});

vi.mock('./codex/CodexScreen.js', () => ({
  default: () => <><h1>A world, carefully remembered</h1><p>Orraveth is separate from the active MUDD world.</p></>,
}));

import { WorldClient } from './App.js';

/**
 * Stays connecting until a test drives it. jsdom's own socket fails to connect
 * and retries, and each close marks every realtime watcher dirty, so tests that
 * count snapshot requests would see refreshes that depend on retry timing.
 */
class FakeRealtimeSocket {
  static sockets: FakeRealtimeSocket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) { FakeRealtimeSocket.sockets.push(this); }
  send() {}
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

async function withFakeRealtimeSocket(run: (sockets: FakeRealtimeSocket[]) => Promise<void>) {
  const NativeWebSocket = globalThis.WebSocket;
  FakeRealtimeSocket.sockets = [];
  globalThis.WebSocket = FakeRealtimeSocket as unknown as typeof WebSocket;
  try {
    await run(FakeRealtimeSocket.sockets);
  } finally {
    globalThis.WebSocket = NativeWebSocket;
  }
}

const classDefinition = {
  id: 'fixture.vanguard', revision: 1, label: 'Vanguard',
  description: 'Strength-led martial combatant.', primaryAttribute: 'strength' as const,
  attributes: { strength: 15, intelligence: 10, constitution: 15, dexterity: 10 },
  coreAction: { id: 'fixture.heavy-strike', revision: 1, label: 'Heavy Strike',
    description: 'A single forceful strike.', cost: { resource: 'stamina' as const, amount: 20 },
    baseDamage: 3, scalingAttribute: 'strength' as const, weaponBonus: true },
};
const classCatalog = { id: 'fixture.classes', revision: 1, classes: [classDefinition] };

async function openInfoSection(section: 'Vitals' | 'Items' | 'Equipment' | 'Stats' | 'Field notes' | 'Codex') {
  fireEvent.click(screen.getByRole('link', { name: 'Info' }));
  const tabs = await screen.findByRole('navigation', { name: 'Info sections' });
  fireEvent.click(within(tabs).getByRole('link', { name: section }));
  await screen.findAllByRole('heading', { name: section === 'Codex' ? /A world, carefully remembered/ : section });
  return tabs;
}

function classApiFixture(
  initiallySelected = false,
  completedDuel = false,
  abilityFailure = false,
  adoptionFailure = false,
) {
  const original = apiFetch.getMockImplementation()!;
  const commands: Array<{ type: string; payload: Record<string, unknown> }> = [];
  let selected = initiallySelected;
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/interactions' && completedDuel) return json({
      requests: [], encounter: {
        encounterId: 'completed-duel', requestId: 'accepted-challenge',
        locationId: 'mossgate-clearing', status: 'completed',
        participants: [
          { characterId, name: 'Rowan', health: 6, maximumHealth: 6 },
          { characterId: 'other', name: 'Mira', health: 0, maximumHealth: 6 },
        ],
        round: 2, turnCharacterId: characterId, lastNarration: 'The earlier duel is finished.',
        updatedAt: '2026-10-19T12:00:00.000Z',
      },
    } satisfies InteractionInbox);
    if (path === '/api/worlds') return json([{
      worldInstanceId: 'mudd-demo-instance', packId: 'fixture', name: 'Class fixture',
      summary: 'Class fixture.', classCatalog,
    }]);
    if (path === '/api/commands' && init?.body) {
      const command = JSON.parse(String(init.body));
      if (command.type === 'character.class.choose' || command.payload?.action === 'ability') {
        commands.push(command);
        if (command.type === 'character.class.choose' && adoptionFailure) {
          return json({ message: 'Class adoption is temporarily unavailable.' }, 503);
        }
        if (command.payload?.action === 'ability' && abilityFailure) {
          return json({ message: 'Heavy Strike cannot be used right now.' }, 503);
        }
        if (command.type === 'character.class.choose') selected = true;
        revision += 1;
        return json({ receipt: { ok: true, commandId: command.commandId, eventIds: [], newAggregateVersion: revision }, events: [] });
      }
    }
    const response = await original(path, init);
    if (path === '/api/game' && selected) {
      const snapshot = await response.json();
      snapshot.character.characterClass = { ...classDefinition, catalogId: classCatalog.id, catalogRevision: 1 };
      snapshot.character.availableClassActions = [{ ...classDefinition.coreAction, available: true }];
      return json(snapshot);
    }
    return response;
  });
  return commands;
}

const characterId = '11111111-1111-4111-8111-111111111111';
let room: 'clearing' | 'bridge' | 'market' | 'inn' | 'belfry';
let orravethWorld: boolean;
let dailyFeatureEnabled: boolean;
let duplicateDailySourceAvailable: boolean;
let maraLookDescriptionAvailable: boolean;
let maraLookalikeAvailable: boolean;
let dailySourceAtBoard: boolean;
let failDailyBoardRefreshAfterFirst: boolean;
let includeEquipmentFixture: boolean;
let equipmentSnapshot: { weaponItemId: string | null; armorItemId: string | null } | null;
let craftingCatalog: {
  skill: { level: number; experienceHundredths: number };
  atWorkbench: boolean;
  recipes: Array<{
    recipeId: string;
    outputTypeId: string;
    outputLabel: string;
    requiredLevel: number;
    experience: number;
    maxCraftable: number;
  }>;
} | null;
let craftingCommandPayloads: Array<{ recipeId: string; quantity: number }>;
let craftingCatalogError: string | null;
let craftingCommandError: string | null;
let failNextCraftingSnapshotRefresh: boolean;
let craftingSnapshotRefreshShouldFail: boolean;
let craftingSnapshotRefreshFailureCount: number;
let characterProjectionUnavailable: boolean;
let bulletinReadableObject: boolean;
let dailyJobStatus: 'available' | 'active' | 'completed';
let omitDailyRewardTotals: boolean;
let dailySupplyCount: number;
let dailyBoardQueryCount: number;
let dailyCommandPayloads: Array<{ type: string; payload: Record<string, unknown> }>;
let visitedLocationIds: string[];
let revision: number;
let moveError: string | null;
let bridgeWatcherMobile: boolean;
let movementEvents: Array<{ type: string; payload?: unknown }>;
let itemTaken: boolean;
let maraChoice: string | null;
let includeSecondTakeable: boolean;
let duplicateStoneVisible: boolean;
let duplicateReadableMarkerVisible: boolean;
let ambiguousUseTargetsVisible: boolean;
let secondItemTaken: boolean;
let questJournal: Array<{
  questId: string;
  title: string;
  summary: string;
  status: 'active' | 'completed';
  objectives: Array<{ id: string; label: string; completed: boolean }>;
}>;
type TestRoomChatMessage = {
  id: number;
  roomId: string;
  speakerType: 'player' | 'npc';
  speakerId: string;
  speakerName: string;
  text: string;
  createdAt: string;
};
let roomChatMessages: TestRoomChatMessage[];
let terminalRoomEvents: TestRoomChatMessage[];
let nextRoomChatMessageId: number;
let campfireVisible: boolean;
let duplicateCampfireVisible: boolean;
let roomOccupants: Array<{ id: string; displayName: string }>;
let heartbeatOccupants: Array<{ id: string; displayName: string }>;
let walletBalance: number;
let worldCurrency: { id: string; name: string; symbol: string } | undefined;
let merchantLanternPurchased: boolean;
let healingDraughtCarried: boolean;
let locationUnavailable: boolean;
let fishingRodCarried: boolean;
let secondFishingRodCarried: boolean;
let fishingCastEvents: Array<{ type: string; payload?: unknown }>;
let fishingCastStartFailure: string | null;
let fishingCastStartAttempts: number;
let activeFishingCastState: {
  castId: string;
  spotId: string;
  locationId: string;
  rodItemId: string;
  rodQualityId: string;
  startedAt: string;
  tickIntervalSeconds: number;
  ticksRequired: number;
  ticksCompleted: number;
} | null;
let fishingAdvanceEvents: Array<{ type: string; payload?: unknown }>;
let fishingAdvanceError: string | null;
let fishingCancelFailure: string | null;
let fishingCancelAttempts: number;
let woodcuttingAxeCarried: boolean;
let currentRoomMentionsInventory: boolean;
let secondWoodcuttingAxeCarried: boolean;
let availableWoodcuttingTrees: Array<{ id: string; label: string }>;
let woodcuttingDepletesTree: boolean;
let woodcuttingAdvancePayload: Record<string, unknown> | null;
let woodcuttingAdvanceError: string | null;
let woodcuttingStartError: string | null;
let woodcuttingStartEvents: Array<{ type: string; payload?: unknown }>;
let activeWoodcuttingState: {
  actionId: string;
  treeId: string;
  treeLabel: string;
  axeItemId: string;
  locationId: string;
  startedAt: string;
  ticksCompleted: number;
  ticksRequired: 10;
} | null;
let characterHealth: { current: number; maximum: number } | null;
let characterStamina: { current: number; maximum: number };
let staminaPosture: 'standing' | 'resting';
let combatEncounter: {
  encounterId: string;
  locationId: string;
  opponentNpcId: string;
  opponentName: string;
  round: number;
  playerHealth: number;
  playerMaxHealth: number;
  opponentHealth: number;
  opponentMaxHealth: number;
  status: 'active' | 'victory' | 'defeat' | 'fled';
  lastAction: 'attack' | 'defend' | 'flee' | 'use-item';
  lastNarration: string;
} | null;
let activePartyInfo: {
  groupId: string;
  groupType: string;
  ownerPlayerId: string;
  maxMembers: number;
  isPublic: boolean;
  status: 'active';
  members: Array<{ playerId: string; characterId: string; displayName: string }>;
  createdAt: string;
  leaderName: string;
} | null;
let partyListFixture: Array<{
  groupId: string;
  leaderName: string;
  members: Array<{ playerId: string; characterId: string; displayName: string }>;
  memberCount: number;
  maxMembers: number;
  joinable: boolean;
}>;
let partyQuestJournalFixture: {
  partyId: string | null;
  available: Array<{ questId: string; title: string; summary: string }>;
  quests: Array<{
    questId: string;
    title: string;
    summary: string;
    status: string;
    objectives: Array<{ id: string; label: string; progress: number; required: number; completed: boolean }>;
  }>;
};
let partyRevision: number;
let partyActivity: Array<{
  revision: number;
  groupId: string;
  type: 'created' | 'joined' | 'left' | 'closed';
  playerId?: string;
  displayName?: string;
}>;
let teamCombatEncounter: TeamCombatEncounter | null;

function currentLocation(includeNpcDescriptions = false) {
  const title = orravethWorld
    ? 'The Kindly Roof'
    : room === 'clearing'
    ? 'Mossgate Clearing'
    : room === 'market'
      ? 'Reedbank Stalls'
      : room === 'inn'
        ? 'Willowrest Inn'
        : 'Glasswater Bridge';
  return {
    worldInstanceId: orravethWorld ? 'orraveth-bellwold-instance' : 'mudd-demo-instance',
    locationId: orravethWorld
      ? 'kindly-roof'
      : room === 'clearing' ? 'mossgate-clearing' : room === 'market' ? 'reedbank-stalls' : room === 'inn' ? 'willowrest-inn' : 'glasswater-bridge',
    title,
    shortName: title,
    qualifiedName: title,
    locationGroups: [],
    safeResting: orravethWorld || room === 'inn',
    description: orravethWorld
      ? 'A quiet, shared rooftop where travelers may rest safely.'
      : room === 'clearing'
      ? [
        itemTaken
          ? 'A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east.'
          : 'A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east. One loose stone bears a pale stripe.',
        includeNpcDescriptions
          ? 'Mara is here. A path keeper stands beside the weathered marker, watching the northern trail.\n\nPractice Sentinel is here. A knee-high wooden sentinel waits beside the trail. Its padded arms lift as you approach.'
          : 'Mara is here, watching the northern trail.\n\nPractice Sentinel is here, lifting its padded arms in a steady rhythm.',
        ...availableWoodcuttingTrees.map((tree) => `A ${tree.label.replace(/\s+tree$/i, '')} tree stands beside the path.`),
        ...(campfireVisible ? ['A Campfire crackles nearby.'] : []),
        ...(currentRoomMentionsInventory && woodcuttingAxeCarried ? ['Your Copper Axe catches the light.'] : []),
      ].join('\n\n')
      : room === 'market'
        ? 'Canvas awnings line the riverbank.'
        : room === 'inn'
          ? 'A warm timber inn offers a full night’s rest for five moss marks.'
          : currentRoomMentionsInventory && fishingRodCarried
            ? 'A stone bridge crosses clear water. Your old rod is ready for the current.'
            : 'A stone bridge crosses clear water.',
    revision,
    ...(!orravethWorld && room === 'inn' ? {
      inn: {
        id: 'willowrest-inn-service',
        name: 'Willowrest Inn',
        restPrice: 5,
        currency: { id: 'moss-mark', name: 'moss mark', symbol: 'm' },
      },
    } : {}),
    objects: room === 'clearing' ? [
      {
        id: 'mossgate-marker',
        label: 'Weathered marker',
        description: 'A weathered stone marker, its carved arrow worn but still pointing east.',
        readable: true,
        takeable: false,
      },
      ...(duplicateReadableMarkerVisible ? [{
        id: 'mossgate-marker-notice',
        label: 'Marker notice',
        description: 'A small notice about the old marker.',
        readable: true,
        takeable: false,
      }] : []),
      ...(ambiguousUseTargetsVisible ? [{
        id: 'mossgate-stone-idol',
        label: 'Stone idol',
        description: 'A small stone idol stands among the pale stones.',
        readable: false,
        takeable: false,
      }, {
        id: 'mossgate-stone-statue',
        label: 'Stone statue',
        description: 'A weathered stone statue watches the clearing.',
        readable: false,
        takeable: false,
      }] : []),
      ...(!itemTaken ? [{
        id: 'mossgate-loose-stone',
        label: 'Loose stone',
        description: 'A smooth, palm-sized stone with a pale stripe running through it.',
        readable: false,
        takeable: true,
      }] : []),
      ...(campfireVisible ? [{
        id: 'test-campfire',
        label: 'Campfire',
        description: 'A small campfire crackles nearby.',
        readable: false,
        takeable: false,
      }] : []),
      ...(duplicateCampfireVisible ? [{
        id: 'test-campfire-second',
        label: 'Campfire',
        description: 'A second campfire burns nearby.',
        readable: false,
        takeable: false,
      }] : []),
      ...(dailyFeatureEnabled && bulletinReadableObject ? [{
        id: 'reedbank-bulletin-object',
        label: 'Bulletin board',
        description: 'A plank board holds handwritten notices.',
        readable: true,
        takeable: false,
      }] : []),
      ...(includeSecondTakeable && !secondItemTaken ? [{
        id: 'mossgate-lost-feather',
        label: 'Lost feather',
        description: 'A small gray feather lies among the pale stones.',
        readable: false,
        takeable: true,
      }] : []),
      ...(duplicateStoneVisible ? [{
        id: 'mossgate-stone-shard',
        label: 'Stone shard',
        description: 'A chipped fragment of pale stone.',
        readable: false,
        takeable: true,
      }] : []),
    ] : room === 'bridge' ? [{
      id: 'tower-cracked-bell',
      label: 'Cracked bell',
      description: 'A heavy bronze bell hangs from a weathered frame.',
      readable: false,
      takeable: false,
    }] : [],
    occupants: roomOccupants,
    exits: room === 'belfry' ? [{
      id: 'belfry-to-roof',
      label: 'Up to the roof',
      direction: 'up',
      available: true,
    }, {
      id: 'belfry-to-tower',
      label: 'Down to the tower floor',
      direction: 'down',
      available: true,
    }, {
      id: 'belfry-to-underhollow',
      label: 'Down into the Underhollow',
      direction: 'down',
      available: true,
    }] : room === 'clearing' ? [{
      id: 'clearing-to-bridge',
      label: 'North to Glasswater Bridge',
      direction: 'north',
      available: true,
      destinationPreview: {
        locationId: 'glasswater-bridge',
        title: 'Glasswater Bridge',
        shortName: 'Glasswater Bridge',
        qualifiedName: 'Glasswater Bridge',
        description: 'A stone bridge crosses clear water.',
        roomDetails: 'A Bridge Watcher is here, eyes alert. A brass token lies here.',
        npcs: [{ id: 'bridge-watcher', name: 'Bridge Watcher', mobile: bridgeWatcherMobile }],
      },
    }] : room === 'bridge' ? [{
      id: 'bridge-to-clearing',
      label: 'South to Mossgate Clearing',
      direction: 'south',
      available: true,
      destinationPreview: {
        locationId: 'mossgate-clearing',
        title: 'Mossgate Clearing',
        shortName: 'Mossgate Clearing',
        qualifiedName: 'Mossgate Clearing',
        description: 'A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east.',
      },
    }] : room === 'market' ? [{
      id: 'reedbank-to-bridge',
      label: 'South to Glasswater Bridge',
      direction: 'south',
      available: true,
    }, {
      id: 'reedbank-to-willowrest',
      label: 'East to Willowrest Inn',
      direction: 'east',
      available: true,
    }] : room === 'inn' ? [{
      id: 'willowrest-to-reedbank',
      label: 'West to Reedbank Stalls',
      direction: 'west',
      available: true,
    }] : [{
      id: 'reedbank-to-bridge',
      label: 'South to Glasswater Bridge',
      direction: 'south',
      available: true,
    }],
    npcs: room === 'clearing' ? [{
      id: 'mara-waykeeper',
      name: 'Mara',
      activityDescription: 'watching the northern trail',
      ...(includeNpcDescriptions && maraLookDescriptionAvailable
        ? { description: 'A path keeper stands beside the weathered marker, watching the northern trail.' }
        : {}),
      canChallenge: maraLookalikeAvailable,
      canShop: false,
    },
    ...(maraLookalikeAvailable ? [{
      id: 'mara-lookalike',
      name: 'Mara Vale',
      activityDescription: 'waiting near the trail',
      ...(includeNpcDescriptions
        ? { description: 'A traveler waits near the northern trail.' }
        : {}),
      canChallenge: maraLookalikeAvailable,
      canShop: false,
    }] : []),
    {
      id: 'mossgate-training-sentinel',
      name: 'Practice Sentinel',
      activityDescription: 'lifting its padded arms in a steady rhythm',
      ...(includeNpcDescriptions
        ? { description: 'A knee-high wooden sentinel waits beside the trail. Its padded arms lift as you approach.' }
        : {}),
      canChallenge: true,
      canShop: false,
    }] : room === 'market' ? [{
      id: 'sella-reedbank-merchant',
      name: 'Sella',
      activityDescription: 'sorting travel goods beneath a green awning',
      ...(includeNpcDescriptions
        ? { description: 'A careful trader sorts travel goods beneath a green awning.' }
        : {}),
      canChallenge: false,
      canShop: true,
    }] : [],
  };
}

function currentWorldMap() {
  const allLocations = [
    { id: 'mossgate-clearing', name: 'Mossgate Clearing', x: 0, y: 0 },
    { id: 'glasswater-bridge', name: 'Glasswater Bridge', x: 0, y: 1 },
    { id: 'bell-tower', name: 'Old Bell Tower', x: 1, y: 0 },
    { id: 'reedbank-stalls', name: 'Reedbank Stalls', x: 1, y: 2 },
    { id: 'willowrest-inn', name: 'Willowrest Inn', x: 2, y: 2 },
  ];
  const locations = allLocations
    .filter((location) => visitedLocationIds.includes(location.id))
    .map((location) => ({
      ...location,
      shortName: location.name,
      qualifiedName: location.name,
      locationGroupIds: [],
    }));
  const hasClearing = visitedLocationIds.includes('mossgate-clearing');
  const hasBridge = visitedLocationIds.includes('glasswater-bridge');
  const hasReedbank = visitedLocationIds.includes('reedbank-stalls');
  const hasWillowrest = visitedLocationIds.includes('willowrest-inn');
  const pathPairs = [
    ['mossgate-clearing', 'glasswater-bridge'],
    ['glasswater-bridge', 'reedbank-stalls'],
    ['reedbank-stalls', 'willowrest-inn'],
  ] as const;
  return {
    worldInstanceId: 'mudd-demo-instance',
    packId: 'mudd.first-steps',
    packVersion: '1.1.0',
    currentLocationId: currentLocation().locationId,
    locations,
    locationGroups: [],
    connections: pathPairs.flatMap(([fromLocationId, toLocationId]) =>
      (fromLocationId === 'mossgate-clearing' ? hasClearing
        : fromLocationId === 'glasswater-bridge' ? hasBridge
          : hasReedbank) &&
      (toLocationId === 'glasswater-bridge' ? hasBridge
        : toLocationId === 'reedbank-stalls' ? hasReedbank
          : hasWillowrest)
        ? [{ fromLocationId, toLocationId }]
        : [],
    ),
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Answer these command types with the fixture's resulting game view, as an opted-in server does. */
function returnGameProjectionsWithCommands(commandTypes: readonly string[]) {
  const original = apiFetch.getMockImplementation()!;
  const projectionHeaders: Array<string | null> = [];
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    const response = await original(path, init);
    if (path !== '/api/commands' || init?.method !== 'POST') return response;
    projectionHeaders.push(new Headers(init.headers).get('x-mudd-command-projection'));
    const command = JSON.parse(String(init.body)) as { type?: string };
    if (!commandTypes.includes(command.type ?? '')) return response;
    const commandResult = await response.json() as Record<string, unknown>;
    const game = await (await original('/api/game', {})).json() as Record<string, unknown>;
    return json({
      ...commandResult,
      gameProjection: {
        character: game.character,
        stats: game.stats,
        location: game.location,
        map: game.map,
        questJournal: game.questJournal ?? [],
        availableFishingSpots: game.availableFishingSpots ?? [],
        availableWoodcuttingTrees: game.availableWoodcuttingTrees ?? [],
        dailyActivities: game.dailyActivities ?? { cycle: '2000-01-01', boards: [], sources: [] },
      },
    });
  });
  return projectionHeaders;
}

function clickQuickAction(name: string) {
  const firstPage = screen.queryByRole('button', { name: 'Show quick actions page 1' });
  if (firstPage) fireEvent.click(firstPage);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const action = screen.queryByRole('button', { name });
    if (action) {
      fireEvent.click(action);
      return;
    }
    const group = screen.queryByRole('group', { name: /^Quick commands, page \d+$/ });
    const currentPage = Number(group?.getAttribute('aria-label')?.match(/page (\d+)/)?.[1] ?? 1);
    const nextPage = screen.queryByRole('button', { name: `Show quick actions page ${currentPage + 1}` });
    if (!nextPage) break;
    fireEvent.click(nextPage);
  }

  throw new Error(`Quick action "${name}" is not available.`);
}

function quickActionVisibleAnywhere(name: string) {
  const firstPage = screen.queryByRole('button', { name: 'Show quick actions page 1' });
  if (firstPage) fireEvent.click(firstPage);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (screen.queryByRole('button', { name })) return true;
    const group = screen.queryByRole('group', { name: /^Quick commands, page \d+$/ });
    const currentPage = Number(group?.getAttribute('aria-label')?.match(/page (\d+)/)?.[1] ?? 1);
    const nextPage = screen.queryByRole('button', { name: `Show quick actions page ${currentPage + 1}` });
    if (!nextPage) return false;
    fireEvent.click(nextPage);
  }

  return false;
}

async function collectQuickActionPages() {
  const pages: string[][] = [];
  for (let page = 1; page <= 4; page += 1) {
    const group = await screen.findByRole('group', { name: `Quick commands, page ${page}` });
    const buttons = within(group).getAllByRole('button');
    pages.push(buttons
      .filter((button) =>
        !button.classList.contains('focused-quick-command--back') &&
        !button.classList.contains('focused-quick-command--next')
      )
      .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? ''));
    expect(pages.at(-1)!.length).toBeLessThanOrEqual(4);
    const nextPage = screen.queryByRole('button', { name: `Show quick actions page ${page + 1}` });
    if (!nextPage) break;
    fireEvent.click(nextPage);
  }
  return pages;
}

function quickGo(direction: 'north' | 'south' | 'east' | 'west' | 'up' | 'down') {
  const navigation = screen.getByRole('navigation', { name: 'Quick navigation' });
  fireEvent.click(within(navigation).getByRole('button', { name: direction[0]!.toUpperCase() + direction.slice(1) }));
}

function submitWorldCommand(value: string) {
  const input = screen.getByRole('textbox', { name: 'Enter a command' });
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest('form')!);
}

function fireTouchSwipe(
  target: Element,
  start: Readonly<{ x: number; y: number }>,
  end: Readonly<{ x: number; y: number }>,
) {
  const startTouch = { clientX: start.x, clientY: start.y };
  const startEvent = new Event('touchstart', { bubbles: true, cancelable: true });
  Object.defineProperties(startEvent, {
    touches: { value: [startTouch] },
    changedTouches: { value: [startTouch] },
  });
  fireEvent(target, startEvent);

  const endTouch = { clientX: end.x, clientY: end.y };
  const endEvent = new Event('touchend', { bubbles: true, cancelable: true });
  Object.defineProperties(endEvent, {
    touches: { value: [] },
    changedTouches: { value: [endTouch] },
  });
  fireEvent(target, endEvent);
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  room = 'clearing';
  orravethWorld = false;
  dailyFeatureEnabled = false;
  duplicateDailySourceAvailable = false;
  maraLookDescriptionAvailable = true;
  maraLookalikeAvailable = false;
  dailySourceAtBoard = false;
  failDailyBoardRefreshAfterFirst = false;
  includeEquipmentFixture = false;
  equipmentSnapshot = null;
  craftingCatalog = null;
  craftingCommandPayloads = [];
  craftingCatalogError = null;
  craftingCommandError = null;
  failNextCraftingSnapshotRefresh = false;
  craftingSnapshotRefreshShouldFail = false;
  craftingSnapshotRefreshFailureCount = 0;
  characterProjectionUnavailable = false;
  bulletinReadableObject = false;
  dailyJobStatus = 'available';
  omitDailyRewardTotals = false;
  dailySupplyCount = 0;
  dailyBoardQueryCount = 0;
  dailyCommandPayloads = [];
  visitedLocationIds = ['mossgate-clearing'];
  revision = 1;
  moveError = null;
  bridgeWatcherMobile = true;
  movementEvents = [];
  itemTaken = false;
  maraChoice = null;
  includeSecondTakeable = false;
  duplicateStoneVisible = false;
  duplicateReadableMarkerVisible = false;
  ambiguousUseTargetsVisible = false;
  secondItemTaken = false;
  questJournal = [];
  roomChatMessages = [];
  terminalRoomEvents = [];
  nextRoomChatMessageId = 1;
  campfireVisible = false;
  duplicateCampfireVisible = false;
  roomOccupants = [];
  heartbeatOccupants = [];
  walletBalance = 12;
  worldCurrency = { id: 'moss-mark', name: 'moss mark', symbol: 'm' };
  merchantLanternPurchased = false;
  healingDraughtCarried = false;
  locationUnavailable = false;
  fishingRodCarried = false;
  secondFishingRodCarried = false;
  fishingCastEvents = [];
  fishingCastStartFailure = null;
  fishingCastStartAttempts = 0;
  activeFishingCastState = null;
  fishingAdvanceEvents = [];
  fishingAdvanceError = null;
  fishingCancelFailure = null;
  fishingCancelAttempts = 0;
  woodcuttingAxeCarried = false;
  currentRoomMentionsInventory = false;
  secondWoodcuttingAxeCarried = false;
  availableWoodcuttingTrees = [];
  woodcuttingDepletesTree = false;
  woodcuttingAdvancePayload = null;
  woodcuttingAdvanceError = null;
  woodcuttingStartError = null;
  woodcuttingStartEvents = [];
  activeWoodcuttingState = null;
  characterHealth = null;
  characterStamina = { current: 100, maximum: 100 };
  staminaPosture = 'standing';
  combatEncounter = null;
  activePartyInfo = null;
  partyListFixture = [];
  partyQuestJournalFixture = { partyId: null, available: [], quests: [] };
  partyRevision = 0;
  partyActivity = [];
  teamCombatEncounter = null;
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/worlds') return json([{
      worldInstanceId: 'mudd-demo-instance', packId: 'demo', name: 'Waystone', summary: 'A first journey.',
    }, {
      worldInstanceId: 'orraveth-bellwold-instance', packId: 'orraveth', name: 'Orraveth: Bellwold', summary: 'A frontier settlement.',
    }]);
    if (path === '/api/world-session/heartbeat') {
      return json({
        worldInstanceId: currentLocation().worldInstanceId,
        locationId: currentLocation().locationId,
        occupants: heartbeatOccupants,
      });
    }
    if (path.startsWith('/api/chat')) {
      const url = new URL(path, 'http://mudd.test');
      const roomId = currentLocation().locationId;
      if (init?.method === 'POST') {
        const payload = JSON.parse(String(init.body ?? '{}')) as { roomId?: string; text?: string };
        if (payload.roomId !== roomId) return json({ message: 'You have moved to a different room.' }, 409);
        const message: TestRoomChatMessage = {
          id: nextRoomChatMessageId++,
          roomId,
          speakerType: 'player',
          speakerId: characterId,
          speakerName: 'Rowan',
          text: payload.text ?? '',
          createdAt: '2026-01-01T00:00:00.000Z',
        };
        roomChatMessages.push(message);
        const npcMessage = payload.text?.toLocaleLowerCase().includes('marker')
          ? {
            id: nextRoomChatMessageId++,
            roomId,
            speakerType: 'npc' as const,
            speakerId: 'mara-waykeeper',
            speakerName: 'Mara',
            text: 'The marker still points east.',
            createdAt: '2026-01-01T00:00:01.000Z',
          }
          : undefined;
        if (npcMessage) roomChatMessages.push(npcMessage);
        return json({ message, ...(npcMessage ? { npcMessage } : {}) }, 201);
      }
      if (url.searchParams.get('roomId') !== roomId) {
        return json({ message: 'You have moved to a different room.' }, 409);
      }
      const afterId = url.searchParams.get('afterId');
      const messages = afterId === null
        ? roomChatMessages.filter((message) => message.roomId === roomId).slice(-50)
        : roomChatMessages.filter((message) => message.roomId === roomId && message.id > Number(afterId));
      const terminalEvents = afterId === null
        ? []
        : terminalRoomEvents.filter((message) =>
          message.roomId === roomId && message.id > Number(afterId));
      const cursor = Math.max(
        0,
        ...messages.map((message) => message.id),
        ...terminalEvents.map((message) => message.id),
      );
      return json({ roomId, messages, terminalEvents, cursor });
    }
    if (path === '/api/game') {
      if (craftingSnapshotRefreshShouldFail) {
        craftingSnapshotRefreshShouldFail = false;
        craftingSnapshotRefreshFailureCount += 1;
        return json({ message: 'Snapshot unavailable.' }, 503);
      }
      return json({
        player: { id: 'account-1', displayName: 'Traveler' },
        character: characterProjectionUnavailable ? undefined : {
          characterId,
          worldInstanceId: currentLocation().worldInstanceId,
          name: 'Rowan',
          locationId: currentLocation().locationId,
          visitedLocationIds,
          revision,
          npcProgress: maraChoice ? [{
            npcId: 'mara-waykeeper',
            progressFlagIds: [maraChoice === 'ask-marker' ? 'asked-marker' : 'asked-tower'],
            lastChoiceId: maraChoice,
          }] : [],
          ...(dailyFeatureEnabled ? {
            dailyJobs: [{
              boardId: 'reedbank-board',
              cycle: '2000-01-01',
              jobId: 'expired-herbs',
              title: 'An old river-mint posting',
              status: 'active' as const,
            }, {
              boardId: 'reedbank-board',
              cycle: '2098-12-31',
              jobId: 'current-mint',
              title: 'Current river-mint posting',
              status: 'active' as const,
              details: {
                id: 'current-mint',
                poster: 'Sella',
                title: 'Current river-mint posting',
                supplyTypeId: 'river-mint',
                quantity: 3,
                gold: 15,
                experience: 9,
              },
            }],
            supplyCollections: dailySupplyCount ? [{
              sourceId: 'bridge-fishing-pools',
              cycle: '2026-10-23',
              count: dailySupplyCount,
            }] : [],
          } : {}),
          wallet: { currencyId: 'moss-mark', balance: walletBalance },
          attributes: { strength: 10, intelligence: 10, constitution: 10, dexterity: 10 },
          honors: { glory: 0, medals: 0 },
          ...(characterHealth ? { health: characterHealth } : {}),
          resources: {
            stamina: characterStamina,
            mana: { current: 100, maximum: 100 },
          },
          staminaRecovery: {
            posture: staminaPosture,
            // The client projects recovery up to its wall clock, and elapsed time
            // never goes negative, so a settlement in the future keeps the fixture's
            // vitals exact however long a test runs.
            lastSettledAt: '2999-01-01T00:00:00.000Z',
            fractionalCarry: 0,
          },
          ...(combatEncounter ? { combat: combatEncounter } : {}),
          ...(activeFishingCastState ? { activeFishing: activeFishingCastState } : {}),
          ...(activeWoodcuttingState ? { activeWoodcutting: activeWoodcuttingState } : {}),
          ...(includeEquipmentFixture
            ? { equipment: equipmentSnapshot ?? { weaponItemId: 'test-sword', armorItemId: null } }
            : dailyFeatureEnabled ? { equipment: { weaponItemId: 'mint-equipped', armorItemId: null } } : {}),
          inventory: [
            ...(includeEquipmentFixture ? [{
              id: 'test-sword',
              typeId: 'test-sword',
              label: 'Test sword',
              description: 'A practice sword for inventory-screen coverage.',
              equipment: { slot: 'weapon' as const, attackBonus: 2, defenseBonus: 0 },
            }, {
              id: 'test-shield',
              typeId: 'test-shield',
              label: 'Test shield',
              description: 'A small practice shield.',
              equipment: { slot: 'armor' as const, attackBonus: 0, defenseBonus: 1 },
            }] : []),
            ...(dailyFeatureEnabled ? [{
              id: 'mint-carried',
              typeId: 'river-mint',
              label: 'River mint',
              description: 'A fragrant bunch of fresh mint.',
            }, {
              id: 'mint-bound',
              typeId: 'river-mint',
              label: 'Bound river mint',
              description: 'A quest-bound bunch of river mint.',
              questBound: true,
            }, {
              id: 'mint-equipped',
              typeId: 'river-mint',
              label: 'Equipped mint',
              description: 'A test fixture for filtering equipped items.',
            }] : []),
            ...(itemTaken ? [{
              id: 'mossgate-loose-stone',
              label: 'Loose stone',
              description: 'A smooth, palm-sized stone with a pale stripe running through it.',
              questBound: true,
            }] : []),
            ...(secondItemTaken ? [{
              id: 'mossgate-lost-feather',
              label: 'Lost feather',
              description: 'A small gray feather lies among the pale stones.',
            }] : []),
            ...(merchantLanternPurchased ? [{
              id: 'item-reedbank-brass-lantern',
              label: 'Brass lantern',
              description: 'A compact brass lantern with a sliding shutter and a soot-dark wick.',
            }] : []),
            ...(healingDraughtCarried ? [{
              id: 'item-reedbank-healing-draught',
              label: 'Small healing draught',
              description: 'A stoppered glass vial of herbal tonic.',
              consumable: { effect: 'heal' as const, amount: 3 },
            }] : []),
            ...(fishingRodCarried ? [{
              id: 'old-rod',
              typeId: 'old-rod',
              label: 'old rod',
              description: 'A worn fishing rod.',
              fishingRod: { qualityId: 'old', biteChancePercent: 10, waitSeconds: 10 },
            }] : []),
            ...(secondFishingRodCarried ? [{
              id: 'spare-old-rod',
              typeId: 'old-rod',
              label: 'old rod',
              description: 'A second worn fishing rod.',
              fishingRod: { qualityId: 'old', biteChancePercent: 10, waitSeconds: 10 },
            }] : []),
            ...(woodcuttingAxeCarried ? [{
              id: 'copper-axe',
              typeId: 'copper-axe',
              label: 'Copper Axe',
              description: 'A worn copper axe.',
              woodcuttingAxe: { requiredLevel: 1, power: 1 },
            }] : []),
            ...(secondWoodcuttingAxeCarried ? [{
              id: 'spare-copper-axe',
              typeId: 'copper-axe',
              label: 'Copper Axe',
              description: 'A second worn copper axe.',
              woodcuttingAxe: { requiredLevel: 1, power: 1 },
            }] : []),
          ],
        },
        stats: {
          attributes: { strength: 10, intelligence: 10, constitution: 10, dexterity: 10 },
          attackPower: 30,
          spellPower: 30,
          damage: 2,
          critChancePercent: 5,
          healthRegen: 0,
          manaRegen: 0,
          staminaRegen: 0,
          armorPercent: 0,
          resiliencePercent: 0,
          dodgePercent: 0,
        },
        currency: worldCurrency,
        location: locationUnavailable ? undefined : currentLocation(),
        availableFishingSpots: room === 'bridge' && !orravethWorld
          ? [{ id: 'glasswater-fishing-spot', label: 'Glasswater Bridge' }]
          : [],
        availableWoodcuttingTrees,
        map: currentWorldMap(),
        questJournal,
        ...(dailyFeatureEnabled ? {
          dailyActivities: {
            cycle: '2026-10-23',
            boards: room === 'clearing' && !orravethWorld
              ? [{ id: 'reedbank-board', name: 'Reedbank Bulletin' }]
              : [],
            sources: room === 'bridge' && !orravethWorld ? [{
              id: 'bridge-fishing-pools',
              locationId: 'glasswater-bridge',
              label: 'Glasswater fishing pools',
              supply: { typeId: 'river-fish', label: 'River fish', description: 'Silver fish gather in the clear pools.' },
              dailyLimit: 3,
            }] : dailySourceAtBoard && room === 'clearing' && !orravethWorld ? [{
              id: 'clearing-spring',
              locationId: 'mossgate-clearing',
              label: 'Mossgate spring',
              supply: { typeId: 'spring-water', label: 'Spring water', description: 'Clear water flows from the hillside.' },
              dailyLimit: 3,
            },
            ...(duplicateDailySourceAvailable ? [{
              id: 'clearing-spring-well',
              locationId: 'mossgate-clearing',
              label: 'Mossgate spring well',
              supply: { typeId: 'spring-water', label: 'Spring water', description: 'Clear water flows from the hillside.' },
              dailyLimit: 3,
            }] : [])] : [],
          },
        } : {}),
      });
    }
    if (path === '/api/queries') {
      const query = JSON.parse(String(init?.body ?? '{}')) as {
        type?: string;
        payload?: {
          objectId?: string;
          npcId?: string;
          topic?: string;
          merchantNpcId?: string;
          includeNpcDescriptions?: boolean;
          boardId?: string;
        };
      };
      if (query.type === 'daily.board') {
        dailyBoardQueryCount += 1;
        if (failDailyBoardRefreshAfterFirst && dailyBoardQueryCount > 1) {
          return json({ ok: false, message: 'The bulletin could not be refreshed.' });
        }
        if (!dailyFeatureEnabled || room !== 'clearing' || query.payload?.boardId !== 'reedbank-board') {
          return json({ ok: false, message: 'That bulletin is not available in this location.' });
        }
        return json({
          ok: true,
          value: {
            boardId: 'reedbank-board',
            name: 'Reedbank Bulletin',
            cycle: '2026-10-23',
            resetsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            jobs: [{
              id: 'river-mint-delivery',
              poster: 'Sella',
              title: 'Bring river mint',
              supplyTypeId: 'river-mint',
              quantity: 1,
              gold: 15,
              experience: 9,
              carried: dailyJobStatus === 'active' || dailyJobStatus === 'completed' ? 1 : 0,
              status: dailyJobStatus,
            }],
          },
        });
      }
      if (query.type === 'crafting.catalog') {
        if (craftingCatalogError) return json({ ok: false, message: craftingCatalogError });
        return json({
          ok: true,
          value: craftingCatalog ?? {
            skill: { level: 1, experienceHundredths: 0 },
            atWorkbench: false,
            recipes: [],
          },
        });
      }
      if (query.type === 'location.describe') {
        return json({ ok: true, value: currentLocation(query.payload?.includeNpcDescriptions === true) });
      }
      if (query.type === 'party.info') {
        return json({ ok: true, value: { party: activePartyInfo, revision: partyRevision, activity: partyActivity } });
      }
      if (query.type === 'party.list') {
        return json({ ok: true, value: { parties: partyListFixture } });
      }
      if (query.type === 'party.quests') {
        return json({ ok: true, value: partyQuestJournalFixture });
      }
      if (query.type === 'team.combat.info') {
        return json({ ok: true, value: { encounter: teamCombatEncounter } });
      }
      if (query.type === 'merchant.catalog') {
        if (room !== 'market' || query.payload?.merchantNpcId !== 'sella-reedbank-merchant') {
          return json({ ok: false, message: 'That merchant is not selling anything here.' }, 403);
        }
        return json({
          ok: true,
          value: {
            merchantNpcId: 'sella-reedbank-merchant',
            merchantName: 'Sella',
            currency: { id: 'moss-mark', name: 'moss mark', symbol: 'm', balance: walletBalance },
            listings: [
              {
                id: 'reedbank-brass-lantern',
                item: {
                  id: 'item-reedbank-brass-lantern',
                  label: 'Brass lantern',
                  description: 'A compact brass lantern with a sliding shutter and a soot-dark wick.',
                },
                price: 8,
                purchased: merchantLanternPurchased,
              },
              {
                id: 'reedbank-waxed-cord',
                item: {
                  id: 'item-reedbank-waxed-cord',
                  label: 'Waxed cord',
                  description: 'A coil of tough linen cord sealed with beeswax against damp.',
                },
                price: 5,
                purchased: false,
              },
            ],
          },
        });
      }
      if (query.type === 'npc.talk') {
        const npc = currentLocation().npcs.find((candidate) => candidate.id === query.payload?.npcId);
        if (!npc) return json({ ok: false, message: 'That person is not here.' }, 403);
        const topic = query.payload?.topic?.toLocaleLowerCase();
        const text = topic
          ? topic.includes('bell') || topic.includes('tower')
            ? 'The bell has not rung in years. The tower stands east of this clearing.'
            : topic.includes('marker') || topic.includes('sign') || topic.includes('east')
              ? 'The marker is old, but the carving still points east toward the Old Bell Tower.'
              : 'Ask me about the marker or the bell tower.'
          : maraChoice === 'ask-marker'
            ? 'The marker points east to the Old Bell Tower. Its direction is still true.'
            : maraChoice === 'ask-tower'
              ? 'The bell has been silent for years. I still hope to hear it ring again.'
              : 'The old paths still have their stories. What would you like to ask?';
        const choices = topic || maraChoice === 'ask-tower'
          ? []
          : [
            ...(maraChoice !== 'ask-marker' ? [{ id: 'ask-marker', label: 'Ask about the marker' }] : []),
            ...(maraChoice !== 'ask-tower' ? [{ id: 'ask-tower', label: 'Ask about the bell tower' }] : []),
          ];
        return json({ ok: true, value: { npcId: npc.id, npcName: npc.name, text, choices } });
      }
      if (query.type === 'object.read' && query.payload?.objectId === 'mossgate-marker') {
        return json({ ok: true, value: { id: 'mossgate-marker', label: 'Weathered marker', text: 'OLD BELL TOWER — EAST' } });
      }
      if (query.type === 'object.inspect') {
        const objectId = query.payload?.objectId;
        const object = [...currentLocation().objects, ...(itemTaken ? [{
          id: 'mossgate-loose-stone',
          label: 'Loose stone',
          description: 'A smooth, palm-sized stone with a pale stripe running through it.',
          readable: false,
          takeable: true,
        }] : [])].find((candidate) => candidate.id === objectId);
        return object
          ? json({ ok: true, value: { id: object.id, label: object.label, description: object.description } })
          : json({ ok: false, message: 'That object is not here or in your pack.' });
      }
      return json({ ok: true, value: currentLocation() });
    }
    if (path === '/api/commands') {
      const command = JSON.parse(String(init?.body ?? '{}')) as {
        type?: string;
        commandId?: string;
        payload?: {
          itemId?: string;
          targetId?: string;
          choiceId?: string;
          objectId?: string;
          exitId?: string;
          innId?: string;
          action?: 'attack' | 'defend' | 'flee' | 'use-item' | 'accept' | 'deliver';
          encounterId?: string;
          targetNpcId?: string;
          boardId?: string;
          cycle?: string;
          jobId?: string;
          sourceId?: string;
          campfireId?: string;
          recipeId?: string;
          quantity?: number;
        };
      };
      if (command.type === 'crafting.craft') {
        if (craftingCommandError) {
          return json({
            receipt: {
              ok: false,
              commandId: command.commandId ?? 'mock-command',
              code: 'RULE_VIOLATION',
              message: craftingCommandError,
            },
          });
        }
        craftingCommandPayloads.push({
          recipeId: command.payload?.recipeId ?? '',
          quantity: command.payload?.quantity ?? 0,
        });
        if (failNextCraftingSnapshotRefresh) {
          failNextCraftingSnapshotRefresh = false;
          craftingSnapshotRefreshShouldFail = true;
        }
        revision += 1;
        return json({
          receipt: {
            ok: true,
            commandId: command.commandId ?? 'mock-command',
            eventIds: [],
            newAggregateVersion: revision,
          },
          streamId: characterId,
          events: [],
        });
      }
      if (command.type === 'fishing.cast') {
        fishingCastStartAttempts += 1;
        if (fishingCastStartFailure) {
          return json({
            receipt: {
              ok: false,
              commandId: command.commandId ?? 'mock-command',
              code: 'RULE_VIOLATION',
              message: fishingCastStartFailure,
            },
          });
        }
        revision += 1;
        return json({
          receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision },
          streamId: characterId,
          events: fishingCastEvents,
        });
      }
      if (command.type === 'fishing.advance') {
        if (fishingAdvanceError) {
          const message = fishingAdvanceError;
          fishingAdvanceError = null;
          return json({
            receipt: {
              ok: false,
              commandId: command.commandId ?? 'mock-command',
              code: 'RULE_VIOLATION',
              message,
            },
          });
        }
        activeFishingCastState = null;
        revision += 1;
        return json({
          receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision },
          streamId: characterId,
          events: fishingAdvanceEvents,
        });
      }
      if (command.type === 'fishing.cancel') {
        fishingCancelAttempts += 1;
        if (fishingCancelFailure) {
          return json({
            receipt: {
              ok: false,
              commandId: command.commandId ?? 'mock-command',
              code: 'RULE_VIOLATION',
              message: fishingCancelFailure,
            },
          });
        }
        activeFishingCastState = null;
        revision += 1;
        return json({
          receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision },
          streamId: characterId,
        });
      }
      if (command.type === 'campfire.extinguish') {
        if (room !== 'clearing' || !campfireVisible || command.payload?.campfireId !== 'test-campfire') {
          return json({
            receipt: {
              ok: false,
              commandId: command.commandId ?? 'mock-command',
              code: 'RULE_VIOLATION',
              message: 'There is no burning campfire in this room.',
            },
          });
        }
        campfireVisible = false;
        return json({
          receipt: {
            ok: true,
            commandId: command.commandId ?? 'mock-command',
            eventIds: ['campfire-extinguished'],
            newAggregateVersion: 1,
          },
          streamId: 'world-temporary-campfires',
          events: [{
            type: 'world.campfire_extinguished',
            payload: { campfireId: 'test-campfire', locationId: 'mossgate-clearing' },
          }],
        });
      }
      if (command.type === 'daily.job') {
        const payload = command.payload ?? {};
        dailyCommandPayloads.push({ type: 'daily.job', payload: payload as Record<string, unknown> });
        if (room !== 'clearing' || payload.boardId !== 'reedbank-board') {
          return json({ receipt: { ok: false, commandId: command.commandId ?? 'mock-command', code: 'RULE_VIOLATION', message: 'The bulletin is not here.' } });
        }
        dailyJobStatus = payload.action === 'accept' ? 'active' : 'completed';
        revision += 1;
        return json({
          receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision },
          streamId: characterId,
          events: [{
            type: 'character.daily_job_changed',
            payload: omitDailyRewardTotals && payload.action === 'deliver'
              ? {}
              : { gold: payload.action === 'deliver' ? 15 : 0, experience: payload.action === 'deliver' ? 9 : 0 },
          }],
        });
      }
      if (command.type === 'supply.gather') {
        const payload = command.payload ?? {};
        dailyCommandPayloads.push({ type: 'supply.gather', payload: payload as Record<string, unknown> });
        const sourceIsHere = (room === 'bridge' && payload.sourceId === 'bridge-fishing-pools') ||
          (dailySourceAtBoard && room === 'clearing' && payload.sourceId === 'clearing-spring');
        if (!sourceIsHere) {
          return json({ receipt: { ok: false, commandId: command.commandId ?? 'mock-command', code: 'RULE_VIOLATION', message: 'That supply is not here.' } });
        }
        dailySupplyCount += 1;
        revision += 1;
        return json({
          receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision },
          streamId: characterId,
        });
      }
      if (command.type === 'character.equip') {
        const itemId = command.payload?.itemId;
        const current = equipmentSnapshot ?? { weaponItemId: 'test-sword', armorItemId: null };
        equipmentSnapshot = itemId === 'test-shield'
          ? { ...current, armorItemId: itemId }
          : itemId === 'test-sword' ? { ...current, weaponItemId: itemId } : current;
        revision += 1;
        return json({
          receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision },
          streamId: characterId,
        });
      }
      if (command.type === 'character.unequip') {
        const current = equipmentSnapshot ?? { weaponItemId: 'test-sword', armorItemId: null };
        const slot = (command.payload as Record<string, unknown> | undefined)?.slot;
        equipmentSnapshot = slot === 'weapon'
          ? { ...current, weaponItemId: null }
          : slot === 'armor' ? { ...current, armorItemId: null } : current;
        revision += 1;
        return json({
          receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision },
          streamId: characterId,
        });
      }
      if (command.type === 'character.rest' || command.type === 'character.stand') {
        if (command.type === 'character.rest' && staminaPosture === 'resting') {
          return json({ receipt: { ok: false, commandId: command.commandId ?? 'mock-command', code: 'RULE_VIOLATION', message: 'You are already resting.' } });
        }
        staminaPosture = command.type === 'character.rest' ? 'resting' : 'standing';
        revision += 2;
        return json({
          receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision },
          streamId: characterId,
        });
      }
      if (command.type === 'inn.rest') {
        if (orravethWorld || room !== 'inn' || command.payload?.innId !== 'willowrest-inn-service') {
          return json({ receipt: { ok: false, commandId: command.commandId ?? 'mock-command', code: 'RULE_VIOLATION', message: 'There is no such inn here.' } });
        }
        if (characterHealth && characterHealth.current >= characterHealth.maximum) {
          return json({ receipt: { ok: false, commandId: command.commandId ?? 'mock-command', code: 'RULE_VIOLATION', message: 'You are already at full health.' } });
        }
        if (walletBalance < 5) {
          return json({ receipt: { ok: false, commandId: command.commandId ?? 'mock-command', code: 'RULE_VIOLATION', message: 'You need 5 moss marks to rest.' } });
        }
        walletBalance -= 5;
        characterHealth = { current: 6, maximum: 6 };
        revision += 1;
        return json({
          receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision },
          streamId: characterId,
        });
      }
      if (command.type === 'combat.action') {
        const action = command.payload?.action;
        if (action === 'use-item' && combatEncounter?.status !== 'active') {
          if (!healingDraughtCarried ||
            command.payload?.itemId !== 'item-reedbank-healing-draught' ||
            !characterHealth ||
            characterHealth.current >= characterHealth.maximum) {
            return json({ receipt: { ok: false, commandId: command.commandId ?? 'mock-command', code: 'RULE_VIOLATION', message: 'You are already at full health.' } });
          }
          const healing = Math.min(3, characterHealth.maximum - characterHealth.current);
          characterHealth = { ...characterHealth, current: characterHealth.current + healing };
          healingDraughtCarried = false;
          revision += 1;
          return json({
            receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision },
            streamId: characterId,
          });
        }
        if (!combatEncounter) {
          if (action !== 'attack' || command.payload?.targetNpcId !== 'mossgate-training-sentinel') {
            return json({ receipt: { ok: false, commandId: command.commandId ?? 'mock-command', code: 'RULE_VIOLATION', message: 'That opponent is not available here.' } });
          }
          combatEncounter = {
            encounterId: 'combat-ui-encounter',
            locationId: 'mossgate-clearing',
            opponentNpcId: 'mossgate-training-sentinel',
            opponentName: 'Practice Sentinel',
            round: 1,
            playerHealth: 5,
            playerMaxHealth: 6,
            opponentHealth: 2,
            opponentMaxHealth: 4,
            status: 'active',
            lastAction: 'attack',
            lastNarration: 'You deal 2 damage to Practice Sentinel. It strikes back for 1.',
          };
        } else {
          if (action === 'use-item' && healingDraughtCarried &&
            command.payload?.itemId === 'item-reedbank-healing-draught') {
            healingDraughtCarried = false;
            combatEncounter = {
              ...combatEncounter,
              round: combatEncounter.round + 1,
              playerHealth: Math.min(combatEncounter.playerMaxHealth, combatEncounter.playerHealth + 3) - 1,
              lastAction: 'use-item',
              lastNarration: 'You use the small healing draught and recover 3 health. It strikes back for 1.',
            };
          } else {
            combatEncounter = {
              ...combatEncounter,
              round: combatEncounter.round + 1,
              lastAction: action === 'attack' || action === 'defend' || action === 'flee' || action === 'use-item'
                ? action
                : combatEncounter.lastAction,
              lastNarration: action === 'defend'
                ? 'You guard against Practice Sentinel’s padded strike and take no damage.'
                : combatEncounter.lastNarration,
            };
          }
        }
        revision += 1;
        return json({
          receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision },
          streamId: characterId,
        });
      }
      if (command.type === 'party.create') {
        partyRevision += 1;
        activePartyInfo = {
          groupId: 'created-party',
          groupType: 'party',
          ownerPlayerId: 'account-1',
          maxMembers: 4,
          isPublic: true,
          status: 'active',
          members: [{ playerId: 'account-1', characterId, displayName: 'Rowan' }],
          createdAt: '2026-10-19T12:00:00.000Z',
          leaderName: 'Rowan',
        };
        return json({
          receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: partyRevision },
          streamId: 'groups:mudd-demo-instance',
        });
      }
      if (command.type === 'party.join') {
        partyRevision += 1;
        const joinPayload = command.payload as { groupId?: string } | undefined;
        const groupId = String(joinPayload?.groupId ?? 'joined-party');
        activePartyInfo = {
          groupId,
          groupType: 'party',
          ownerPlayerId: 'account-2',
          maxMembers: 4,
          isPublic: true,
          status: 'active',
          members: [
            { playerId: 'account-2', characterId: 'sella-character', displayName: 'Sella' },
            { playerId: 'account-1', characterId, displayName: 'Rowan' },
          ],
          createdAt: '2026-10-19T12:00:00.000Z',
          leaderName: 'Sella',
        };
        return json({
          receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: partyRevision },
          streamId: 'groups:mudd-demo-instance',
        });
      }
      if (command.type === 'party.leave' || command.type === 'party.close') {
        partyRevision += 1;
        activePartyInfo = null;
        return json({
          receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: partyRevision },
          streamId: 'groups:mudd-demo-instance',
        });
      }
      if (command.type === 'party.quest.start') {
        partyQuestJournalFixture = {
          partyId: 'party-ui-test',
          available: [],
          quests: [{
            questId: 'clear-the-road',
            title: 'Clear the road',
            summary: 'Deal with the ambush.',
            status: 'active',
            objectives: [],
          }],
        };
        return json({
          receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision },
          streamId: 'groups:mudd-demo-instance',
        });
      }
      if (command.type === 'team.combat.start') {
        teamCombatEncounter = {
          encounterId: 'team-combat-ui-encounter',
          locationId: 'mossgate-clearing',
          sourceGroupId: activePartyInfo?.groupId,
          participants: [
            {
              participantId: characterId,
              teamId: 'allies',
              kind: 'player',
              characterId,
              playerId: 'account-1',
              displayName: 'Rowan',
              health: healingDraughtCarried ? 3 : 6,
              maximumHealth: 6,
              defending: false,
              status: 'active',
            },
            {
              participantId: 'mossgate-training-sentinel',
              teamId: 'enemies',
              kind: 'npc',
              npcId: 'mossgate-training-sentinel',
              displayName: 'Practice Sentinel',
              health: 4,
              maximumHealth: 4,
              defending: false,
              status: 'active',
            },
          ],
          contributingPlayerIds: [],
          currentParticipantId: characterId,
          round: 1,
          status: 'active',
          lastNarration: 'The party faces the Practice Sentinel.',
          consumedItemIdsByCharacter: {},
          createdAt: '2026-10-19T12:00:00.000Z',
          updatedAt: '2026-10-19T12:00:00.000Z',
        };
        return json({
          receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: 1 },
          streamId: 'world-team-combat:mudd-demo-instance',
        });
      }
      if (command.type === 'team.combat.action') {
        if (teamCombatEncounter) {
          teamCombatEncounter = {
            ...teamCombatEncounter,
            round: teamCombatEncounter.round + 1,
            contributingPlayerIds: ['account-1'],
            lastNarration: 'Rowan hits the Practice Sentinel for 2 damage.',
            updatedAt: '2026-10-19T12:00:01.000Z',
          };
        }
        return json({
          receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: 2 },
          streamId: 'world-team-combat:mudd-demo-instance',
        });
      }
      if (command.type === 'merchant.purchase') {
        if (room !== 'market' || merchantLanternPurchased || walletBalance < 8) {
          return json({ receipt: { ok: false, commandId: command.commandId ?? 'mock-command', code: 'RULE_VIOLATION', message: 'That purchase is unavailable.' } });
        }
        merchantLanternPurchased = true;
        walletBalance -= 8;
        revision += 1;
        return json({
          receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision },
          streamId: characterId,
        });
      }
      if (command.type === 'character.read' && command.payload?.objectId === 'mossgate-marker') {
        const readObjective = questJournal.find((quest) => quest.questId === 'mara-wayfinding')
          ?.objectives.find((objective) => objective.id === 'read-marker');
        if (readObjective) readObjective.completed = true;
        revision += 1;
        return json({
          receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision },
          streamId: characterId,
          events: [{
            type: 'character.object_read',
            payload: {
              characterId,
              locationId: 'mossgate-clearing',
              objectId: 'mossgate-marker',
              label: 'Weathered marker',
              text: 'OLD BELL TOWER — EAST',
            },
          }],
        });
      }
      if (command.type === 'npc.dialogue.choose') {
        maraChoice = command.payload?.choiceId ?? null;
        revision += 1;
        return json({ receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision }, streamId: characterId });
      }
      if (command.type === 'npc.dialogue.restart') {
        maraChoice = null;
        revision += 1;
        return json({ receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision }, streamId: characterId });
      }
      if (command.type === 'character.take') {
        if (command.payload?.itemId === 'mossgate-loose-stone') itemTaken = true;
        if (command.payload?.itemId === 'mossgate-lost-feather') secondItemTaken = true;
        revision += 1;
        return json({ receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision }, streamId: characterId });
      }
      if (command.type === 'character.drop') {
        if (command.payload?.itemId === 'mossgate-loose-stone') itemTaken = false;
        if (command.payload?.itemId === 'mossgate-lost-feather') secondItemTaken = false;
        revision += 1;
        return json({ receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision }, streamId: characterId });
      }
      if (command.type === 'character.use') {
        revision += 1;
        return json({
          receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision },
          streamId: characterId,
          events: [{
            type: 'character.item_used',
            payload: {
              characterId,
              locationId: currentLocation().locationId,
              itemId: command.payload?.itemId,
              targetId: command.payload?.targetId,
              interactionId: 'test-item-use',
              response: 'The mock interaction succeeds.',
            },
          }],
        });
      }
      if (command.type === 'woodcutting.start') {
        if (woodcuttingStartError) return json({ message: woodcuttingStartError }, 400);
        revision += 1;
        const events = woodcuttingStartEvents;
        woodcuttingStartEvents = [];
        return json({
          receipt: {
            ok: true,
            commandId: command.commandId ?? 'mock-command',
            eventIds: [],
            newAggregateVersion: revision,
          },
          streamId: characterId,
          ...(events.length ? { events } : {}),
        });
      }
      if (command.type === 'woodcutting.advance') {
        if (woodcuttingAdvanceError) {
          const message = woodcuttingAdvanceError;
          woodcuttingAdvanceError = null;
          return json({ message }, 409);
        }
        const treeDepleted = woodcuttingDepletesTree;
        woodcuttingDepletesTree = false;
        const customPayload = woodcuttingAdvancePayload;
        woodcuttingAdvancePayload = null;
        if (treeDepleted || customPayload) {
          activeWoodcuttingState = null;
        } else if (activeWoodcuttingState) {
          activeWoodcuttingState = {
            ...activeWoodcuttingState,
            ticksCompleted: Math.min(9, activeWoodcuttingState.ticksCompleted + 1),
            startedAt: new Date(Date.now() - 3_000).toISOString(),
          };
        }
        revision += 1;
        return json({
          receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision },
          streamId: characterId,
          events: [{
            type: 'character.woodcutting_action_advanced',
            payload: treeDepleted
              ? {
                status: 'logged',
                ticksCompleted: 10,
                logLabel: 'pine logs',
                skillExperienceAwarded: 25,
                totalExperience: 25,
                level: 1,
                treeDepleted: true,
              }
              : customPayload ?? { status: 'waiting', ticksCompleted: activeWoodcuttingState?.ticksCompleted ?? 0 },
          }],
        });
      }
      if (command.type === 'woodcutting.cancel') {
        activeWoodcuttingState = null;
        revision += 1;
        return json({
          receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision },
          streamId: characterId,
        });
      }
      if (moveError) return json({ message: moveError }, 409);
      const destinationByExitId: Record<string, typeof room> = {
        'belfry-to-roof': 'belfry',
        'clearing-to-bridge': 'bridge',
        'bridge-to-clearing': 'clearing',
        'reedbank-to-bridge': 'bridge',
        'reedbank-to-willowrest': 'inn',
        'willowrest-to-reedbank': 'market',
      };
      const destination = command.payload?.exitId
        ? destinationByExitId[command.payload.exitId]
        : undefined;
      if (!destination) {
        return json({
          receipt: {
            ok: false,
            commandId: command.commandId ?? 'mock-command',
            code: 'RULE_VIOLATION',
            message: 'That exit is not available in this test world.',
          },
        });
      }
      room = destination;
      const newLocationId = currentLocation().locationId;
      if (!visitedLocationIds.includes(newLocationId)) visitedLocationIds.push(newLocationId);
      if (newLocationId === 'glasswater-bridge') {
        const visitObjective = questJournal.find((quest) => quest.questId === 'mara-wayfinding')
          ?.objectives.find((objective) => objective.id === 'visit-bridge');
        if (visitObjective) visitObjective.completed = true;
      }
      revision += 1;
      return json({
        receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision },
        streamId: characterId,
        ...(movementEvents.length ? { events: movementEvents } : {}),
      });
    }
    return json({ message: 'Not found.' }, 404);
  });
});

describe('single-character world session client', () => {
  it('renders a victory corpse and exposes its loot without fetching another game snapshot', async () => {
    await withFakeRealtimeSocket(async () => {
      combatEncounter = {
        encounterId: 'combat-corpse-projection',
        locationId: 'mossgate-clearing',
        opponentNpcId: 'mossgate-training-sentinel',
        opponentName: 'Practice Sentinel',
        round: 1,
        playerHealth: 5,
        playerMaxHealth: 6,
        opponentHealth: 2,
        opponentMaxHealth: 4,
        status: 'active',
        lastAction: 'attack',
        lastNarration: 'You deal 2 damage to Practice Sentinel.',
      };
      const original = apiFetch.getMockImplementation()!;
      let latestSnapshot: GameSnapshot | undefined;
      apiFetch.mockImplementation(async (path, init) => {
        if (path === '/api/game') {
          const response = await original(path, init);
          latestSnapshot = await response.json() as GameSnapshot;
          return json(latestSnapshot);
        }
        if (path === '/api/commands' && init?.method === 'POST' && init.body) {
          const command = JSON.parse(String(init.body)) as {
            type?: string;
            commandId?: string;
            payload?: { action?: string };
          };
          if (command.type === 'combat.action' && command.payload?.action === 'attack') {
            if (!latestSnapshot?.character || !latestSnapshot.location) {
              throw new Error('The initial game snapshot was not loaded before combat.');
            }
            const corpseId = 'corpse:practice-sentinel';
            const corpse = {
              id: corpseId,
              label: 'Practice Sentinel’s corpse',
              description: 'The body of the Practice Sentinel lies here.',
              readable: false,
              takeable: false,
              containerKind: 'corpse' as const,
              contents: [{
                id: 'corpse-item:practice-badge',
                label: 'Practice badge',
                description: 'A small wooden badge.',
              }],
            };
            const loot = {
              id: 'corpse-item:practice-badge',
              label: 'Practice badge',
              description: 'A small wooden badge.',
              readable: false,
              takeable: true,
              containerId: corpseId,
            };
            const victoryEncounter = {
              ...combatEncounter!,
              status: 'victory' as const,
              opponentHealth: 0,
              round: combatEncounter!.round + 1,
              lastNarration: 'Practice Sentinel falls, and their body lies here.',
            };
            combatEncounter = victoryEncounter;
            revision += 1;
            const gameProjection = {
              serverTime: new Date().toISOString(),
              character: {
                ...latestSnapshot.character,
                revision,
                combat: victoryEncounter,
              },
              stats: latestSnapshot.stats,
              location: {
                ...latestSnapshot.location,
                description: `${latestSnapshot.location.description}\n\nThe body of the Practice Sentinel lies here.`,
                objects: [...latestSnapshot.location.objects, corpse, loot],
              },
              map: latestSnapshot.map,
              questJournal: latestSnapshot.questJournal ?? [],
              availableFishingSpots: latestSnapshot.availableFishingSpots ?? [],
              availableWoodcuttingTrees: latestSnapshot.availableWoodcuttingTrees ?? [],
              dailyActivities: latestSnapshot.dailyActivities ?? {
                cycle: '2026-10-31',
                boards: [],
                sources: [],
              },
            };
            return json({
              receipt: {
                ok: true,
                commandId: command.commandId ?? 'combat-victory',
                eventIds: ['combat-victory'],
                newAggregateVersion: revision,
              },
              streamId: characterId,
              gameProjection,
            });
          }
        }
        return original(path, init);
      });

      render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
      await screen.findByRole('heading', { name: 'Mossgate Clearing' });
      const gameSnapshotRequests = () =>
        apiFetch.mock.calls.filter(([path]) => path === '/api/game').length;
      const requestsBeforeAttack = gameSnapshotRequests();
      const history = screen.getByRole('region', { name: 'Terminal output' });

      fireEvent.click(within(await screen.findByRole('group', { name: 'Combat actions' }))
        .getByRole('button', { name: 'Attack during active combat' }));

      await waitFor(() => {
        expect(history).toHaveTextContent('Practice Sentinel falls, and their body lies here.');
      });
      expect(gameSnapshotRequests()).toBe(requestsBeforeAttack);

      fireEvent.click(screen.getByRole('button', { name: 'Show corpses to loot' }));
      expect(await screen.findByRole('button', { name: /Practice Sentinel’s corpse/i })).toBeVisible();
    });
  });

  it('shows NPC activity on room entry and full descriptions only after look', async () => {
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    const terminal = await screen.findByRole('region', { name: 'Terminal output' });

    await waitFor(() => {
      expect(terminal).toHaveTextContent('Mara is here, watching the northern trail.');
    });
    expect(terminal).not.toHaveTextContent('A path keeper stands beside the weathered marker');

    const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });
    fireEvent.change(commandInput, { target: { value: 'look' } });
    fireEvent.submit(commandInput.closest('form')!);

    await waitFor(() => {
      expect(terminal).toHaveTextContent(
        'Mara is here. A path keeper stands beside the weathered marker, watching the northern trail.',
      );
    });
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/queries' &&
      JSON.parse(String(init?.body ?? '{}')).payload?.includeNpcDescriptions === true
    )).toBe(true);
  });

  it('explains when a named NPC has no inspectable description', async () => {
    maraLookDescriptionAvailable = false;
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('look Mara');

    expect(await screen.findByText('You cannot get a clear look at Mara right now.')).toBeVisible();
  });

  it('asks which NPC a partial name refers to when several names match', async () => {
    maraLookalikeAvailable = true;
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('look Mar');

    expect(await screen.findByText('Which one do you mean: Mara, Mara Vale?')).toBeVisible();
    submitWorldCommand('talk Mar');
    expect(await screen.findByText('Who do you mean: Mara, Mara Vale?')).toBeVisible();
    const ambiguityCountAfterTalk = screen.getAllByText('Who do you mean: Mara, Mara Vale?').length;
    submitWorldCommand('attack Mar');
    await waitFor(() => {
      expect(screen.getAllByText('Who do you mean: Mara, Mara Vale?')).toHaveLength(ambiguityCountAfterTalk + 1);
    });
    const priorAmbiguityCount = screen.getAllByText('Who do you mean: Mara, Mara Vale?').length;
    submitWorldCommand('shop Mar');
    await waitFor(() => {
      expect(screen.getAllByText('Who do you mean: Mara, Mara Vale?')).toHaveLength(priorAmbiguityCount + 1);
    });
  });

  it('uses a safe fallback when NPC inspection rejects without an Error', async () => {
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/queries' && init?.body) {
        const query = JSON.parse(String(init.body)) as {
          type?: string;
          payload?: { includeNpcDescriptions?: boolean };
        };
        if (query.type === 'location.describe' && query.payload?.includeNpcDescriptions) {
          throw 'untyped inspection failure';
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });
    submitWorldCommand('look Mara');

    await waitFor(() => expect(history).toHaveTextContent('You cannot get a clear look just now.'));
  });

  it('refreshes and displays the other players in the current room', async () => {
    heartbeatOccupants = [{ id: 'mira-character', displayName: 'Mira' }];
    render(<WorldClient onLeaveWorld={async () => undefined} />);

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/api/world-session/heartbeat', expect.objectContaining({
      method: 'POST',
    })));
    expect(await screen.findByText('Here now: Mira')).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledWith('/api/world-session/heartbeat', expect.objectContaining({
      method: 'POST',
    }));
    expect(screen.getByRole('group', { name: 'Players in this room' })).toBeTruthy();
  });

  it('marks room presence as stale when its heartbeat cannot reach the server', async () => {
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/world-session/heartbeat') throw new Error('Heartbeat unavailable.');
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    expect(await screen.findByRole('status', { name: '' })).toHaveTextContent('Presence may be out of date.');
  });

  it('shows a safe connection message when initial loading fails unexpectedly', async () => {
    const original = apiFetch.getMockImplementation()!;
    const onLeaveWorld = vi.fn().mockResolvedValue(undefined);
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/game') throw 'connection lost';
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={onLeaveWorld} />);

    expect(await screen.findByText('The world could not be reached.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Characters' }));
    await waitFor(() => expect(onLeaveWorld).toHaveBeenCalledOnce());
  });

  it('keeps retry and exit actions available after an initial connection failure', async () => {
    const onLeaveWorld = vi.fn().mockResolvedValue(undefined);
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/game') throw new Error('Temporary connection failure.');
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={onLeaveWorld} />);
    expect(await screen.findByText('Temporary connection failure.')).toBeVisible();

    fireEvent.click(screen.getByRole('link', { name: 'Info' }));
    const retryAlert = await screen.findByRole('alert');
    expect(retryAlert).toHaveTextContent('Temporary connection failure.');
    fireEvent.click(within(retryAlert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(apiFetch.mock.calls.filter(([path]) => path === '/api/game')).toHaveLength(2);
    });
  });

  it('does not let a delayed background snapshot replace a completed movement', async () => {
    const timers = vi.spyOn(window, 'setInterval');
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const original = apiFetch.getMockImplementation()!;
    const oldResponse = await original('/api/game');
    let release!: (value: Response) => void;
    const delayed = new Promise<Response>((resolve) => { release = resolve; });
    let first = true;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/game' && first) { first = false; return delayed; }
      return original(path, init);
    });
    const refresh = timers.mock.calls.find(([, delay]) => delay === 15_000)?.[0];
    expect(typeof refresh).toBe('function');
    act(() => { (refresh as () => void)(); });
    quickGo('north');
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    await act(async () => { release(oldResponse); await delayed; });
    expect(screen.getByRole('heading', { name: 'Glasswater Bridge' })).toBeInTheDocument();
    timers.mockRestore();
  });

  it('reconciles an optimistic destination when the server reports another room', async () => {
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'character.move') {
          const response = await original(path, init);
          room = 'market';
          visitedLocationIds = ['mossgate-clearing', 'glasswater-bridge', 'reedbank-stalls'];
          return response;
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    quickGo('north');

    expect(await screen.findByRole('heading', { name: 'Reedbank Stalls' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Glasswater Bridge' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Terminal output' })).toHaveTextContent('Reedbank Stalls');
  });

  it('appends authoritative destination details omitted from the travel preview', async () => {
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation(async (path, init) => {
      const response = await original(path, init);
      if (path !== '/api/game' || room !== 'bridge') return response;
      const game = await response.json() as {
        location: { description: string };
      } & Record<string, unknown>;
      return json({
        ...game,
        location: {
          ...game.location,
          description: `${game.location.description}\n\nBeyond the bridge, the mill wheel turns.`,
        },
      });
    });
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    quickGo('north');

    expect(await screen.findByRole('heading', { name: 'Glasswater Bridge' })).toBeVisible();
    expect(await screen.findByText('Beyond the bridge, the mill wheel turns.')).toBeVisible();
  });

  it('shows the destination room immediately without request-status messages', async () => {
    const original = apiFetch.getMockImplementation()!;
    let departureEvents: TestRoomChatMessage[] = [];
    let releaseMove!: (response: Response) => void;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { type?: string };
        if (body.type === 'character.move') {
          return new Promise<Response>((resolve) => { releaseMove = resolve; });
        }
      }
      if (path.startsWith('/api/chat') && (!init?.method || init.method === 'GET')) {
        const url = new URL(path, 'http://mudd.test');
        if (url.searchParams.get('roomId') === 'glasswater-bridge') {
          const afterId = Number(url.searchParams.get('afterId') ?? 0);
          return json({
            roomId: 'glasswater-bridge',
            messages: [],
            terminalEvents: departureEvents.filter((event) => event.id > afterId),
            cursor: 0,
          });
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    quickGo('north');

    expect(await screen.findByRole('heading', { name: 'Glasswater Bridge' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Players in this room' }))
      .toHaveTextContent('No other players here');
    expect(screen.getByText('A stone bridge crosses clear water.')).toBeVisible();
    expect(screen.getByText('A Bridge Watcher is here, eyes alert. A brass token lies here.')).toBeVisible();
    expect(screen.queryByText('Traveling north…')).not.toBeInTheDocument();
    expect(screen.queryByText('The move was accepted. Waiting for the current room to update.')).not.toBeInTheDocument();
    const command = apiFetch.mock.calls.find(([path, init]) =>
      path === '/api/commands' && init?.method === 'POST' &&
      JSON.parse(String(init.body)).type === 'character.move'
    );
    expect(command).toBeDefined();
    await act(async () => {
      releaseMove(await original(command![0], command![1]));
    });

    expect(await screen.findByRole('heading', { name: 'Glasswater Bridge' })).toBeInTheDocument();
    expect(await screen.findByText('Bridge Watcher leaves the room.')).toBeVisible();
    expect(screen.queryByText('A Bridge Watcher is here, eyes alert. A brass token lies here.')).not.toBeInTheDocument();
    expect(screen.queryByText('Traveling north…')).not.toBeInTheDocument();

    departureEvents = [{
      id: 1,
      roomId: 'glasswater-bridge',
      speakerType: 'npc',
      speakerId: 'bridge-watcher',
      speakerName: 'Bridge Watcher',
      text: 'A watcher leaves toward the south, eyes alert.',
      createdAt: '2026-10-26T12:00:00.000Z',
    }];
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await screen.findByText('Bridge Watcher: A watcher leaves toward the south, eyes alert.')).toBeVisible();
    expect(screen.getAllByText('Bridge Watcher: A watcher leaves toward the south, eyes alert.')).toHaveLength(1);
    expect(screen.queryByText('Bridge Watcher leaves the room.')).not.toBeInTheDocument();
  });

  it('uses the movement response projection without fetching a second game snapshot', async () => {
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation(async (path, init) => {
      const response = await original(path, init);
      if (path !== '/api/commands' || init?.method !== 'POST') return response;
      const command = JSON.parse(String(init.body)) as { type?: string };
      if (command.type !== 'character.move' && command.type !== 'character.road.step') return response;

      const commandResult = await response.json() as Record<string, unknown>;
      const gameResponse = await original('/api/game', {});
      const game = await gameResponse.json() as Record<string, unknown>;
      const projection = {
        character: game.character,
        stats: game.stats,
        location: {
          ...(game.location as Record<string, unknown>),
          npcs: [{ id: 'bridge-watcher', name: 'Bridge Watcher', mobile: true }],
        },
        map: game.map,
        questJournal: game.questJournal ?? [],
        availableFishingSpots: game.availableFishingSpots ?? [],
        availableWoodcuttingTrees: game.availableWoodcuttingTrees ?? [],
        dailyActivities: game.dailyActivities ?? { cycle: '2000-01-01', boards: [], sources: [] },
      };
      return Response.json({ ...commandResult, movementProjection: projection });
    });

    await withFakeRealtimeSocket(async (sockets) => {
      render(<WorldClient onLeaveWorld={async () => undefined} />);
      await screen.findByRole('heading', { name: 'Mossgate Clearing' });
      await waitFor(() => expect(sockets).not.toHaveLength(0));
      const gameRequestCountBeforeMove = apiFetch.mock.calls.filter(([path]) => path === '/api/game').length;

      quickGo('north');

      expect(await screen.findByRole('heading', { name: 'Glasswater Bridge' })).toBeVisible();
      expect(screen.queryByText('Bridge Watcher leaves the room.')).not.toBeInTheDocument();
      await waitFor(() => expect(apiFetch.mock.calls.some(([path, init]) =>
        path === '/api/commands' &&
        JSON.parse(String(init?.body ?? '{}')).type === 'character.move'
      )).toBe(true));
      expect(apiFetch.mock.calls.filter(([path]) => path === '/api/game')).toHaveLength(gameRequestCountBeforeMove);
    });
  });

  it('applies the projection returned with take, drop and equipment actions without a snapshot', async () => {
    includeSecondTakeable = true;
    includeEquipmentFixture = true;
    const projectionHeaders = returnGameProjectionsWithCommands([
      'character.take',
      'character.drop',
      'character.equip',
    ]);
    await withFakeRealtimeSocket(async (sockets) => {
      render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
      await screen.findByRole('heading', { name: 'Mossgate Clearing' });
      const history = screen.getByRole('region', { name: 'Terminal output' });
      const snapshotRequests = () => apiFetch.mock.calls.filter(([path]) => path === '/api/game').length;
      await waitFor(() => expect(sockets).not.toHaveLength(0));
      const snapshotsBeforeActions = snapshotRequests();

      submitWorldCommand('take lost feather');
      await waitFor(() => expect(history).toHaveTextContent('You pick up the lost feather.'));
      // The projection put the feather in the pack, so it can be dropped at once.
      submitWorldCommand('drop lost feather');
      await waitFor(() => expect(history).toHaveTextContent('You put down the lost feather.'));
      submitWorldCommand('equip test shield');
      await waitFor(() => expect(history).toHaveTextContent('You equip the test shield as your armor.'));

      expect(secondItemTaken).toBe(false);
      expect(equipmentSnapshot).toEqual({ weaponItemId: 'test-sword', armorItemId: 'test-shield' });
      expect(projectionHeaders).toEqual(['game', 'game', 'game']);
      expect(snapshotRequests()).toBe(snapshotsBeforeActions);
    });
  });

  it('fetches a snapshot when the socket reports a newer character revision than the projection', async () => {
    await withFakeRealtimeSocket(async (sockets) => {
      returnGameProjectionsWithCommands(['character.take']);
      render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
      await screen.findByRole('heading', { name: 'Mossgate Clearing' });
      const history = screen.getByRole('region', { name: 'Terminal output' });
      const snapshotRequests = () => apiFetch.mock.calls.filter(([path]) => path === '/api/game').length;
      await waitFor(() => expect(sockets.at(-1)?.url).toContain('protocol=2'));
      const socket = sockets.at(-1)!;
      const snapshotsBeforeHint = snapshotRequests();

      // Another writer has advanced the character well past anything the fixture returns.
      act(() => {
        socket.readyState = 1;
        socket.onopen?.();
        socket.onmessage?.({ data: JSON.stringify({ type: 'ready', version: 1, connectionId: 'connection-1' }) });
        socket.onmessage?.({ data: JSON.stringify({
          type: 'invalidate',
          version: 2,
          connectionId: 'connection-1',
          sequence: 1,
          eventId: 'event-1',
          worldInstanceId: 'mudd-demo-instance',
          channels: ['character'],
          revisions: { character: 999 },
        }) });
      });
      // The watcher refreshes once for the hint; wait so it cannot be mistaken for the action's fetch.
      await waitFor(() => expect(snapshotRequests()).toBe(snapshotsBeforeHint + 1));

      submitWorldCommand('take loose stone');
      await waitFor(() => expect(history).toHaveTextContent('You pick up the loose stone.'));

      const takeRequest = apiFetch.mock.calls.findIndex(([path, init]) =>
        path === '/api/commands' && JSON.parse(String(init?.body ?? '{}')).type === 'character.take');
      expect(apiFetch.mock.calls.slice(takeRequest + 1).filter(([path]) => path === '/api/game')).toHaveLength(1);
    });
  });

  it('rolls back optimistic travel when the authoritative projection reports another room', async () => {
    const original = apiFetch.getMockImplementation()!;
    const startingGame = await (await original('/api/game', {})).json() as Record<string, unknown>;
    const startingLocation = startingGame.location;
    apiFetch.mockImplementation(async (path, init) => {
      const response = await original(path, init);
      if (path !== '/api/commands' || init?.method !== 'POST') return response;
      const command = JSON.parse(String(init.body)) as { type?: string };
      if (command.type !== 'character.move') return response;

      const commandResult = await response.json() as Record<string, unknown>;
      const movedGame = await (await original('/api/game', {})).json() as Record<string, unknown>;
      return Response.json({
        ...commandResult,
        movementProjection: { ...movedGame, location: startingLocation },
      });
    });
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    quickGo('north');
    expect(await screen.findByRole('heading', { name: 'Glasswater Bridge' })).toBeVisible();
    expect(await screen.findByRole('heading', { name: 'Mossgate Clearing' })).toBeVisible();
    expect(screen.queryByText('Traveling north…')).not.toBeInTheDocument();
  });

  it('retries fishing after the server says the line is still in the water', async () => {
    room = 'bridge';
    activeFishingCastState = {
      castId: 'retry-fishing-cast',
      spotId: 'glasswater-fishing-spot',
      locationId: 'glasswater-bridge',
      rodItemId: 'old-rod',
      rodQualityId: 'old',
      startedAt: '2000-01-01T00:00:00.000Z',
      tickIntervalSeconds: 1,
      ticksRequired: 10,
      ticksCompleted: 0,
    };
    fishingAdvanceEvents = [{
      type: 'character.fishing_cast_advanced',
      payload: { status: 'no-bite' },
    }];
    const original = apiFetch.getMockImplementation()!;
    let attempts = 0;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'fishing.advance') {
          attempts += 1;
          if (attempts === 1) {
            return Promise.resolve(json({ message: 'The line is still in the water.' }, 409));
          }
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    expect(await screen.findByText('No bites. You reel in your line.', {}, { timeout: 10_000 })).toBeVisible();
    await waitFor(() => expect(attempts).toBeGreaterThanOrEqual(2), { timeout: 10_000 });
    expect(screen.getByRole('region', { name: 'Terminal output' }))
      .not.toHaveTextContent('The line is still in the water.');
  });

  it.each([
    ['character.fishing_cast_advanced', 'You reel in your line before moving on.'],
    ['character.woodcutting_action_advanced', 'You lower your axe before moving on.'],
  ])('reports interrupted timed work after travel when the server returns %s', async (eventType, message) => {
    movementEvents = [{ type: eventType }];
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    quickGo('north');

    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    expect(await screen.findByText(message)).toBeVisible();
  });

  it('announces a combat encounter reported by a travel command', async () => {
    movementEvents = [{ type: 'character.combat_encounter_started' }];
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    quickGo('north');

    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    expect(await screen.findByText('A roadside opponent blocks your way.')).toBeVisible();
  });

  it('announces a cooperative road ambush and shows its encounter narration', async () => {
    activePartyInfo = {
      groupId: 'party-road-ambush',
      groupType: 'party',
      ownerPlayerId: 'account-1',
      maxMembers: 4,
      isPublic: true,
      status: 'active',
      members: [{ playerId: 'account-1', characterId, displayName: 'Rowan' }],
      createdAt: '2026-10-19T12:00:00.000Z',
      leaderName: 'Rowan',
    };
    teamCombatEncounter = {
      encounterId: 'roadside-ambush',
      locationId: 'glasswater-bridge',
      sourceGroupId: 'party-road-ambush',
      participants: [{
        participantId: characterId,
        teamId: 'allies',
        kind: 'player',
        characterId,
        playerId: 'account-1',
        displayName: 'Rowan',
        health: 6,
        maximumHealth: 6,
        defending: false,
        status: 'active',
      }, {
        participantId: 'roadside-bandit',
        teamId: 'enemies',
        kind: 'npc',
        npcId: 'roadside-bandit',
        displayName: 'Roadside bandit',
        health: 4,
        maximumHealth: 4,
        defending: false,
        status: 'active',
      }],
      contributingPlayerIds: [],
      currentParticipantId: characterId,
      round: 2,
      status: 'active',
      lastNarration: 'A roadside bandit blocks the way.',
      consumedItemIdsByCharacter: {},
      createdAt: '2026-10-19T12:00:00.000Z',
      updatedAt: '2026-10-19T12:00:00.000Z',
    };
    movementEvents = [{ type: 'team.road_encounter_started' }];
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    quickGo('north');

    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    expect(await screen.findByText('A roadside ambush interrupts your travel.')).toBeVisible();
    expect(await screen.findByText('A roadside bandit blocks the way. Round 2.')).toBeVisible();
  });

  it('reuses the same movement command ID after an ambiguous server failure', async () => {
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { type?: string };
        if (body.type === 'character.move') {
          return Promise.resolve(Response.json({ message: 'Temporary server issue.' }, { status: 503 }));
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    quickGo('north');
    await waitFor(() => expect(apiFetch.mock.calls.filter(([path, init]) =>
      path === '/api/commands' && init?.method === 'POST'
    )).toHaveLength(1));
    expect(screen.queryByText('Move status is unconfirmed.')).not.toBeInTheDocument();
    expect(screen.queryByText('The move result is not confirmed yet. Your room will update when the server responds.')).not.toBeInTheDocument();
    quickGo('north');
    await waitFor(() => {
      const commands = apiFetch.mock.calls
        .filter(([path, init]) => path === '/api/commands' && init?.method === 'POST')
        .map(([, init]) => JSON.parse(String(init?.body)) as { type?: string; commandId?: string })
        .filter((command) => command.type === 'character.move');
      expect(commands).toHaveLength(2);
      expect(commands[1]?.commandId).toBe(commands[0]?.commandId);
    });
  });

  it('refreshes quietly if navigation still conflicts after automatic retries', async () => {
    const original = apiFetch.getMockImplementation()!;
    let moveAttempts = 0;
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as {
          type?: string;
          commandId?: string;
          expectedVersion?: number;
        };
        if (command.type === 'character.move') {
          moveAttempts += 1;
          const expectedVersion = command.expectedVersion ?? revision;
          revision = expectedVersion + 1;
          return json({
            receipt: {
              ok: false,
              commandId: command.commandId,
              code: 'VERSION_CONFLICT',
              message: `Expected revision ${expectedVersion}; current revision is ${revision}.`,
              retryable: true,
            },
            streamId: characterId,
            events: [],
          });
        }
      }
      return original(path, init);
    });

    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    quickGo('north');

    await waitFor(() => {
      expect(moveAttempts).toBe(4);
      expect(screen.getByRole('heading', { name: 'Mossgate Clearing' })).toBeVisible();
    });
    expect(screen.queryByText('The world updated while you were acting. Please try again.'))
      .not.toBeInTheDocument();
  });

  it('rolls back an optimistic destination when conflict recovery finds another room', async () => {
    const original = apiFetch.getMockImplementation()!;
    let moveAttempts = 0;
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as {
          type?: string;
          commandId?: string;
          expectedVersion?: number;
        };
        if (command.type === 'character.move') {
          moveAttempts += 1;
          const expectedVersion = command.expectedVersion ?? revision;
          revision = expectedVersion + 1;
          if (moveAttempts === 4) {
            room = 'market';
            visitedLocationIds = ['mossgate-clearing', 'glasswater-bridge', 'reedbank-stalls'];
          }
          return json({
            receipt: {
              ok: false,
              commandId: command.commandId,
              code: 'VERSION_CONFLICT',
              message: `Expected revision ${expectedVersion}; current revision is ${revision}.`,
              retryable: true,
            },
            streamId: characterId,
            events: [],
          });
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    quickGo('north');

    await waitFor(() => {
      expect(moveAttempts).toBe(4);
      expect(screen.getByRole('heading', { name: 'Reedbank Stalls' })).toBeVisible();
    });
    expect(screen.getByRole('region', { name: 'Terminal output' })).toHaveTextContent('Reedbank Stalls');
    expect(screen.queryByRole('heading', { name: 'Glasswater Bridge' })).not.toBeInTheDocument();
  });

  it('keeps the optimistic destination when conflict recovery confirms that room', async () => {
    const original = apiFetch.getMockImplementation()!;
    let moveAttempts = 0;
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as {
          type?: string;
          commandId?: string;
          expectedVersion?: number;
        };
        if (command.type === 'character.move') {
          moveAttempts += 1;
          const expectedVersion = command.expectedVersion ?? revision;
          revision = expectedVersion + 1;
          if (moveAttempts === 4) {
            room = 'bridge';
            visitedLocationIds = ['mossgate-clearing', 'glasswater-bridge'];
          }
          return json({
            receipt: {
              ok: false,
              commandId: command.commandId,
              code: 'VERSION_CONFLICT',
              message: `Expected revision ${expectedVersion}; current revision is ${revision}.`,
              retryable: true,
            },
            streamId: characterId,
            events: [],
          });
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    quickGo('north');

    await waitFor(() => {
      expect(moveAttempts).toBe(4);
      expect(screen.getByRole('heading', { name: 'Glasswater Bridge' })).toBeVisible();
    });
    expect(screen.getByRole('region', { name: 'Terminal output' })).toHaveTextContent('Glasswater Bridge');
    expect(screen.queryByRole('heading', { name: 'Mossgate Clearing' })).not.toBeInTheDocument();
  });

  it('rolls back optimistic travel when the server explicitly rejects the move', async () => {
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'character.move') {
          return Promise.resolve(json({ message: 'The road is blocked.' }, 400));
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    quickGo('north');

    expect(await screen.findByText('The road is blocked.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Mossgate Clearing' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Glasswater Bridge' })).not.toBeInTheDocument();
  });

  it('silently rolls back optimistic travel when conflict recovery cannot refresh the room', async () => {
    const original = apiFetch.getMockImplementation()!;
    let failRecoveryReads = 0;
    let moveAttempts = 0;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/game' && failRecoveryReads > 0) {
        failRecoveryReads -= 1;
        return Promise.resolve(json({ message: 'Temporary server issue.' }, 503));
      }
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as {
          type?: string;
          commandId?: string;
          expectedVersion?: number;
        };
        if (command.type === 'character.move') {
          moveAttempts += 1;
          const expectedVersion = command.expectedVersion ?? revision;
          revision = expectedVersion + 1;
          failRecoveryReads = 2;
          return Promise.resolve(json({
            receipt: {
              ok: false,
              commandId: command.commandId,
              code: 'VERSION_CONFLICT',
              message: `Expected revision ${expectedVersion}; current revision is ${revision}.`,
              retryable: true,
            },
            streamId: characterId,
            events: [],
          }));
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    quickGo('north');

    await waitFor(() => {
      expect(moveAttempts).toBe(1);
      expect(screen.getByRole('heading', { name: 'Mossgate Clearing' })).toBeVisible();
    });
    expect(screen.queryByRole('heading', { name: 'Glasswater Bridge' })).not.toBeInTheDocument();
    expect(screen.queryByText('Temporary server issue.')).not.toBeInTheDocument();
  });

  it('shows an uncertain PvP challenge and reuses its command ID when retried', async () => {
    roomOccupants = [{ id: 'mira-character', displayName: 'Mira' }];
    heartbeatOccupants = [{ id: 'mira-character', displayName: 'Mira' }];
    const original = apiFetch.getMockImplementation()!;
    const releases: Array<(response: Response) => void> = [];
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { type?: string };
        if (body.type === 'interaction.request') {
          return new Promise<Response>((resolve) => { releases.push(resolve); });
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('attack Mira');
    expect(await screen.findByText('Sending challenge to Mira…')).toBeVisible();
    await act(async () => {
      releases[0]!(Response.json({ message: 'Temporary server issue.' }, { status: 503 }));
    });
    expect(await screen.findByText('Challenge status is unconfirmed.')).toBeVisible();

    submitWorldCommand('attack Mira');
    expect(await screen.findByText('Sending challenge to Mira…')).toBeVisible();
    const challengeCommands = apiFetch.mock.calls
      .filter(([path, init]) => path === '/api/commands' && init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body)) as { type?: string; commandId?: string })
      .filter((command) => command.type === 'interaction.request');
    expect(challengeCommands).toHaveLength(2);
    expect(challengeCommands[1]?.commandId).toBe(challengeCommands[0]?.commandId);
    await act(async () => {
      releases[1]!(Response.json({ message: 'Challenge rejected.' }, { status: 400 }));
    });
  });

  it('confirms a challenge after an uncertain request appears in the inbox', async () => {
    roomOccupants = [{ id: 'mira-character', displayName: 'Mira' }];
    heartbeatOccupants = [{ id: 'mira-character', displayName: 'Mira' }];
    const original = apiFetch.getMockImplementation()!;
    const outgoingRequest = {
      requestId: 'outgoing-challenge',
      kind: 'pvp.challenge',
      initiatorCharacterId: characterId,
      initiatorName: 'Rowan',
      recipientCharacterId: 'mira-character',
      recipientName: 'Mira',
      status: 'pending' as const,
      createdAt: '2026-10-25T12:00:00.000Z',
      expiresAt: '2026-10-25T12:05:00.000Z',
    };
    let inbox: InteractionInbox = { requests: [], encounter: null };
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/interactions') return json(inbox);
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'interaction.request') {
          inbox = { requests: [outgoingRequest], encounter: null };
          return json({ message: 'Temporary server issue.' }, 503);
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('attack Mira');
    expect(await screen.findByText('Challenge status is unconfirmed.')).toBeVisible();
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(await screen.findByText('Challenge sent to Mira. Waiting for a response.')).toBeVisible();
  });

  it('shows an uncertain PvP response and reuses its command ID when retried', async () => {
    const original = apiFetch.getMockImplementation()!;
    const incomingRequest = {
      requestId: 'incoming-challenge',
      kind: 'pvp.challenge',
      initiatorCharacterId: 'mira-character',
      initiatorName: 'Mira',
      recipientCharacterId: characterId,
      recipientName: 'Rowan',
      status: 'pending' as const,
      createdAt: '2026-10-25T12:00:00.000Z',
      expiresAt: '2026-10-25T12:05:00.000Z',
    };
    const inbox = { requests: [incomingRequest], encounter: null } satisfies InteractionInbox;
    const releases: Array<(response: Response) => void> = [];
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/interactions') return Promise.resolve(json(inbox));
      if (path === '/api/commands' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { type?: string };
        if (body.type === 'interaction.respond') {
          return new Promise<Response>((resolve) => { releases.push(resolve); });
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    await screen.findByText(/Mira challenges you\./);
    const terminalHistory = screen.getByRole('region', { name: 'Terminal output' });

    submitWorldCommand('accept incoming-challenge');
    expect(await screen.findByText('Sending your accept…', {}, { timeout: 5_000 })).toBeVisible();
    await act(async () => {
      releases[0]!(Response.json({ message: 'Temporary server issue.' }, { status: 503 }));
    });
    expect(await screen.findByText('Response status is unconfirmed.')).toBeVisible();
    await waitFor(() => expect(terminalHistory.closest('.focused-terminal')).toHaveAttribute('aria-busy', 'false'));

    submitWorldCommand('accept incoming-challenge');
    expect(await screen.findByText('Sending your accept…', {}, { timeout: 5_000 })).toBeVisible();
    const responseCommands = apiFetch.mock.calls
      .filter(([path, init]) => path === '/api/commands' && init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body)) as { type?: string; commandId?: string })
      .filter((command) => command.type === 'interaction.respond');
    expect(responseCommands).toHaveLength(2);
    expect(responseCommands[1]?.commandId).toBe(responseCommands[0]?.commandId);
    await act(async () => {
      releases[1]!(Response.json({ message: 'Challenge response rejected.' }, { status: 400 }));
    });
  });

  it('confirms an uncertain PvP response when the refreshed inbox records it', async () => {
    const original = apiFetch.getMockImplementation()!;
    const incomingRequest = {
      requestId: 'incoming-challenge',
      kind: 'pvp.challenge' as const,
      initiatorCharacterId: 'mira-character',
      initiatorName: 'Mira',
      recipientCharacterId: characterId,
      recipientName: 'Rowan',
      status: 'pending' as const,
      createdAt: '2026-10-25T12:00:00.000Z',
      expiresAt: '2026-10-25T12:05:00.000Z',
    };
    let inbox: InteractionInbox = { requests: [incomingRequest], encounter: null };
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/interactions') return Promise.resolve(json(inbox));
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'interaction.respond') {
          return Promise.resolve(json({ message: 'Temporary server issue.' }, 503));
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('accept incoming-challenge');
    expect(await screen.findByText('Response status is unconfirmed.')).toBeVisible();

    inbox = {
      ...inbox,
      requests: [{ ...incomingRequest, status: 'accepted' }],
    };
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      expect(screen.queryByText('Response status is unconfirmed.')).not.toBeInTheDocument();
    });
  });

  it('confirms an accepted PvP challenge from the refreshed interaction inbox', async () => {
    const original = apiFetch.getMockImplementation()!;
    const incomingRequest = {
      requestId: 'incoming-challenge',
      kind: 'pvp.challenge',
      initiatorCharacterId: 'mira-character',
      initiatorName: 'Mira',
      recipientCharacterId: characterId,
      recipientName: 'Rowan',
      status: 'pending' as const,
      createdAt: '2026-10-25T12:00:00.000Z',
      expiresAt: '2026-10-25T12:05:00.000Z',
    };
    let inbox: InteractionInbox = { requests: [incomingRequest], encounter: null };
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/interactions') return json(inbox);
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string; commandId?: string };
        if (command.type === 'interaction.respond') {
          inbox = {
            ...inbox,
            requests: inbox.requests.map((request) => ({
              ...request,
              status: request.requestId === incomingRequest.requestId ? 'accepted' : request.status,
            })),
          };
          return json({
            receipt: {
              ok: true,
              commandId: command.commandId ?? 'mock-command',
              eventIds: [],
              newAggregateVersion: 1,
            },
            streamId: characterId,
          });
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    await screen.findByText(/Mira challenges you\./);

    submitWorldCommand('accept');
    expect(await screen.findByText('Choose a challenge ID: accept <id>.')).toBeVisible();
    submitWorldCommand('accept stale-challenge');
    expect(await screen.findByText('That pending challenge is not available to this character.')).toBeVisible();
    submitWorldCommand('accept incoming-challenge');

    expect(await screen.findByText('You accept Mira’s challenge.')).toBeVisible();
  });

  it('executes PvP actions, uses a healing item, and reports respawn drops', async () => {
    healingDraughtCarried = true;
    characterHealth = { current: 3, maximum: 6 };
    const original = apiFetch.getMockImplementation()!;
    const initialEncounter: NonNullable<InteractionInbox['encounter']> = {
      encounterId: 'active-duel',
      requestId: 'accepted-challenge',
      locationId: 'mossgate-clearing',
      status: 'active' as const,
      participants: [
        { characterId, name: 'Rowan', health: 5, maximumHealth: 6 },
        { characterId: 'mira-character', name: 'Mira', health: 6, maximumHealth: 6 },
      ],
      round: 1,
      turnCharacterId: characterId,
      lastNarration: 'Mira challenges you to a duel.',
      updatedAt: '2026-10-19T12:00:00.000Z',
    };
    let inbox: InteractionInbox = { requests: [], encounter: initialEncounter };
    let actionCount = 0;
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/interactions') return json(inbox);
      if (path === '/api/commands' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as { type?: string; commandId?: string };
        if (body.type === 'pvp.action') {
          actionCount += 1;
          if (actionCount === 1) {
            inbox = {
              requests: [],
              encounter: {
                ...initialEncounter,
                round: 2,
                lastNarration: 'You guard against Mira’s strike.',
                updatedAt: '2026-10-19T12:00:01.000Z',
              },
            };
            return json({
              receipt: { ok: true, commandId: body.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: 2 },
              streamId: 'pvp:active-duel',
              events: [],
            });
          }
          if (actionCount === 2) {
            healingDraughtCarried = false;
            characterHealth = { current: 6, maximum: 6 };
            inbox = {
              requests: [],
              encounter: {
                ...initialEncounter,
                round: 3,
                lastNarration: 'You use a small healing draught and recover 3 health.',
                updatedAt: '2026-10-19T12:00:02.000Z',
              },
            };
            return json({
              receipt: { ok: true, commandId: body.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: 3 },
              streamId: 'pvp:active-duel',
              events: [],
            });
          }
          inbox = { requests: [], encounter: null };
          return json({
            receipt: { ok: true, commandId: body.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: 4 },
            streamId: 'pvp:active-duel',
            events: [{
              type: 'character.respawned',
              payload: { droppedItem: { item: { label: 'Copper ring' } } },
            }],
          });
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });
    const combatActions = await screen.findByRole('group', { name: 'Player combat actions' });
    fireEvent.click(within(combatActions).getByRole('button', { name: 'defend' }));
    await waitFor(() => expect(history).toHaveTextContent('You guard against Mira’s strike.'));

    const nextActions = await screen.findByRole('group', { name: 'Player combat actions' });
    fireEvent.click(within(nextActions).getByRole('button', { name: 'use Small healing draught' }));
    await waitFor(() => expect(history).toHaveTextContent('You use a small healing draught and recover 3 health.'));

    const finalActions = await screen.findByRole('group', { name: 'Player combat actions' });
    fireEvent.click(within(finalActions).getByRole('button', { name: 'attack' }));
    await waitFor(() => expect(history).toHaveTextContent(
      'You awaken at Mossgate Clearing, restored to full health. Copper ring was dropped where you fell.',
    ));

    const actionCommands = apiFetch.mock.calls
      .filter(([path, init]) => path === '/api/commands' && init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body ?? '{}')) as {
        type?: string;
        payload?: { action?: string; itemId?: string };
      })
      .filter((command) => command.type === 'pvp.action');
    expect(actionCommands.map((command) => command.payload?.action)).toEqual(['defend', 'use-item', 'attack']);
    expect(actionCommands[1]?.payload?.itemId).toBe('item-reedbank-healing-draught');
    expect(actionCount).toBe(3);
  });

  it('shows a rejected PvP action and re-enables the combat controls', async () => {
    const original = apiFetch.getMockImplementation()!;
    const encounter: NonNullable<InteractionInbox['encounter']> = {
      encounterId: 'active-duel',
      requestId: 'accepted-challenge',
      locationId: 'mossgate-clearing',
      status: 'active',
      participants: [
        { characterId, name: 'Rowan', health: 5, maximumHealth: 6 },
        { characterId: 'mira-character', name: 'Mira', health: 6, maximumHealth: 6 },
      ],
      round: 1,
      turnCharacterId: characterId,
      lastNarration: 'Mira challenges you to a duel.',
      updatedAt: '2026-10-19T12:00:00.000Z',
    };
    const inbox: InteractionInbox = { requests: [], encounter };
    let actionAttempts = 0;
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/interactions') return json(inbox);
      if (path === '/api/commands' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as { type?: string; commandId?: string };
        if (body.type === 'pvp.action') {
          actionAttempts += 1;
          return json({
            receipt: {
              ok: false,
              commandId: body.commandId ?? 'mock-command',
              code: 'RULE_VIOLATION',
              message: 'The duel action was rejected.',
            },
          });
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });
    const actions = await screen.findByRole('group', { name: 'Player combat actions' });
    const attackButton = within(actions).getByRole('button', { name: 'attack' });
    await waitFor(() => expect(attackButton).toBeEnabled());
    fireEvent.click(attackButton);
    await waitFor(() => expect(actionAttempts).toBe(1));

    await waitFor(() => expect(history.querySelector('.mudd-log__entry--error')).not.toBeNull());
    const controls = await screen.findByRole('group', { name: 'Player combat actions' });
    expect(within(controls).getByRole('button', { name: 'attack' })).toBeEnabled();
    fireEvent.click(within(controls).getByRole('button', { name: 'flee' }));
    await waitFor(() => expect(actionAttempts).toBe(2));
    expect(within(await screen.findByRole('group', { name: 'Player combat actions' }))
      .getByRole('button', { name: 'flee' })).toBeEnabled();
  });

  it.each([
    ['accept', 'accepted', 'You accept Mira’s challenge.'],
    ['decline', 'declined', 'You decline Mira’s challenge.'],
  ] as const)('confirms an incoming PvP challenge response when the server records it', async (response, status, message) => {
    const original = apiFetch.getMockImplementation()!;
    const incomingRequest = {
      requestId: 'incoming-challenge',
      kind: 'pvp.challenge' as const,
      initiatorCharacterId: 'mira-character',
      initiatorName: 'Mira',
      recipientCharacterId: characterId,
      recipientName: 'Rowan',
      status: 'pending' as const,
      createdAt: '2026-10-25T12:00:00.000Z',
      expiresAt: '2026-10-25T12:05:00.000Z',
    };
    let inbox: InteractionInbox = { requests: [incomingRequest], encounter: null };
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/interactions') return json(inbox);
      if (path === '/api/commands' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as {
          type?: string;
          commandId?: string;
          payload?: { response?: 'accept' | 'decline' };
        };
        if (body.type === 'interaction.respond') {
          inbox = {
            requests: [{ ...incomingRequest, status }],
            encounter: null,
          };
          return json({
            receipt: { ok: true, commandId: body.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: 1 },
            streamId: characterId,
          });
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    submitWorldCommand(`${response} incoming-challenge`);

    await waitFor(() => expect(history).toHaveTextContent(message));
    expect(inbox.requests[0]?.status).toBe(status);
  });

  it('shows only available quick commands with no more than four actions per page', async () => {
    render(<WorldClient onLeaveWorld={async () => undefined} />);

    const pages = await collectQuickActionPages();
    expect(pages.flat()).toEqual([
      'Show look targets',
      'Show readable objects',
      'Show items to take',
      'Show people to talk to',
      'Show opponents to attack',
      'Rest and recover health, stamina, and mana',
      'Show command help',
    ]);
    expect(pages).toHaveLength(2);
    expect(pages.every((page) => page.length <= 4)).toBe(true);
  });

  it('shows up to six quick actions per desktop page when rest is available', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    const desktopMediaQuery = {
      matches: true,
      media: '(min-width: 700px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    } as unknown as MediaQueryList;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => desktopMediaQuery),
    });

    try {
      render(<WorldClient onLeaveWorld={async () => undefined} />);
      const firstPage = await screen.findByRole('group', { name: 'Quick commands, page 1' });
      const firstPageActions = within(firstPage).getAllByRole('button')
        .filter((button) =>
          !button.classList.contains('focused-quick-command--back') &&
          !button.classList.contains('focused-quick-command--next')
        );
      expect(firstPageActions).toHaveLength(6);
      expect(desktopMediaQuery.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
      expect(within(firstPage).getByRole('button', { name: 'Show quick actions page 2' })).toBeInTheDocument();
    } finally {
      if (originalDescriptor) Object.defineProperty(window, 'matchMedia', originalDescriptor);
      else Reflect.deleteProperty(window, 'matchMedia');
    }
  });

  it('hides target-dependent actions in a room without their targets', async () => {
    room = 'bridge';
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });

    expect(quickActionVisibleAnywhere('Show available exits')).toBe(false);
    expect(quickActionVisibleAnywhere('Show items to take')).toBe(false);
    expect(quickActionVisibleAnywhere('Show people to talk to')).toBe(false);
    expect(quickActionVisibleAnywhere('Show opponents to attack')).toBe(false);
    expect(quickActionVisibleAnywhere('Attack during active combat')).toBe(false);
    expect(quickActionVisibleAnywhere('Defend')).toBe(false);
    expect(quickActionVisibleAnywhere('Flee')).toBe(false);
    expect(quickActionVisibleAnywhere('Show merchants')).toBe(false);
    expect(quickActionVisibleAnywhere('Show items to buy')).toBe(false);
  });

  it('validates terminal attack targets before starting an NPC encounter', async () => {
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    submitWorldCommand('attack');
    await waitFor(() => expect(history).toHaveTextContent('Attack whom?'));
    submitWorldCommand('attack Unknown combatant');
    await waitFor(() => expect(history).toHaveTextContent('There is no available combatant called “Unknown combatant” here.'));
    submitWorldCommand('attack Practice Sentinel');

    expect(await screen.findByText('Round 1 · Practice Sentinel')).toBeVisible();
    expect(apiFetch.mock.calls.some(([path, init]) => {
      if (path !== '/api/commands') return false;
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        type?: string;
        payload?: { targetNpcId?: string };
      };
      return body.type === 'combat.action' && body.payload?.targetNpcId === 'mossgate-training-sentinel';
    })).toBe(true);
  });

  it('starts and controls combat through terminal actions backed by SDK commands', async () => {
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    clickQuickAction('Show opponents to attack');
    fireEvent.click(screen.getByRole('button', { name: 'Return to quick commands' }));
    clickQuickAction('Show opponents to attack');
    fireEvent.click(await screen.findByRole('button', { name: 'Attack Practice Sentinel' }));
    await screen.findByText('Round 1 · Practice Sentinel');
    expect(screen.queryByRole('region', { name: 'Quick commands' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Enter a command' })).not.toBeInTheDocument();
    const combatActions = screen.getByRole('group', { name: 'Combat actions' });
    expect(within(combatActions).getByRole('button', { name: 'Attack during active combat' })).toBeInTheDocument();
    expect(within(combatActions).getByRole('button', { name: 'Defend during active combat' })).toBeInTheDocument();
    expect(within(combatActions).getByRole('button', { name: 'Flee from combat' })).toBeInTheDocument();
    fireEvent.click(within(combatActions).getByRole('button', { name: 'Defend during active combat' }));
    await screen.findByText('Round 2 · Practice Sentinel');
    const roundTwoActions = await screen.findByRole('group', { name: 'Combat actions' });
    fireEvent.click(within(roundTwoActions).getByRole('button', { name: 'Attack during active combat' }));
    await screen.findByText('Round 3 · Practice Sentinel');
    const roundThreeActions = await screen.findByRole('group', { name: 'Combat actions' });
    fireEvent.click(within(roundThreeActions).getByRole('button', { name: 'Flee from combat' }));
    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([path, init]) =>
        path === '/api/commands' &&
        JSON.parse(String(init?.body ?? '{}')).payload?.action === 'flee',
      )).toBe(true);
    });

    const commands = apiFetch.mock.calls
      .filter(([path]) => path === '/api/commands')
      .map(([, init]) => JSON.parse(String(init?.body ?? '{}')) as {
        type?: string;
        payload?: { action?: string; targetNpcId?: string; encounterId?: string };
      });
    expect(commands).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'combat.action',
        payload: { action: 'attack', targetNpcId: 'mossgate-training-sentinel' },
      }),
      expect.objectContaining({
        type: 'combat.action',
        payload: { action: 'defend', encounterId: 'combat-ui-encounter' },
      }),
      expect.objectContaining({
        type: 'combat.action',
        payload: { action: 'attack', encounterId: 'combat-ui-encounter' },
      }),
      expect.objectContaining({
        type: 'combat.action',
        payload: { action: 'flee', encounterId: 'combat-ui-encounter' },
      }),
    ]));
  });

  it('starts a cooperative encounter from a party and keeps combat-only controls', async () => {
    healingDraughtCarried = true;
    activePartyInfo = {
      groupId: 'party-ui-test',
      groupType: 'party',
      ownerPlayerId: 'account-1',
      maxMembers: 4,
      isPublic: true,
      status: 'active',
      members: [{ playerId: 'account-1', characterId, displayName: 'Rowan' }],
      createdAt: '2026-10-19T12:00:00.000Z',
      leaderName: 'Rowan',
    };
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    clickQuickAction('Show opponents to attack');
    fireEvent.click(await screen.findByRole('button', { name: 'Attack Practice Sentinel' }));

    await screen.findByText('Round 2 · Cooperative encounter');
    expect(screen.queryByRole('region', { name: 'Quick commands' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Enter a command' })).not.toBeInTheDocument();
    const getCombatActions = () => screen.getByRole('group', { name: 'Cooperative combat actions' });
    expect(getCombatActions()).toBeInTheDocument();
    fireEvent.click(within(getCombatActions()).getByRole('button', { name: 'attack' }));
    await screen.findByText('Round 3 · Cooperative encounter');
    fireEvent.click(within(getCombatActions()).getByRole('button', { name: 'defend' }));
    await screen.findByText('Round 4 · Cooperative encounter');
    fireEvent.click(within(getCombatActions()).getByRole('button', { name: 'use' }));
    const combatItems = await screen.findByRole('group', { name: 'Items available during cooperative combat' });
    fireEvent.click(within(combatItems).getByRole('button', { name: 'Small healing draught' }));
    await screen.findByText('Round 5 · Cooperative encounter');
    fireEvent.click(within(getCombatActions()).getByRole('button', { name: 'flee' }));
    await screen.findByText('Round 6 · Cooperative encounter');
    expect(apiFetch.mock.calls.some(([path, init]) => {
      if (path !== '/api/commands') return false;
      const body = JSON.parse(String(init?.body ?? '{}')) as { type?: string };
      return body.type === 'team.combat.start';
    })).toBe(true);
    expect(apiFetch.mock.calls.some(([path, init]) => {
      if (path !== '/api/commands') return false;
      const body = JSON.parse(String(init?.body ?? '{}')) as { type?: string };
      return body.type === 'team.combat.action';
    })).toBe(true);
    expect(apiFetch.mock.calls.some(([path, init]) => {
      if (path !== '/api/commands') return false;
      const body = JSON.parse(String(init?.body ?? '{}')) as { type?: string };
      return body.type === 'combat.action';
    })).toBe(false);
  });

  it('prints party command help in the terminal', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('party help');

    const terminal = screen.getByRole('region', { name: 'Terminal output' });
    expect(terminal).toHaveTextContent('> party help');
    expect(terminal).toHaveTextContent('party [help|info|list|create|join <id>|quests|quest start <id>|leave|close]');
  });

  it('reports when the character is not in a party', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('party');

    expect(await screen.findByText(/You are not in a party\./)).toBeVisible();
  });

  it('lists the party leader and members for the party info command', async () => {
    activePartyInfo = {
      groupId: 'party-ui-test',
      groupType: 'party',
      ownerPlayerId: 'account-1',
      maxMembers: 4,
      isPublic: true,
      status: 'active',
      members: [{ playerId: 'account-1', characterId, displayName: 'Rowan' }],
      createdAt: '2026-10-19T12:00:00.000Z',
      leaderName: 'Rowan',
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('party info extra');
    expect(await screen.findByText('Usage: party info')).toBeVisible();
    submitWorldCommand('party info');

    expect(await screen.findByText('Rowan leads party party-ui-test (1/4).')).toBeVisible();
    expect(screen.getByText('Rowan (leader)')).toBeVisible();
  });

  it('reports when there are no public parties to join', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('party list');

    expect(await screen.findByText('There are no public parties available.')).toBeVisible();
  });

  it('lists public parties and marks full parties as unavailable', async () => {
    partyListFixture = [
      {
        groupId: 'party-open',
        leaderName: 'Sella',
        members: [{ playerId: 'account-2', characterId: 'sella-character', displayName: 'Sella' }],
        memberCount: 1,
        maxMembers: 4,
        joinable: true,
      },
      {
        groupId: 'party-full',
        leaderName: 'Mara',
        members: [
          { playerId: 'account-3', characterId: 'mara-character', displayName: 'Mara' },
          { playerId: 'account-4', characterId: 'taren-character', displayName: 'Taren' },
          { playerId: 'account-5', characterId: 'orin-character', displayName: 'Orin' },
          { playerId: 'account-6', characterId: 'linnet-character', displayName: 'Linnet' },
        ],
        memberCount: 4,
        maxMembers: 4,
        joinable: false,
      },
    ];
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('party list');

    expect(await screen.findByText('Sella — 1/4 members — ID party-open')).toBeVisible();
    const terminal = screen.getByRole('region', { name: 'Terminal output' });
    expect(terminal).toHaveTextContent(/Mara\s+—\s+4\/4 members\s+—\s+ID party-full \(full\)/);
    expect(terminal).toHaveTextContent('Join with: party join <id>');
  });

  it.each(['party quests', 'party quest'])('explains that shared quests require a party for %s', async (command) => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand(command);

    expect(await screen.findByText('Join a party to view shared quests.')).toBeVisible();
  });

  it('reports when an active party has no shared quests yet', async () => {
    partyQuestJournalFixture = { partyId: 'party-ui-test', available: [], quests: [] };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('party quests');

    expect(await screen.findByText('There are no party quests available.')).toBeVisible();
  });

  it('lists current and available shared quests with objective progress', async () => {
    partyQuestJournalFixture = {
      partyId: 'party-ui-test',
      available: [{ questId: 'clear-the-road', title: 'Clear the road', summary: 'Deal with the ambush.' }],
      quests: [{
        questId: 'missing-supplies',
        title: 'Missing supplies',
        summary: 'Find the missing crates.',
        status: 'active',
        objectives: [
          { id: 'speak-to-guard', label: 'Speak to the guard', progress: 1, required: 1, completed: true },
          { id: 'find-crates', label: 'Find the crates', progress: 2, required: 3, completed: false },
        ],
      }],
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('party quests');

    const terminal = screen.getByRole('region', { name: 'Terminal output' });
    expect(await screen.findByText('Missing supplies (active) — Find the missing crates.')).toBeVisible();
    expect(terminal).toHaveTextContent('✓ 1/1 Speak to the guard');
    expect(terminal).toHaveTextContent('· 2/3 Find the crates');
    expect(terminal).toHaveTextContent('Clear the road — Deal with the ambush. (start: party quest start clear-the-road)');
  });

  it('starts a party quest from its available command', async () => {
    partyQuestJournalFixture = {
      partyId: 'party-ui-test',
      available: [{ questId: 'clear-the-road', title: 'Clear the road', summary: 'Deal with the ambush.' }],
      quests: [],
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('party quest start clear-the-road');

    expect(await screen.findByText('Your party started Clear the road.')).toBeVisible();
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body)).type === 'party.quest.start' &&
      JSON.parse(String(init?.body)).payload.questId === 'clear-the-road',
    )).toBe(true);
  });

  it('creates a party and reports its new ID', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('party create');

    expect(await screen.findByText('Party created (ID created-party).')).toBeVisible();
  });

  it('joins a party by ID and reports its leader', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('party join party-open');

    expect(await screen.findByText('You joined Sella.')).toBeVisible();
  });

  it.each([
    ['leader', 'account-1', 'You left and closed your party.'],
    ['member', 'account-2', 'You left the party.'],
  ])('reports the correct result when a party %s leaves', async (_role, ownerPlayerId, message) => {
    activePartyInfo = {
      groupId: 'party-ui-test',
      groupType: 'party',
      ownerPlayerId,
      maxMembers: 4,
      isPublic: true,
      status: 'active',
      members: [{ playerId: 'account-1', characterId, displayName: 'Rowan' }],
      createdAt: '2026-10-19T12:00:00.000Z',
      leaderName: 'Rowan',
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('party leave');

    expect(await screen.findByText(message)).toBeVisible();
  });

  it('closes a party from the terminal command', async () => {
    activePartyInfo = {
      groupId: 'party-ui-test',
      groupType: 'party',
      ownerPlayerId: 'account-1',
      maxMembers: 4,
      isPublic: true,
      status: 'active',
      members: [{ playerId: 'account-1', characterId, displayName: 'Rowan' }],
      createdAt: '2026-10-19T12:00:00.000Z',
      leaderName: 'Rowan',
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('party close');

    expect(await screen.findByText('You closed the party.')).toBeVisible();
  });

  it.each([
    ['party join', 'Usage: party join <id>'],
    ['party create extra', 'Usage: party create'],
    ['party leave now', 'Usage: party leave'],
    ['party close now', 'Usage: party close'],
    ['party quest help', 'Usage: party quest start <quest-id>'],
  ])('shows usage guidance for malformed command “%s”', async (command, message) => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand(command);

    expect(await screen.findByText(message)).toBeVisible();
  });

  it('reports unknown party subcommands without sending a request', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('party nonsense');

    expect(await screen.findByText('Unknown party command. Try “party help”.')).toBeVisible();
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body)).type.startsWith('party.'),
    )).toBe(false);
  });

  it('opens focused gameplay and groups character tabs and Field notes under Info', async () => {
    const onLeaveWorld = vi.fn().mockResolvedValue(undefined);
    characterHealth = { current: 5, maximum: 6 };
    render(<WorldClient onLeaveWorld={onLeaveWorld} />);
    const roomHeading = await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    expect(roomHeading).toHaveClass('mudd-visually-hidden');
    const history = screen.getByRole('region', { name: 'Terminal output' });
    expect(history).toHaveTextContent('> look');
    await waitFor(() => {
      expect(history).toHaveTextContent(
        'A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east. One loose stone bears a pale stripe.',
      );
    });
    const initialTranscript = history.textContent ?? '';
    expect(initialTranscript.indexOf('Mossgate Clearing')).toBeLessThan(
      initialTranscript.indexOf('A circle of pale stones breaks through the moss.'),
    );
    const roomLookButton = within(history).getByRole('button', {
      name: 'Look at Mossgate Clearing in terminal',
    });
    expect(roomLookButton).toBeInTheDocument();
    const roomDescriptionQueryCount = apiFetch.mock.calls.filter(([path, init]) =>
      path === '/api/queries' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'location.describe',
    ).length;
    fireEvent.click(roomLookButton);
    await waitFor(() => {
      const nextCount = apiFetch.mock.calls.filter(([path, init]) =>
        path === '/api/queries' &&
        JSON.parse(String(init?.body ?? '{}')).type === 'location.describe',
      ).length;
      expect(nextCount).toBe(roomDescriptionQueryCount + 1);
    });
    expect(screen.queryByText(/World activity|\b\d+\s+events?\b/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Look around' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Enter a command' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Info' })).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Info sections' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Room chat' }).closest('.focused-terminal')).toBeNull();
    expect(screen.queryByText(/No rush|Guest identity|room:mosgate/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Info' }));
    const infoTabs = await screen.findByRole('navigation', { name: 'Info sections' });
    expect(within(infoTabs).getByRole('link', { name: 'Vitals' })).toHaveAttribute('aria-current', 'page');
    expect(within(infoTabs).getByRole('link', { name: 'Items' })).toBeVisible();
    expect(within(infoTabs).getByRole('link', { name: 'Equipment' })).toBeVisible();
    expect(within(infoTabs).getByRole('link', { name: 'Stats' })).toBeVisible();
    expect(within(infoTabs).getByRole('link', { name: 'Field notes' })).toBeVisible();
    expect(within(infoTabs).getByRole('link', { name: 'Codex' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Info' })).toHaveAttribute('aria-current', 'page');
    await screen.findByRole('heading', { name: 'Vitals' });
    expect(screen.getByRole('heading', { name: 'Rowan' })).toBeVisible();
    expect(screen.getByLabelText('Character health')).toHaveAttribute('aria-valuenow', '5');
    expect(screen.getByText('5/6')).toBeVisible();
    fireEvent.click(within(infoTabs).getByRole('link', { name: 'Items' }));
    await screen.findByRole('heading', { name: 'Items' });
    expect(screen.getByText('None')).toBeVisible();
    fireEvent.click(within(infoTabs).getByRole('link', { name: 'Equipment' }));
    await screen.findByRole('heading', { name: 'Equipment' });
    expect(screen.getByText('Available gear')).toBeVisible();
    fireEvent.click(within(infoTabs).getByRole('link', { name: 'Stats' }));
    await screen.findByRole('heading', { name: 'Stats', level: 1 });
    expect(screen.getByText('Strength')).toBeVisible();
    expect(screen.getByText('Intelligence')).toBeVisible();
    expect(screen.getByText('Attack Power')).toBeVisible();
    expect(screen.getByText('Spell Power')).toBeVisible();
    expect(screen.getByText('Crit Chance')).toBeVisible();
    expect(screen.getByText('Stamina Regen')).toBeVisible();
    expect(screen.getByText('Glory')).toBeVisible();
    expect(screen.getByText('Medals')).toBeVisible();
    fireEvent.click(within(infoTabs).getByRole('link', { name: 'Field notes' }));
    await screen.findByRole('heading', { name: 'Field notes' });
    expect(screen.getByText('No current quests.')).toBeVisible();
    expect(screen.getByText('No completed quests yet.')).toBeVisible();
    expect(history).toHaveTextContent(
      'A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east. One loose stone bears a pale stripe.',
    );
    fireEvent.click(within(infoTabs).getByRole('link', { name: 'Codex' }));
    await screen.findByRole('heading', { name: /A world, carefully remembered/ });
    expect(screen.getByText('Orraveth is separate from the active MUDD world.')).toBeVisible();
    expect(document.querySelector('.focused-topbar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('region', { name: 'Menu' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Characters/ }));
    expect(onLeaveWorld).toHaveBeenCalledOnce();
  });

  it('shows a fallback message when leaving a world rejects without an Error', async () => {
    const onLeaveWorld = vi.fn().mockRejectedValue('untyped leave failure');
    render(<WorldClient onLeaveWorld={onLeaveWorld} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByRole('button', { name: /Characters/ }));

    expect(await screen.findByText('Could not leave the world.')).toBeVisible();
    expect(onLeaveWorld).toHaveBeenCalledOnce();
  });

  it('preserves terminal scroll position for live updates and offers a scroll-to-latest control', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([path, init]) => {
        if (path !== '/api/queries') return false;
        return JSON.parse(String(init?.body ?? '{}')).type === 'party.info';
      })).toBe(true);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const history = screen.getByRole('region', { name: 'Terminal output' });
    let scrollTop = 60;
    Object.defineProperties(history, {
      scrollHeight: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 200 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => { scrollTop = Math.max(0, Math.min(value, 400)); },
      },
    });
    fireEvent.scroll(history);
    expect(screen.getByRole('button', { name: 'Scroll to latest' })).toBeVisible();

    const original = apiFetch.getMockImplementation()!;
    let partyActivityDelivered = false;
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/queries' && init?.body) {
        const query = JSON.parse(String(init.body)) as { type?: string };
        if (query.type === 'party.info') {
          const response = await original(path, init);
          const body = await response.json() as { value?: { activity?: unknown[] } };
          if (partyActivityDelivered && body.value) body.value.activity = [];
          else if ((body.value?.activity?.length ?? 0) > 0) partyActivityDelivered = true;
          return json(body);
        }
      }
      return original(path, init);
    });

    partyRevision = 1;
    partyActivity = [{
      revision: 1,
      groupId: 'party-terminal-scroll-test',
      type: 'joined',
      playerId: 'other-player',
      displayName: 'Aster',
    }, {
      revision: 1,
      groupId: 'party-terminal-scroll-test',
      type: 'left',
      playerId: 'leaving-player',
      displayName: 'Bryn',
    }, {
      revision: 1,
      groupId: 'party-terminal-scroll-test',
      type: 'closed',
      playerId: 'closing-player',
      displayName: 'Cora',
    }, {
      revision: 1,
      groupId: 'party-terminal-scroll-test',
      type: 'created',
      playerId: 'creating-player',
      displayName: 'Dara',
    }, {
      revision: 1,
      groupId: 'party-terminal-scroll-test',
      type: 'joined',
      playerId: 'account-1',
      displayName: 'Rowan',
    }];
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(await screen.findByText('Aster joined the party.')).toBeVisible();
    expect(screen.getByText('Bryn left the party.')).toBeVisible();
    expect(screen.getByText('Cora closed the party.')).toBeVisible();
    expect(screen.getByText('Dara formed a party.')).toBeVisible();
    expect(screen.queryByText('Rowan joined the party.')).not.toBeInTheDocument();
    expect(scrollTop).toBe(60);
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to latest' }));
    expect(scrollTop).toBe(400);
  });

  it('ignores a late world catalog response after the client unmounts', async () => {
    const original = apiFetch.getMockImplementation()!;
    let releaseWorlds: (() => void) | undefined;
    apiFetch.mockImplementation(async (path, init) => {
      const response = await original(path, init);
      if (path === '/api/worlds') {
        return new Promise<Response>((resolve) => {
          releaseWorlds = () => resolve(response);
        });
      }
      return response;
    });
    const view = render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await waitFor(() => expect(releaseWorlds).toBeTypeOf('function'));
    view.unmount();
    await act(async () => releaseWorlds?.());
  });

  it('does not poll the world snapshot while the tab is hidden', async () => {
    const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    const timers = vi.spyOn(window, 'setInterval');
    const view = render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const refreshSnapshot = timers.mock.calls.find(([, delay]) => delay === 15_000)?.[0];
    expect(refreshSnapshot).toBeTypeOf('function');
    const initialGameRequests = apiFetch.mock.calls.filter(([path]) => path === '/api/game').length;

    act(() => { (refreshSnapshot as () => void)(); });

    expect(apiFetch.mock.calls.filter(([path]) => path === '/api/game')).toHaveLength(initialGameRequests);
    view.unmount();
    timers.mockRestore();
    if (visibilityDescriptor) {
      Object.defineProperty(document, 'visibilityState', visibilityDescriptor);
    } else {
      Reflect.deleteProperty(document, 'visibilityState');
    }
  });

  it('closes the bottom navigation menu on Escape and restores focus to its trigger', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const menuTrigger = screen.getByRole('button', { name: 'Open menu' });

    fireEvent.click(menuTrigger);
    expect(screen.getByRole('region', { name: 'Menu' })).toBeVisible();
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.getByRole('region', { name: 'Menu' })).toBeVisible();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('region', { name: 'Menu' })).not.toBeInTheDocument();
    expect(menuTrigger).toHaveFocus();
  });

  it('closes the bottom navigation menu when the player taps outside it', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('region', { name: 'Menu' })).toBeVisible();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole('region', { name: 'Menu' })).not.toBeInTheDocument();
  });

  it('keeps the mobile terminal full screen above the bottom nav without header controls', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    const mobileMediaQuery = {
      matches: false,
      media: '(min-width: 700px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    } as unknown as MediaQueryList;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => mobileMediaQuery),
    });
    const view = render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    try {
      const roomHeading = await screen.findByRole('heading', { name: 'Mossgate Clearing' });
      const commandSection = document.querySelector('.focused-command');
      const typeButton = document.querySelector<HTMLButtonElement>('.focused-type-tab');

      expect(document.querySelector('.focused-content--play')).not.toBeNull();
      expect(screen.getByRole('navigation', { name: 'Game screens' })).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Collapse terminal' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Open terminal full screen' })).not.toBeInTheDocument();
      expect(commandSection).toHaveClass('focused-command--mobile-hidden');
      expect(typeButton).not.toBeNull();

      fireEvent.click(typeButton!);
      expect(commandSection).toHaveClass('focused-command--mobile-open');
      const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });
      expect(commandInput).toHaveFocus();

      fireEvent.click(typeButton!);
      expect(commandSection).toHaveClass('focused-command--mobile-hidden');
      expect(commandInput).not.toHaveFocus();

      fireTouchSwipe(roomHeading, { x: 150, y: 40 }, { x: 152, y: 150 });
      expect(screen.queryByRole('dialog', { name: 'Terminal' })).not.toBeInTheDocument();
    } finally {
      view.unmount();
      if (originalDescriptor) Object.defineProperty(window, 'matchMedia', originalDescriptor);
      else Reflect.deleteProperty(window, 'matchMedia');
    }
  });

  it('refreshes Info vitals from server projections without adding recovery terminal messages', async () => {
    characterHealth = { current: 5, maximum: 6 };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    await openInfoSection('Vitals');
    expect(screen.getByLabelText('Character health')).toHaveAttribute('aria-valuenow', '5');

    characterHealth = { current: 4, maximum: 6 };
    fireEvent(document, new Event('visibilitychange'));

    await screen.findByText('4/6');
    expect(screen.getByLabelText('Character health')).toHaveAttribute('aria-valuenow', '4');
    expect(screen.queryByText(/You recover/i)).not.toBeInTheDocument();
  });

  it('keeps an invalid daily reset date readable in Field notes', async () => {
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation(async (path, init) => {
      const response = await original(path, init);
      if (path !== '/api/game') return response;
      const game = await response.json() as {
        character: Record<string, unknown>;
      } & Record<string, unknown>;
      return json({
        ...game,
        character: {
          ...game.character,
          dailyJobs: [{
            boardId: 'reedbank-board',
            cycle: '2026-99-99',
            jobId: 'river-mint-delivery',
            title: 'Bring river mint',
            status: 'active',
            details: {
              id: 'river-mint-delivery',
              poster: 'Sella',
              title: 'Bring river mint',
              supplyTypeId: 'river-mint',
              quantity: 1,
              gold: 15,
              experience: 9,
            },
          }],
        },
      });
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    await openInfoSection('Field notes');

    expect(screen.getByText('2026-99-99 · resets 2026-99-99')).toBeVisible();
  });

  it('shows active and completed quest objectives on Field notes', async () => {
    questJournal = [
      {
        questId: 'mara-wayfinding',
        title: 'The Waystone Path',
        summary: 'Read the marker, visit the Old Bell Tower, and report back to Mara.',
        status: 'active',
        objectives: [
          { id: 'read-marker', label: 'Read the weathered marker', completed: true },
          { id: 'visit-bell-tower', label: 'Visit the Old Bell Tower', completed: false },
        ],
      },
      {
        questId: 'completed-sample',
        title: 'A Completed Errand',
        summary: 'Return a message.',
        status: 'completed',
        objectives: [{ id: 'deliver-message', label: 'Deliver the message', completed: true }],
      },
    ];
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    await openInfoSection('Field notes');

    expect(await screen.findByRole('heading', { name: 'Quest journal' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Current quests' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Completed quests' })).toBeVisible();
    expect(screen.getByText('The Waystone Path')).toBeVisible();
    expect(screen.getByText('Visit the Old Bell Tower')).toBeVisible();
    expect(screen.getByText('Completed')).toBeVisible();
    expect(screen.getByText('A Completed Errand')).toBeVisible();

    const currentQuestsToggle = screen.getByRole('button', { name: 'Current quests' });
    const completedQuestsToggle = screen.getByRole('button', { name: 'Completed quests' });
    expect(currentQuestsToggle).toHaveAttribute('aria-expanded', 'true');
    expect(completedQuestsToggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(currentQuestsToggle);
    expect(currentQuestsToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Visit the Old Bell Tower')).not.toBeVisible();
    expect(screen.getByText('A Completed Errand')).toBeVisible();

    fireEvent.click(completedQuestsToggle);
    expect(completedQuestsToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('A Completed Errand')).not.toBeVisible();
    expect(currentQuestsToggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(currentQuestsToggle);
    expect(screen.getByText('Visit the Old Bell Tower')).toBeVisible();
    expect(screen.getByText('A Completed Errand')).not.toBeVisible();

    fireEvent.click(completedQuestsToggle);
    const currentQuestToggle = screen.getByRole('button', { name: /The Waystone Path/ });
    const completedQuestToggle = screen.getByRole('button', { name: /A Completed Errand/ });
    expect(currentQuestToggle).toHaveAttribute('aria-expanded', 'true');
    expect(completedQuestToggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(currentQuestToggle);
    expect(currentQuestToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Visit the Old Bell Tower')).not.toBeVisible();
    expect(screen.getByText('Deliver the message')).toBeVisible();

    fireEvent.click(completedQuestToggle);
    expect(completedQuestToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Deliver the message')).not.toBeVisible();
    expect(currentQuestToggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(currentQuestToggle);
    expect(screen.getByText('Visit the Old Bell Tower')).toBeVisible();
    expect(screen.getByText('Deliver the message')).not.toBeVisible();
  });

  it('collapses the terminal to its room header and restores the command history', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const terminal = screen.getByRole('heading', { name: 'Mossgate Clearing' }).closest('.focused-terminal');
    const history = screen.getByRole('region', { name: 'Terminal output' });
    expect(terminal).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse terminal' }));
    expect(terminal).toHaveClass('focused-terminal--collapsed');
    const expandTerminal = screen.getByRole('button', { name: 'Expand terminal' });
    expect(expandTerminal).toHaveClass('mudd-disclosure-button');
    expect(expandTerminal).toHaveAttribute('aria-expanded', 'false');
    expect(expandTerminal).toHaveAttribute('aria-controls', 'focused-terminal-body');

    fireEvent.click(expandTerminal);
    expect(terminal).not.toHaveClass('focused-terminal--collapsed');
    expect(screen.getByRole('button', { name: 'Collapse terminal' })).toHaveAttribute('aria-expanded', 'true');
    expect(history).toHaveTextContent('> look');
    expect(screen.getByRole('textbox', { name: 'Enter a command' })).toBeInTheDocument();
  });

  it('opens the terminal full screen with a downward header swipe and closes with an upward swipe or Escape', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    const roomHeading = await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    fireTouchSwipe(roomHeading, { x: 150, y: 40 }, { x: 152, y: 150 });

    const dialog = await screen.findByRole('dialog', { name: 'Terminal' });
    expect(dialog).toHaveClass('focused-terminal--fullscreen');
    expect(screen.getByRole('button', { name: 'Close full-screen terminal' })).toBeVisible();
    fireEvent.touchCancel(dialog);

    const fullscreenHeading = dialog.querySelector('.focused-terminal-location');
    expect(fullscreenHeading).not.toBeNull();
    fireTouchSwipe(fullscreenHeading!, { x: 150, y: 160 }, { x: 152, y: 45 });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Terminal' })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Open terminal full screen' }));
    await screen.findByRole('dialog', { name: 'Terminal' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Terminal' })).not.toBeInTheDocument());
  });

  it('records first-feedback timing for a traced travel action', async () => {
    window.history.replaceState(null, '', '/?muddTrace=1');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(performance.now());
      return 1;
    });
    try {
      render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
      await screen.findByRole('heading', { name: 'Mossgate Clearing' });
      quickGo('north');
      await screen.findByRole('heading', { name: 'Glasswater Bridge' });

      expect(info).toHaveBeenCalledWith(
        '[mudd_perf_trace_feedback]',
        expect.stringContaining('"action":"character.move"'),
      );
      expect(info).toHaveBeenCalledWith(
        '[mudd_perf_trace_action]',
        expect.stringContaining('"outcome":"success"'),
      );
    } finally {
      animationFrame.mockRestore();
      info.mockRestore();
      window.history.replaceState(null, '', '/');
    }
  });

  it('tracks the current room and rooms already visited on the map', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    const map = await screen.findByRole('region', { name: 'World map' });
    expect(map.querySelector('desc')).toHaveTextContent('North is up.');
    expect(within(map).getByRole('button', { name: 'Focus Mossgate Clearing on map, current location' })).toHaveAttribute('aria-current', 'location');
    expect(map.querySelector('[aria-label="Focus Glasswater Bridge on map"]')).not.toBeInTheDocument();

    quickGo('north');
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    await waitFor(() => expect(map).toHaveTextContent('Glasswater Bridge'));
    expect(within(map).getByRole('button', { name: 'Focus Glasswater Bridge on map, current location' })).toHaveAttribute('aria-current', 'location');
    expect(map.querySelectorAll('.focused-world-map__path')).toHaveLength(1);
  });

  it('keeps same-direction exits selectable and rejects an ambiguous direction command', async () => {
    room = 'belfry';
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('region', { name: 'Terminal output' });

    const navigation = screen.getByRole('navigation', { name: 'Quick navigation' });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Down, choose a destination' }));
    const destinationChoices = screen.getByRole('group', { name: 'Choose a destination' });
    expect(within(destinationChoices).getByRole('button', { name: 'Down to the tower floor' })).toBeVisible();
    expect(within(destinationChoices).getByRole('button', { name: 'Down into the Underhollow' })).toBeVisible();
    fireEvent.click(within(destinationChoices).getByRole('button', { name: 'Return to quick commands' }));

    fireEvent.change(screen.getByPlaceholderText('Type a command'), { target: { value: 'go down' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/More than one exit leads down/);
    expect(apiFetch.mock.calls.filter(([path]) => path === '/api/commands')).toHaveLength(0);

    fireEvent.click(within(navigation).getByRole('button', { name: 'Down, choose a destination' }));
    const reopenedChoices = screen.getByRole('group', { name: 'Choose a destination' });
    fireEvent.click(within(reopenedChoices).getByRole('button', { name: 'Down to the tower floor' }));
    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([path, init]) => {
        if (path !== '/api/commands') return false;
        const command = JSON.parse(String(init?.body ?? '{}'));
        return command.type === 'character.move' && typeof command.payload?.exitId === 'string';
      })).toBe(true);
    });
  });

  it('does not announce a stationary NPC as leaving during travel reconciliation', async () => {
    bridgeWatcherMobile = false;
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    quickGo('north');

    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Enter a command' })).toBeEnabled(),
    );
    expect(screen.queryByText('Bridge Watcher leaves the room.')).not.toBeInTheDocument();
  });

  it('uses arrow keys for cardinal movement but leaves command fields alone', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Enter a command' }), { key: 'ArrowUp' });
    expect(screen.getByRole('heading', { name: 'Mossgate Clearing' })).toBeVisible();

    await act(async () => { fireEvent.keyDown(document, { key: 'ArrowUp' }); });
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    expect(history).not.toHaveTextContent('You travel north.');

    await act(async () => { fireEvent.keyDown(document, { key: 'ArrowDown' }); });
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    expect(history).not.toHaveTextContent('You travel south.');
  });

  it('maps Shift+Down to the vertical down direction and preserves ambiguous exit choices', async () => {
    room = 'belfry';
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    const history = await screen.findByRole('region', { name: 'Terminal output' });

    fireEvent.keyDown(document, { key: 'ArrowUp', shiftKey: true });
    await waitFor(() => expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' && init?.method === 'POST' &&
      JSON.parse(String(init.body)).type === 'character.move'
    )).toBe(true));
    expect(history).not.toHaveTextContent('The move was accepted. Waiting for the current room to update.');
    const upCommand = JSON.parse(
      apiFetch.mock.calls.find(([path]) => path === '/api/commands')?.[1].body as string,
    );
    expect(upCommand.payload.exitId).toBe('belfry-to-roof');

    fireEvent.keyDown(document, { key: 'ArrowDown', shiftKey: true });
    const choices = await screen.findByRole('group', { name: 'Choose a destination' });
    expect(within(choices).getByRole('button', { name: 'Down to the tower floor' })).toBeVisible();
    expect(within(choices).getByRole('button', { name: 'Down into the Underhollow' })).toBeVisible();
    expect(apiFetch.mock.calls.filter(([path]) => path === '/api/commands')).toHaveLength(1);
  });

  it('shows Willowrest Inn and its Reedbank path only after traveling there', async () => {
    room = 'market';
    visitedLocationIds = ['mossgate-clearing', 'glasswater-bridge', 'reedbank-stalls'];
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('heading', { name: 'Reedbank Stalls' });
    const map = screen.getByRole('region', { name: 'World map' });
    expect(map).not.toHaveTextContent('Willowrest Inn');
    expect(map.querySelectorAll('.focused-world-map__path')).toHaveLength(2);

    const locationMarker = (name: string) =>
      [...map.querySelectorAll<SVGGElement>('.focused-world-map__location')]
        .find((location) => location.getAttribute('aria-label')?.startsWith(`Focus ${name} on map`));
    const reedbankMarkerBeforeArrival = locationMarker('Reedbank Stalls');
    expect(reedbankMarkerBeforeArrival).toBeDefined();
    expect(locationMarker('Willowrest Inn')).toBeUndefined();

    fireEvent.keyDown(document, { key: 'ArrowRight' });

    await screen.findByRole('heading', { name: 'Willowrest Inn' });
    await waitFor(() => expect(map).toHaveTextContent('Willowrest Inn'));
    const reedbankMarker = locationMarker('Reedbank Stalls');
    const willowrestMarker = locationMarker('Willowrest Inn');
    expect(reedbankMarker).toBeDefined();
    expect(willowrestMarker).toBeDefined();
    expect(map.querySelectorAll('.focused-world-map__path')).toHaveLength(3);

    expect(map.querySelectorAll('.focused-world-map__path')).toHaveLength(3);
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    await screen.findByRole('heading', { name: 'Reedbank Stalls' });
  });

  it('collapses the map and can still open it full screen', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    const map = await screen.findByRole('region', { name: 'World map' });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse map' }));
    expect(map).toHaveClass('focused-world-map--collapsed');
    const expandMap = screen.getByRole('button', { name: 'Expand map' });
    expect(expandMap).toHaveClass('mudd-disclosure-button');
    expect(expandMap).toHaveAttribute('aria-expanded', 'false');
    expect(expandMap).toHaveAttribute('aria-controls', 'world-map-content');

    fireEvent.click(screen.getByRole('button', { name: 'Open map full screen' }));
    const dialog = await screen.findByRole('dialog', { name: 'World map' });
    expect(dialog).not.toHaveClass('focused-world-map--collapsed');
    expect(dialog.querySelector('.focused-world-map__svg')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Close full-screen map' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'World map' })).not.toBeInTheDocument());
    const collapsedMap = screen.getByRole('region', { name: 'World map' });
    expect(collapsedMap).toHaveClass('focused-world-map--collapsed');
    fireEvent.click(screen.getByRole('button', { name: 'Expand map' }));
    expect(screen.getByRole('region', { name: 'World map' })).not.toHaveClass('focused-world-map--collapsed');
    expect(screen.getByRole('button', { name: 'Collapse map' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens the world map full screen with a left swipe and closes with a right swipe or Escape', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('region', { name: 'World map' });

    fireTouchSwipe(screen.getByRole('region', { name: 'Terminal output' }), { x: 220, y: 100 }, { x: 70, y: 105 });
    const dialog = await screen.findByRole('dialog', { name: 'World map' });
    expect(dialog).toHaveClass('focused-world-map--fullscreen');
    expect(screen.getByRole('button', { name: 'Close full-screen map' })).toBeVisible();

    fireTouchSwipe(dialog, { x: 40, y: 100 }, { x: 160, y: 105 });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'World map' })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Open map full screen' }));
    await screen.findByRole('dialog', { name: 'World map' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'World map' })).not.toBeInTheDocument());
  });

  it('keeps consecutive NPC departure announcements while pruning prior entries', async () => {
    room = 'bridge';
    visitedLocationIds = ['mossgate-clearing', 'glasswater-bridge'];
    const original = apiFetch.getMockImplementation()!;
    const events: TestRoomChatMessage[] = [
      {
        id: 1,
        roomId: 'glasswater-bridge',
        speakerType: 'npc',
        speakerId: 'bridge-watcher',
        speakerName: 'Bridge Watcher',
        text: 'The watcher leaves for the south bank.',
        createdAt: '2026-10-26T12:00:00.000Z',
      },
      {
        id: 2,
        roomId: 'glasswater-bridge',
        speakerType: 'npc',
        speakerId: 'mill-worker',
        speakerName: 'Mill Worker',
        text: 'The worker departs toward the mill.',
        createdAt: '2026-10-26T12:00:01.000Z',
      },
    ];
    apiFetch.mockImplementation((path, init) => {
      if (path.startsWith('/api/chat') && (!init?.method || init.method === 'GET')) {
        const url = new URL(path, 'http://mudd.test');
        if (url.searchParams.get('roomId') === 'glasswater-bridge') {
          return Promise.resolve(json({
            roomId: 'glasswater-bridge',
            messages: [],
            terminalEvents: events,
            cursor: 2,
          }));
        }
      }
      return original(path, init);
    });
    const view = render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    await waitFor(() => {
      expect(history).toHaveTextContent('Bridge Watcher: The watcher leaves for the south bank.');
      expect(history).toHaveTextContent('Mill Worker: The worker departs toward the mill.');
    });
    view.unmount();
  });

  it('replaces available paths with shared room chat for player and NPC messages', async () => {
    roomChatMessages = [
      {
        id: 4,
        roomId: 'mossgate-clearing',
        speakerType: 'npc',
        speakerId: 'old-keeper',
        speakerName: 'Old Keeper',
        text: 'The east bell rings once.',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 5,
        roomId: 'mossgate-clearing',
        speakerType: 'player',
        speakerId: 'other-character',
        speakerName: 'Mira',
        text: 'I heard it too.',
        createdAt: '2026-01-01T00:00:01.000Z',
      },
    ];
    nextRoomChatMessageId = 6;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    const chat = await screen.findByRole('region', { name: 'Room chat' });

    expect(await screen.findByText('The east bell rings once.')).toBeVisible();
    expect(chat).toHaveTextContent('Old Keeper');
    expect(chat).toHaveTextContent('Mira');
    expect(screen.queryByText('Available paths')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Available exits' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Message the room' }), {
      target: { value: 'The way is clear.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send room message' }));
    await waitFor(() => expect(screen.getByText('The way is clear.')).toBeVisible());
    const sentMessage = apiFetch.mock.calls.find(([path, init]) =>
      path === '/api/chat' && init?.method === 'POST'
    );
    expect(JSON.parse(String(sentMessage?.[1]?.body ?? '{}'))).toEqual({
      roomId: 'mossgate-clearing',
      text: 'The way is clear.',
      clientMessageId: expect.any(String),
    });
  });

  it('opens full-screen room chat from a rightward swipe on the play area', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const playArea = screen.getByRole('region', { name: 'Play screen' });
    fireEvent.touchStart(playArea, { touches: [{ clientX: 220, clientY: 200 }] });
    fireEvent.touchEnd(playArea, { changedTouches: [{ clientX: 330, clientY: 202 }] });

    expect(await screen.findByRole('dialog')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Close full-screen chat' })).toBeVisible();
  });

  it('does not treat a swipe that starts on a button as a fullscreen gesture', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const control = screen.getByRole('button', { name: 'Open terminal full screen' });
    fireEvent.touchStart(control, { touches: [{ clientX: 220, clientY: 200 }] });
    fireEvent.touchEnd(control, { changedTouches: [{ clientX: 330, clientY: 202 }] });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('embeds room chat below quick actions in the mobile terminal', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    const mobileMediaQuery = {
      matches: false,
      media: '(min-width: 700px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    } as unknown as MediaQueryList;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => mobileMediaQuery),
    });
    const view = render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    try {
      await screen.findByRole('heading', { name: 'Mossgate Clearing' });
      const chat = await screen.findByRole('region', { name: 'Room chat' });
      const quickActions = document.querySelector('.focused-quick-commands');

      expect(chat).toHaveClass('focused-room-chat--embedded');
      expect(chat).toHaveClass('focused-room-chat--collapsed');
      expect(chat.closest('.focused-terminal')).not.toBeNull();
      expect(chat.closest('.focused-terminal-body')).not.toBeNull();
      expect(quickActions).not.toBeNull();
      expect(Boolean(quickActions!.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
      expect(screen.getByRole('button', { name: 'Expand room chat' })).toBeVisible();
      expect(screen.getByRole('textbox', { name: 'Message the room' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Expand room chat' }));
      expect(chat).not.toHaveClass('focused-room-chat--collapsed');
      expect(screen.getByRole('textbox', { name: 'Message the room' })).toBeVisible();
    } finally {
      view.unmount();
      if (originalDescriptor) Object.defineProperty(window, 'matchMedia', originalDescriptor);
      else Reflect.deleteProperty(window, 'matchMedia');
    }
  });

  it('shows an authored NPC response immediately after a matching public room message', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const chat = await screen.findByRole('region', { name: 'Room chat' });

    fireEvent.change(screen.getByRole('textbox', { name: 'Message the room' }), {
      target: { value: 'The marker points east.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send room message' }));

    expect(await screen.findByText('The marker still points east.', {}, { timeout: 5_000 })).toBeVisible();
    expect(chat).toHaveTextContent('Rowan');
    expect(chat).toHaveTextContent('Mara');
  });

  it('collapses embedded room chat while keeping it openable full screen', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    const panel = await screen.findByRole('region', { name: 'Room chat' });
    const messages = panel.querySelector('.focused-room-chat__messages');
    const composer = panel.querySelector('.focused-room-chat__composer');
    expect(messages).not.toBeNull();
    expect(composer).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Collapse room chat' }).querySelector('svg'))
      .toHaveClass('lucide-chevron-down');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse room chat' }));
    expect(panel).toHaveClass('focused-room-chat--collapsed');
    const expandChat = screen.getByRole('button', { name: 'Expand room chat' });
    expect(expandChat).toHaveClass('mudd-disclosure-button');
    expect(expandChat).toHaveAttribute('aria-expanded', 'false');
    expect(expandChat).toHaveAttribute('aria-controls', 'room-chat-content');
    expect(expandChat.querySelector('svg')).toHaveClass('lucide-chevron-up');

    fireEvent.click(screen.getByRole('button', { name: 'Open chat full screen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Room chat' });
    expect(dialog).not.toHaveClass('focused-room-chat--collapsed');
    expect(dialog.querySelector('.focused-room-chat__messages')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Close full-screen chat' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Room chat' })).not.toBeInTheDocument());
    const collapsedPanel = screen.getByRole('region', { name: 'Room chat' });
    expect(collapsedPanel).toHaveClass('focused-room-chat--collapsed');
    expect(screen.getByRole('button', { name: 'Expand room chat' })).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Expand room chat' }));
    const expandedPanel = screen.getByRole('region', { name: 'Room chat' });
    expect(expandedPanel).not.toHaveClass('focused-room-chat--collapsed');
    expect(expandedPanel.querySelector('.focused-room-chat__messages')).not.toBeNull();
    expect(expandedPanel.querySelector('.focused-room-chat__composer')).not.toBeNull();
    const collapseChat = screen.getByRole('button', { name: 'Collapse room chat' });
    expect(collapseChat).toHaveAttribute('aria-expanded', 'true');
    expect(collapseChat.querySelector('svg')).toHaveClass('lucide-chevron-down');
  });

  it('opens room chat full screen with a right swipe and closes with a left swipe or Escape', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('region', { name: 'Room chat' });

    const terminal = screen.getByRole('region', { name: 'Terminal output' });
    fireTouchSwipe(terminal, { x: 20, y: 100 }, { x: 150, y: 105 });
    const dialog = await screen.findByRole('dialog', { name: 'Room chat' });
    expect(dialog).toHaveClass('focused-room-chat--fullscreen');
    expect(screen.getByRole('button', { name: 'Close full-screen chat' })).toBeVisible();

    fireTouchSwipe(screen.getByRole('log', { name: 'Room chat messages' }), { x: 220, y: 100 }, { x: 70, y: 105 });
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Room chat' })).toHaveClass('focused-room-chat--closing'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Room chat' })).not.toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'Room chat' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Open chat full screen' }));
    await screen.findByRole('dialog', { name: 'Room chat' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Room chat' })).not.toBeInTheDocument());
  });

  it('uses real character-bound commands and retains the action history on Field notes', async () => {
    const { container } = render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });
    expect(history).toHaveClass('focused-terminal-history');
    expect(screen.getByRole('region', { name: 'Text command' })).toBeInTheDocument();
    expect(screen.queryByText('Available paths')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Room chat' })).toBeVisible();
    const quickNavigation = container.querySelector<HTMLElement>('[aria-label="Quick navigation"]')!;
    expect(within(quickNavigation).getAllByRole('button')).toHaveLength(6);
    expect(within(quickNavigation).getByRole('button', { name: 'North' })).toBeEnabled();
    expect(within(quickNavigation).getByRole('button', { name: 'South' })).toBeDisabled();
    expect(within(quickNavigation).getByRole('button', { name: 'Up' })).toBeDisabled();
    expect(quickNavigation.nextElementSibling).toHaveClass('focused-quick-commands');
    fireEvent.click(within(quickNavigation).getByRole('button', { name: 'North' }));
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    expect(history).not.toHaveTextContent('You travel north.');
    expect(history).toHaveTextContent('A stone bridge crosses clear water.');
    const command = JSON.parse(apiFetch.mock.calls.find(([path]) => path === '/api/commands')?.[1].body as string);
    expect(command).toMatchObject({
      type: 'character.move',
      characterId,
      expectedVersion: 1,
      payload: { exitId: 'clearing-to-bridge' },
    });

    await openInfoSection('Field notes');
    expect(screen.queryByText('You travel north.')).not.toBeInTheDocument();
  });

  it('keeps refresh errors in the terminal without a duplicate error banner', async () => {
    const { container } = render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const originalFetch = apiFetch.getMockImplementation()!;
    const message = 'Choose a character before entering the world.';
    apiFetch.mockImplementation((path: string, init?: RequestInit) =>
      path === '/api/game'
        ? Promise.resolve(json({ message }, 409))
        : originalFetch(path, init),
    );

    const input = screen.getByRole('textbox', { name: 'Enter a command' });
    fireEvent.change(input, { target: { value: 'take all' } });
    fireEvent.submit(input.closest('form')!);

    const terminal = screen.getByRole('region', { name: 'Terminal output' });
    await waitFor(() => expect(terminal).toHaveTextContent(message));
    await waitFor(() => expect(input).toBeEnabled());
    expect(container.querySelector('.focused-feedback--error')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('records typed commands and their results in the terminal history', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    expect(screen.queryByText('Command', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Enter a command' })).toBeVisible();
    const history = screen.getByRole('region', { name: 'Terminal output' });
    const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });
    fireEvent.change(commandInput, { target: { value: 'look' } });
    fireEvent.submit(commandInput.closest('form')!);

    await waitFor(() => {
      expect(screen.getAllByText('> look')).toHaveLength(2);
      expect(within(history).getAllByText('Mossgate Clearing')).toHaveLength(2);
      expect(
        history.textContent?.match(/A circle of pale stones breaks through the moss\./g),
      ).toHaveLength(2);
    });
    expect(apiFetch.mock.calls.some(([path]) => path === '/api/queries')).toBe(true);
    expect(history).toHaveTextContent('> look');
    expect(within(screen.getByRole('navigation', { name: 'Quick navigation' }))
      .getByRole('button', { name: 'North' })).toBeEnabled();
  });

  it('shows the command list and command-specific help in the terminal', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });
    const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });

    fireEvent.change(commandInput, { target: { value: 'help' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('Commands');
    expect(history).toHaveTextContent('> help');
    expect(history).toHaveTextContent('get <item> | get <item> <container> — Take an item from the room or a container; alias of take.');
    expect(history).toHaveTextContent('take <item> | take <item> <container> | take all — Pick up items from the room or a container.');
    expect(history).toHaveTextContent('loot <corpse> — Take all remaining items and currency from a corpse here.');
    expect(history).toHaveTextContent('put <item> <container> — Store a carried item in a container here.');
    expect(history).toHaveTextContent('talk <npc> [about <topic>] — Speak privately with someone in the current room.');
    expect(history).toHaveTextContent('use <item> on <target> | use <healing item> | use <fishing rod> — Use a room item, restore health, or fish at a marked spot.');
    expect(history).toHaveTextContent('Quick actions include available movement, item, loot, equipment, merchant, dialogue, and combat actions.');
    expect(history).toHaveTextContent('equip <item> — Equip carried gear in its equipment slot.');

    fireEvent.change(commandInput, { target: { value: 'help LOOK' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('Usage: look | look [at] <object>');
    expect(history).toHaveTextContent('Look describes the current room. Add an object to inspect it here or in your inventory.');

    fireEvent.change(commandInput, { target: { value: 'help loot' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('Usage: loot <corpse>');
    expect(history).toHaveTextContent('Take all remaining items and currency from a corpse in this room.');

    fireEvent.change(commandInput, { target: { value: 'help unknown' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('No help is available for "unknown".');
    expect(history).toHaveTextContent('Try "help" for the command list.');
    expect(apiFetch.mock.calls.some(([path]) => path === '/api/commands')).toBe(false);
  });

  it('ignores a command submission containing only whitespace', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });
    const initialHistory = history.textContent;
    const input = screen.getByRole('textbox', { name: 'Enter a command' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form')!);

    expect(history.textContent).toBe(initialHistory);
    expect(apiFetch.mock.calls.some(([path]) => path === '/api/commands')).toBe(false);
  });

  it('asks which player to challenge when several room names match', async () => {
    roomOccupants = [
      { id: 'mira-character', displayName: 'Mira' },
      { id: 'milo-character', displayName: 'Milo' },
    ];
    heartbeatOccupants = roomOccupants;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('attack Mi');

    expect(await screen.findByText('Which player do you mean: Mira, Milo?')).toBeVisible();
  });

  it('reports invalid combat, purchase, travel, and unknown commands', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    submitWorldCommand('defend');
    await waitFor(() => expect(history).toHaveTextContent('There is no active encounter. Choose an available combatant to attack first.'));
    submitWorldCommand('buy lantern');
    await waitFor(() => expect(history).toHaveTextContent('Open a merchant’s catalog first with “shop <merchant>”.'));
    submitWorldCommand('go nowhere');
    await waitFor(() => expect(history).toHaveTextContent('No available exit matches “nowhere”.'));
    submitWorldCommand('go north');
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    submitWorldCommand('flibbertigibbet');
    await waitFor(() => expect(history).toHaveTextContent('Unknown command. Try "help" for the command list.'));
  });

  it('explains invalid talk, shop, buy, and use targets', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    submitWorldCommand('talk');
    await waitFor(() => expect(history).toHaveTextContent('Talk to whom? Try “talk Mara”.'));
    submitWorldCommand('talk Mara about');
    await waitFor(() => expect(history).toHaveTextContent('Talk about what? Try “talk Mara about the tower”.'));
    submitWorldCommand('talk Nobody');
    await waitFor(() => expect(history).toHaveTextContent('You do not see anyone called “Nobody” here.'));
    submitWorldCommand('shop');
    await waitFor(() => expect(history).toHaveTextContent('Browse whose goods? Try “shop Sella”.'));
    submitWorldCommand('shop Nobody');
    await waitFor(() => expect(history).toHaveTextContent('You do not see anyone called “Nobody” here.'));
    submitWorldCommand('buy');
    await waitFor(() => expect(history).toHaveTextContent('Buy what? Browse the shop, then try “buy lantern”.'));
    submitWorldCommand('buy lantern');
    await waitFor(() => expect(history).toHaveTextContent('Open a merchant’s catalog first with “shop <merchant>”.'));
    submitWorldCommand('use');
    await waitFor(() => expect(history).toHaveTextContent('Use a healing item, a fishing rod at a marked spot, or an axe on a named tree'));
    submitWorldCommand('use invisible item');
    await waitFor(() => expect(history).toHaveTextContent('Use a healing item, a fishing rod at a marked spot, or an axe on a named tree'));
  });

  it('reports when requested boards and campfires are not present', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    submitWorldCommand('read bulletin');
    await waitFor(() => expect(history).toHaveTextContent('There is no bulletin board here.'));
    submitWorldCommand('extinguish');
    await waitFor(() => expect(history).toHaveTextContent('There is no burning campfire called “campfire” here.'));
    submitWorldCommand('extinguish brazier');
    await waitFor(() => expect(history).toHaveTextContent('There is no burning campfire called “brazier” here.'));
  });

  it('asks which campfire to extinguish when multiple fires share the same name', async () => {
    campfireVisible = true;
    duplicateCampfireVisible = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('extinguish camp');

    expect(await screen.findByText('Which campfire do you mean: Campfire, Campfire?')).toBeVisible();
  });

  it('explains jobs and gathering commands when no local board or source is available', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    submitWorldCommand('jobs unknown extra');
    await waitFor(() => expect(history).toHaveTextContent('Usage: jobs [browse|accept <id>|deliver <id>].'));
    submitWorldCommand('jobs help');
    await waitFor(() => expect(history).toHaveTextContent(
      'Browse today’s local bulletin, accept a posting, or deliver its carried supplies.',
    ));
    submitWorldCommand('jobs accept missing-job');
    await waitFor(() => expect(history).toHaveTextContent('There is no daily bulletin available in this world.'));
    submitWorldCommand('gather');
    await waitFor(() => expect(history).toHaveTextContent('Choose a local source: gather <source-id or label>.'));
    submitWorldCommand('gather unknown');
    await waitFor(() => expect(history).toHaveTextContent('There is no local supply source matching “unknown”.'));
  });

  it('reports when a world has no local daily bulletin', async () => {
    room = 'bridge';
    dailyFeatureEnabled = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });

    submitWorldCommand('jobs browse');

    await screen.findByText('There is no daily bulletin available in this world.');
  });

  it('starts a supply gather from the local-source quick action', async () => {
    dailyFeatureEnabled = true;
    dailySourceAtBoard = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    clickQuickAction('Gather Spring water at Mossgate spring; 0 of 3 collected today');

    expect(await screen.findByText('Gathered supplies at Mossgate spring.')).toBeVisible();
    expect(dailyCommandPayloads).toContainEqual(expect.objectContaining({ type: 'supply.gather' }));
  });

  it('shows a safe fallback when supply gathering rejects without an Error object', async () => {
    dailyFeatureEnabled = true;
    dailySourceAtBoard = true;
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/commands' && init?.body) {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'supply.gather') throw 'untyped gather failure';
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    clickQuickAction('Gather Spring water at Mossgate spring; 0 of 3 collected today');

    expect(await screen.findByText('You could not gather that supply.')).toBeVisible();
    expect(screen.getByRole('button', {
      name: 'Gather Spring water at Mossgate spring; 0 of 3 collected today',
    })).toBeEnabled();
  });

  it('asks which local source to gather from when labels are ambiguous', async () => {
    dailyFeatureEnabled = true;
    dailySourceAtBoard = true;
    duplicateDailySourceAvailable = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('gather spring');

    expect(await screen.findByText('Which source do you mean: Mossgate spring, Mossgate spring well?')).toBeVisible();
  });

  it('reports bulletin lookup failures when accepting a daily posting', async () => {
    dailyFeatureEnabled = true;
    const original = apiFetch.getMockImplementation()!;
    let failure: unknown = new Error('Bulletin service unavailable');
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/queries' && init?.body) {
        const query = JSON.parse(String(init.body)) as { type?: string };
        if (query.type === 'daily.board') throw failure;
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });
    submitWorldCommand('jobs accept missing-posting');

    await waitFor(() => expect(history).toHaveTextContent('Bulletin service unavailable'));
    failure = 'unexpected rejection';
    submitWorldCommand('jobs accept missing-posting');
    await waitFor(() => expect(history).toHaveTextContent('The daily posting could not be completed.'));
  });

  it('rejects a bulletin lookup that completes after leaving its room', async () => {
    dailyFeatureEnabled = true;
    const original = apiFetch.getMockImplementation()!;
    let notifyLookupStarted!: () => void;
    let releaseLookup!: () => void;
    const lookupStarted = new Promise<void>((resolve) => {
      notifyLookupStarted = resolve;
    });
    const lookupGate = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/queries' && init?.body) {
        const query = JSON.parse(String(init.body)) as { type?: string };
        if (query.type === 'daily.board') {
          notifyLookupStarted();
          await lookupGate;
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('jobs accept river-mint-delivery');
    await lookupStarted;
    submitWorldCommand('go north');
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    releaseLookup();

    expect(await screen.findByText('The bulletin returned no postings.')).toBeVisible();
  });

  it('asks which item to drop when the command has no target', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('drop');

    expect(await screen.findByText('Drop what? Try “drop stone”.')).toBeVisible();
  });

  it('keeps a carried item when dropping it fails', async () => {
    includeSecondTakeable = true;
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body ?? '{}')) as { type?: string };
        if (command.type === 'character.drop') throw new Error('The feather slips out of your hands.');
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('take feather');
    await screen.findByText('You pick up the lost feather.');
    const history = screen.getByRole('region', { name: 'Terminal output' });
    await waitFor(() => expect(history.closest('.focused-terminal')).toHaveAttribute('aria-busy', 'false'));

    submitWorldCommand('drop feather');

    await waitFor(() => expect(history).toHaveTextContent('The feather slips out of your hands.'));
    expect(secondItemTaken).toBe(true);
  });

  it('asks which room item to take when multiple objects match', async () => {
    duplicateStoneVisible = true;
    duplicateReadableMarkerVisible = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('take stone');

    await screen.findByText('Which one do you mean: Loose stone, Stone shard?');
    submitWorldCommand('look stone');
    await screen.findByText('Which one do you mean: Loose stone, Stone shard?');
    submitWorldCommand('read mark');
    await screen.findByText('Which one do you mean: Weathered marker, Marker notice?');
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'character.take',
    )).toBe(false);
  });

  it('reports missing targets for read, loot, take, get, and put commands', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    submitWorldCommand('read');
    await waitFor(() => expect(history).toHaveTextContent('Read what?'));
    submitWorldCommand('read invisible book');
    await waitFor(() => expect(history).toHaveTextContent('There is nothing readable called “invisible book” here.'));
    submitWorldCommand('loot');
    await waitFor(() => expect(history).toHaveTextContent('Loot which corpse?'));
    submitWorldCommand('loot fallen scout corpse');
    await waitFor(() => expect(history).toHaveTextContent('There is no corpse called “fallen scout corpse” here.'));
    submitWorldCommand('take');
    await waitFor(() => expect(history).toHaveTextContent('Take what?'));
    submitWorldCommand('get invisible item');
    await waitFor(() => expect(history).toHaveTextContent('There is nothing here you can take called “invisible item”.'));
    submitWorldCommand('drop');
    await waitFor(() => expect(history).toHaveTextContent('Drop what?'));
    submitWorldCommand('drop invisible item');
    await waitFor(() => expect(history).toHaveTextContent('You are not carrying anything called “invisible item”.'));
    submitWorldCommand('put');
    await waitFor(() => expect(history).toHaveTextContent('Put what where?'));
    submitWorldCommand('put invisible item');
    await waitFor(() => expect(history).toHaveTextContent('Name an item you carry and a container here'));
  });

  it('explains when there is nothing left to take from the room', async () => {
    itemTaken = true;
    secondItemTaken = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('take all');

    expect(await screen.findByText('There is nothing here you can take.')).toBeVisible();
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'character.take',
    )).toBe(false);
  });

  it('rechecks the room when take-all targets disappear before the request', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    itemTaken = true;
    secondItemTaken = true;

    submitWorldCommand('take all');

    expect(await screen.findByText('There is nothing here you can take.')).toBeVisible();
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'character.take',
    )).toBe(false);
  });

  it('keeps completed take-all pickups when a later item request fails', async () => {
    includeSecondTakeable = true;
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as {
          type?: string;
          payload?: { itemId?: string };
        };
        if (command.type === 'character.take' && command.payload?.itemId === 'mossgate-lost-feather') {
          return Promise.resolve(json({ message: 'The feather can no longer be taken.' }, 409));
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    submitWorldCommand('take all');

    expect(await screen.findByText('The feather can no longer be taken.')).toBeVisible();
    expect(history).toHaveTextContent('You pick up the loose stone.');
    expect(apiFetch.mock.calls.filter(([path]) => path === '/api/game').length).toBeGreaterThanOrEqual(4);
  });

  it('uses a carried item on a room target from the terminal', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });

    fireEvent.change(commandInput, { target: { value: 'take loose stone' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('You pick up the loose stone.');

    fireEvent.change(commandInput, { target: { value: 'use the loose stone on nowhere' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('There is no object called “nowhere” in this room.');

    fireEvent.change(commandInput, { target: { value: 'use the loose stone on the marker' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('The mock interaction succeeds.');
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'character.use' &&
      JSON.parse(String(init?.body ?? '{}')).payload.itemId === 'mossgate-loose-stone' &&
      JSON.parse(String(init?.body ?? '{}')).payload.targetId === 'mossgate-marker'
    )).toBe(true);
  });

  it('keeps the carried item when the server rejects its use', async () => {
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'character.use') {
          return json({ message: 'The stone slips from your grip before it can strike.' }, 503);
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('take loose stone');
    await screen.findByText('You pick up the loose stone.');

    submitWorldCommand('use the loose stone on the marker');

    expect(await screen.findByText('The stone slips from your grip before it can strike.')).toBeVisible();
    expect(itemTaken).toBe(true);
  });

  it('asks which room target to use when several objects match', async () => {
    ambiguousUseTargetsVisible = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('take loose stone');
    await screen.findByText('You pick up the loose stone.');
    submitWorldCommand('use loose stone on stone');

    expect(await screen.findByText('Which target do you mean: Stone idol, Stone statue?')).toBeVisible();
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'character.use',
    )).toBe(false);
  });

  it('offers item use through the secondary quick actions page', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });
    fireEvent.change(commandInput, { target: { value: 'take loose stone' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('You pick up the loose stone.');
    quickGo('north');
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });

    clickQuickAction('Show items to use');
    fireEvent.click(screen.getByRole('button', { name: 'Choose Loose stone to use' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use Loose stone on Cracked bell' }));
    await screen.findByText('The mock interaction succeeds.');

    expect(apiFetch.mock.calls.some(([path, init]) => {
      if (path !== '/api/commands') return false;
      const body = JSON.parse(String(init?.body ?? '{}'));
      return body.type === 'character.use' &&
        body.payload.itemId === 'mossgate-loose-stone' &&
        body.payload.targetId === 'tower-cracked-bell';
    })).toBe(true);
  });

  it('replaces normal terminal actions with dedicated combat controls', async () => {
    healingDraughtCarried = true;
    characterHealth = { current: 3, maximum: 6 };
    combatEncounter = {
      encounterId: 'combat-ui-encounter',
      locationId: 'mossgate-clearing',
      opponentNpcId: 'mossgate-training-sentinel',
      opponentName: 'Practice Sentinel',
      round: 1,
      playerHealth: 3,
      playerMaxHealth: 6,
      opponentHealth: 2,
      opponentMaxHealth: 4,
      status: 'active',
      lastAction: 'attack',
      lastNarration: 'The sentinel waits.',
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    expect(screen.getByRole('group', { name: 'Quick info' })).toHaveTextContent('3/6');
    expect(screen.getByRole('group', { name: 'Character stamina' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Character mana' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Character currency balance: 12 moss mark' })).toHaveTextContent('12 m');
    expect(screen.queryByRole('textbox', { name: 'Enter a command' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Quick commands' })).not.toBeInTheDocument();
    const combatActions = screen.getByRole('group', { name: 'Combat actions' });
    expect(within(combatActions).getByRole('button', { name: 'Attack during active combat' })).toBeInTheDocument();
    expect(within(combatActions).getByRole('button', { name: 'Defend during active combat' })).toBeInTheDocument();
    expect(within(combatActions).getByRole('button', { name: 'Flee from combat' })).toBeInTheDocument();
    const useButton = within(combatActions).getByRole('button', { name: 'use' });
    expect(useButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(useButton);
    const combatItems = await screen.findByRole('group', { name: 'Items available to use during combat' });
    expect(within(combatItems).getByRole('button', { name: 'Use Small healing draught during combat' })).toBeInTheDocument();
    fireEvent.click(within(combatItems).getByRole('button', { name: 'Use Small healing draught during combat' }));

    await screen.findByText(/You use the small healing draught and recover 3 health/);
    expect(screen.queryByRole('group', { name: 'Items available to use during combat' })).not.toBeInTheDocument();
    expect(apiFetch.mock.calls.some(([path, init]) => {
      if (path !== '/api/commands') return false;
      const body = JSON.parse(String(init?.body ?? '{}'));
      return body.type === 'combat.action' &&
        body.payload.action === 'use-item' &&
        body.payload.itemId === 'item-reedbank-healing-draught' &&
        body.payload.encounterId === 'combat-ui-encounter';
    })).toBe(true);
  });

  it('uses a healing potion outside combat and displays persistent character health', async () => {
    healingDraughtCarried = true;
    characterHealth = { current: 2, maximum: 6 };
    characterStamina = { current: 70, maximum: 100 };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    expect(screen.getByLabelText('Character health')).toHaveTextContent('2/6');
    expect(screen.getByLabelText('Character stamina')).toHaveTextContent('70/100');
    expect(screen.getByLabelText('Character mana')).toHaveTextContent('100/100');
    expect(screen.getByLabelText('Quick info').querySelectorAll('svg')).toHaveLength(4);
    const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });
    fireEvent.change(commandInput, { target: { value: 'use Small healing draught' } });
    fireEvent.submit(commandInput.closest('form')!);

    await screen.findByText(/You use the small healing draught and recover 3 health/);
    expect(screen.getByLabelText('Character health')).toHaveTextContent('5/6');
    expect(healingDraughtCarried).toBe(false);
    expect(apiFetch.mock.calls.some(([path, init]) => {
      if (path !== '/api/commands') return false;
      const body = JSON.parse(String(init?.body ?? '{}'));
      return body.type === 'combat.action' &&
        body.payload.action === 'use-item' &&
        body.payload.itemId === 'item-reedbank-healing-draught' &&
        !body.payload.encounterId;
    })).toBe(true);
  });

  it('restores health and resources at Willowrest Inn for the listed fee through a contextual quick action', async () => {
    room = 'inn';
    visitedLocationIds = ['mossgate-clearing', 'glasswater-bridge', 'reedbank-stalls', 'willowrest-inn'];
    characterHealth = { current: 4, maximum: 6 };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Willowrest Inn' });
    expect(screen.getByText(/full night’s rest for five moss marks/i)).toBeInTheDocument();
    expect(quickActionVisibleAnywhere('Paid immediate inn recovery at Willowrest Inn for 5 moss marks')).toBe(true);

    clickQuickAction('Paid immediate inn recovery at Willowrest Inn for 5 moss marks');

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Terminal output' })).toHaveTextContent(
        /You rest at Willowrest Inn, restore 2 health, \d+ stamina, and \d+ mana, and pay 5 moss marks/,
      );
    });
    expect(screen.getByLabelText('Character health')).toHaveTextContent('6/6');
    expect(walletBalance).toBe(7);
    expect(apiFetch.mock.calls.some(([path, init]) => {
      if (path !== '/api/commands') return false;
      const body = JSON.parse(String(init?.body ?? '{}'));
      return body.type === 'inn.rest' &&
        body.payload.innId === 'willowrest-inn-service' &&
        body.expectedVersion === 1;
    })).toBe(true);
  });

  it('reports a failed paid inn rest without changing the character vitals', async () => {
    room = 'inn';
    visitedLocationIds = ['mossgate-clearing', 'glasswater-bridge', 'reedbank-stalls', 'willowrest-inn'];
    characterHealth = { current: 4, maximum: 6 };
    const original = apiFetch.getMockImplementation()!;
    let restAttempts = 0;
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/commands' && init?.body) {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'inn.rest') {
          restAttempts += 1;
          throw new Error('Willowrest Inn cannot accommodate you right now.');
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Willowrest Inn' });

    clickQuickAction('Paid immediate inn recovery at Willowrest Inn for 5 moss marks');

    expect(await screen.findByText('Willowrest Inn cannot accommodate you right now.')).toBeVisible();
    expect(screen.getByLabelText('Character health')).toHaveTextContent('4/6');
    expect(restAttempts).toBe(1);
  });

  it('restores vitals from the terminal inn rest command', async () => {
    room = 'inn';
    visitedLocationIds = ['mossgate-clearing', 'glasswater-bridge', 'reedbank-stalls', 'willowrest-inn'];
    characterHealth = { current: 4, maximum: 6 };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Willowrest Inn' });
    submitWorldCommand('inn rest');

    const history = screen.getByRole('region', { name: 'Terminal output' });
    await waitFor(() => expect(history).toHaveTextContent(
      /You rest at Willowrest Inn, restore 2 health, \d+ stamina, and \d+ mana, and pay 5 moss marks/,
    ));
    expect(screen.getByLabelText('Character health')).toHaveTextContent('6/6');
    expect(walletBalance).toBe(7);
  });

  it('explains target syntax for rest, stand, and inn commands', async () => {
    room = 'inn';
    visitedLocationIds = ['mossgate-clearing', 'glasswater-bridge', 'reedbank-stalls', 'willowrest-inn'];
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Willowrest Inn' });

    submitWorldCommand('rest here');
    expect(await screen.findByText('Use “inn rest” for the paid immediate inn service.')).toBeVisible();
    submitWorldCommand('stand up');
    expect(await screen.findByText('Use “stand” without a target.')).toBeVisible();
    submitWorldCommand('inn sleep');
    expect(await screen.findByText(
      'Usage: inn rest — immediately restore health, stamina, and mana for the listed price.',
    )).toBeVisible();
  });

  it('rejects paid inn rest when the current room has no inn service', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('inn rest');

    expect(await screen.findByText('There is no priced inn service in this location.')).toBeVisible();
  });

  it('exposes help, stand, and rest through the contextual quick actions', async () => {
    room = 'inn';
    visitedLocationIds = ['mossgate-clearing', 'glasswater-bridge', 'reedbank-stalls', 'willowrest-inn'];
    characterStamina = { current: 40, maximum: 100 };
    staminaPosture = 'resting';
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Willowrest Inn' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    clickQuickAction('Show command help');
    await waitFor(() => expect(history).toHaveTextContent('> help'));
    fireEvent.click(screen.getByRole('button', { name: 'Stand and leave the resting posture' }));
    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([path, init]) =>
        path === '/api/commands' && JSON.parse(String(init?.body ?? '{}')).type === 'character.stand',
      )).toBe(true);
    });
    const helpEntryCount = (history.textContent?.match(/> help/g) ?? []).length;
    clickQuickAction('Show command help');
    await waitFor(() => {
      expect(history.textContent?.match(/> help/g)).toHaveLength(helpEntryCount + 1);
    });
    clickQuickAction('Rest and recover health, stamina, and mana');
    await screen.findByText(/You ease into a resting posture/i);
  });

  it('keeps free stamina rest and stand separate from paid inn recovery', async () => {
    room = 'inn';
    visitedLocationIds = ['mossgate-clearing', 'glasswater-bridge', 'reedbank-stalls', 'willowrest-inn'];
    characterStamina = { current: 40, maximum: 100 };
    characterHealth = { current: 6, maximum: 6 };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Willowrest Inn' });
    expect(screen.queryByRole('progressbar', { name: 'Stamina 40 of 100' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rest here for free' })).not.toBeInTheDocument();
    const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });
    fireEvent.change(commandInput, { target: { value: 'rest' } });
    fireEvent.submit(commandInput.closest('form')!);

    await screen.findByText(/You ease into a resting posture/i);
    expect(apiFetch.mock.calls.some(([path, init]) => {
      if (path !== '/api/commands') return false;
      return JSON.parse(String(init?.body ?? '{}')).type === 'character.rest';
    })).toBe(true);
    expect(walletBalance).toBe(12);

    fireEvent.change(commandInput, { target: { value: 'stand' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText(/You rise, stretching the stiffness from your limbs/i);
    expect(apiFetch.mock.calls.some(([path, init]) => {
      if (path !== '/api/commands') return false;
      return JSON.parse(String(init?.body ?? '{}')).type === 'character.stand';
    })).toBe(true);
    expect(apiFetch.mock.calls.some(([path, init]) => {
      if (path !== '/api/commands') return false;
      return JSON.parse(String(init?.body ?? '{}')).type === 'inn.rest';
    })).toBe(false);
  });

  it('reports a server rejection when changing resting posture', async () => {
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'character.rest') {
          return json({ message: 'You cannot settle down just now.' }, 503);
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('rest');

    expect(await screen.findByText('You cannot settle down just now.')).toBeVisible();
  });

  it('supports free rest and stand at Orraveth’s Kindly Roof without an inn service', async () => {
    orravethWorld = true;
    room = 'inn';
    characterStamina = { current: 40, maximum: 100 };
    render(<WorldClient
      worldInstanceId="orraveth-bellwold-instance"
      onLeaveWorld={vi.fn().mockResolvedValue(undefined)}
    />);
    await screen.findByRole('heading', { name: 'The Kindly Roof' });
    expect(screen.queryByRole('progressbar', { name: 'Stamina 40 of 100' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rest here for free' })).not.toBeInTheDocument();
    expect(screen.queryByText(/moss marks|gold/)).not.toBeInTheDocument();

    const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });
    fireEvent.change(commandInput, { target: { value: 'rest' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText(/You ease into a resting posture/i);
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'character.rest' &&
      JSON.parse(String(init?.body ?? '{}')).worldInstanceId === 'orraveth-bellwold-instance'
    )).toBe(true);

    fireEvent.change(commandInput, { target: { value: 'stand' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText(/You rise, stretching the stiffness from your limbs/i);
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'character.stand' &&
      JSON.parse(String(init?.body ?? '{}')).worldInstanceId === 'orraveth-bellwold-instance'
    )).toBe(true);
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' && JSON.parse(String(init?.body ?? '{}')).type === 'inn.rest'
    )).toBe(false);
  });

  it('hides inn rest quick action when the traveler is already at full health', async () => {
    room = 'inn';
    visitedLocationIds = ['mossgate-clearing', 'glasswater-bridge', 'reedbank-stalls', 'willowrest-inn'];
    characterHealth = { current: 6, maximum: 6 };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Willowrest Inn' });

    expect(quickActionVisibleAnywhere('Paid immediate inn recovery at Willowrest Inn for 5 moss marks')).toBe(false);
  });

  it('offers between-fight potion use in quick actions only when health is missing', async () => {
    healingDraughtCarried = true;
    characterHealth = { current: 4, maximum: 6 };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    clickQuickAction('Show items to use');
    fireEvent.click(screen.getByRole('button', { name: 'Use Small healing draught' }));
    await screen.findByText(/You use the small healing draught and recover 2 health/);
    expect(screen.getByLabelText('Character health')).toHaveTextContent('6/6');
    expect(healingDraughtCarried).toBe(false);
  });

  it('reports a combat action failure without losing the active encounter', async () => {
    combatEncounter = {
      encounterId: 'combat-ui-encounter',
      locationId: 'mossgate-clearing',
      opponentNpcId: 'mossgate-training-sentinel',
      opponentName: 'Practice Sentinel',
      round: 1,
      playerHealth: 3,
      playerMaxHealth: 6,
      opponentHealth: 2,
      opponentMaxHealth: 4,
      status: 'active',
      lastAction: 'attack',
      lastNarration: 'The sentinel waits.',
    };
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'combat.action') {
          return json({ message: 'The sentinel is out of reach.' }, 503);
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const actions = screen.getByRole('group', { name: 'Combat actions' });

    fireEvent.click(within(actions).getByRole('button', { name: 'Attack during active combat' }));

    expect(await screen.findByText('The sentinel is out of reach.')).toBeVisible();
    expect(screen.getByRole('group', { name: 'Combat actions' })).toBeVisible();
  });

  it('offers healing items in combat controls only when health is missing', async () => {
    healingDraughtCarried = true;
    combatEncounter = {
      encounterId: 'combat-ui-encounter',
      locationId: 'mossgate-clearing',
      opponentNpcId: 'mossgate-training-sentinel',
      opponentName: 'Practice Sentinel',
      round: 1,
      playerHealth: 3,
      playerMaxHealth: 6,
      opponentHealth: 2,
      opponentMaxHealth: 4,
      status: 'active',
      lastAction: 'attack',
      lastNarration: 'The sentinel waits.',
    };
    combatEncounter.playerHealth = combatEncounter.playerMaxHealth;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const combatActions = screen.getByRole('group', { name: 'Combat actions' });
    expect(within(combatActions).queryByRole('button', { name: 'use' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Items available to use during combat' })).not.toBeInTheDocument();
    expect(healingDraughtCarried).toBe(true);
  });

  it('replaces gameplay with a game-over screen after character death', async () => {
    characterHealth = { current: 0, maximum: 6 };
    combatEncounter = {
      encounterId: 'combat-ui-encounter',
      locationId: 'mossgate-clearing',
      opponentNpcId: 'mossgate-training-sentinel',
      opponentName: 'Practice Sentinel',
      round: 2,
      playerHealth: 0,
      playerMaxHealth: 6,
      opponentHealth: 1,
      opponentMaxHealth: 4,
      status: 'defeat',
      lastAction: 'attack',
      lastNarration: 'The sentinel strikes you down.',
    };
    const onLeaveWorld = vi.fn().mockResolvedValue(undefined);
    render(<WorldClient onLeaveWorld={onLeaveWorld} />);

    expect(await screen.findByRole('heading', { name: 'Game over' })).toBeInTheDocument();
    expect(screen.getByText(/Create a new character to begin again/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Enter a command' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Game screens' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start a new character' }));
    await waitFor(() => expect(onLeaveWorld).toHaveBeenCalledOnce());
  });

  it('keeps NPC choices private in the terminal and exposes them as persistent actions', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });
    const chat = screen.getByRole('region', { name: 'Room chat' });
    const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });
    const markerResponse = 'Mara: The marker points east to the Old Bell Tower. Its direction is still true.';
    const greetingResponse = 'Mara: The old paths still have their stories. What would you like to ask?';
    const markerResponseCount = () => [...history.querySelectorAll('li')]
      .filter((entry) => entry.textContent === markerResponse).length;
    const greetingResponseCount = () => [...history.querySelectorAll('li')]
      .filter((entry) => entry.textContent === greetingResponse).length;

    fireEvent.change(commandInput, { target: { value: 'talk Mara' } });
    fireEvent.submit(commandInput.closest('form')!);
    await waitFor(() => {
      expect(history).toHaveTextContent('Mara: The old paths still have their stories. What would you like to ask?');
    });
    expect(history).toHaveTextContent('> talk Mara');
    expect(chat).not.toHaveTextContent('What would you like to ask?');
    const conversation = await screen.findByRole('dialog', { name: 'Conversation with Mara' });
    expect(conversation).toHaveTextContent('The old paths still have their stories. What would you like to ask?');
    expect(screen.getByRole('group', { name: 'Mara response options' })).toHaveTextContent('Ask about the marker');
    const farewellGroup = within(conversation).getByRole('group', { name: 'End conversation' });
    expect(within(farewellGroup).getAllByRole('button')).toHaveLength(1);
    expect(within(farewellGroup).getByRole('button', { name: 'Until next time' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Mara dialogue choices' })).not.toBeInTheDocument();
    const greetingRequest = apiFetch.mock.calls.find(([path, init]) =>
      path === '/api/queries' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'npc.talk'
    );
    expect(JSON.parse(String(greetingRequest?.[1]?.body))).toMatchObject({
      type: 'npc.talk',
      characterId,
      payload: { npcId: 'mara-waykeeper' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Ask about the marker' }));
    await waitFor(() => {
      expect(history).toHaveTextContent('Mara: The marker points east to the Old Bell Tower. Its direction is still true.');
    });
    expect(conversation).toHaveTextContent('The marker points east to the Old Bell Tower. Its direction is still true.');
    const remainingChoices = screen.getByRole('group', { name: 'Mara response options' });
    expect(remainingChoices).toHaveTextContent('Ask about the bell tower');
    expect(remainingChoices).not.toHaveTextContent('Ask about the marker');
    expect(chat).not.toHaveTextContent('The marker points east to the Old Bell Tower. Its direction is still true.');

    fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([, init]) =>
        JSON.parse(String(init?.body ?? '{}')).type === 'npc.dialogue.restart',
      )).toBe(true);
    });
    await waitFor(() => expect(history.closest('.focused-terminal')).toHaveAttribute('aria-busy', 'false'));
    expect(screen.queryByRole('group', { name: 'Mara dialogue choices' })).not.toBeInTheDocument();
    fireEvent.change(commandInput, { target: { value: 'talk Mara about bell' } });
    fireEvent.submit(commandInput.closest('form')!);
    await waitFor(() => {
      expect(history).toHaveTextContent('Mara: The bell has not rung in years. The tower stands east of this clearing.');
    });
    expect(screen.queryByRole('dialog', { name: 'Conversation with Mara' })).not.toBeInTheDocument();
    clickQuickAction('Show people to talk to');
    fireEvent.click(screen.getByRole('button', { name: 'Return to quick commands' }));
    clickQuickAction('Show people to talk to');
    fireEvent.click(screen.getByRole('button', { name: 'Talk to Mara' }));
    expect(screen.getByRole('group', { name: /^Quick commands, page \d+$/ })).toBeVisible();
    await screen.findByRole('button', { name: 'Close conversation' });
    await waitFor(() => {
      expect(greetingResponseCount()).toBe(2);
      expect(markerResponseCount()).toBe(1);
    });
    expect(screen.getByRole('group', { name: 'Mara response options' })).toHaveTextContent('Ask about the marker');

    fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
    quickGo('north');
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    quickGo('south');
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    fireEvent.change(commandInput, { target: { value: 'talk Mara' } });
    fireEvent.submit(commandInput.closest('form')!);
    await waitFor(() => {
      expect(greetingResponseCount()).toBe(3);
      expect(markerResponseCount()).toBe(1);
    });

    await screen.findByRole('button', { name: 'Close conversation' });
    fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
    quickGo('north');
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    fireEvent.change(commandInput, { target: { value: 'talk Mara' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('You do not see anyone called “Mara” here.');
  });

  it('lists and selects NPC dialogue choices with the quests command', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('quests');
    await screen.findByText('Talk to an NPC first with “talk <name>”; there are no dialogue choices to select.');
    const history = screen.getByRole('region', { name: 'Terminal output' });

    submitWorldCommand('talk Mara');
    await waitFor(() => expect(history).toHaveTextContent('Mara: The old paths still have their stories.'));
    expect(await screen.findByRole('dialog', { name: 'Conversation with Mara' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));

    submitWorldCommand('quests');
    await waitFor(() => expect(history).toHaveTextContent('1. Ask about the marker'));
    expect(history).toHaveTextContent('2. Ask about the bell tower');
    expect(history).toHaveTextContent('Choose a reply with “quests <number>”.');

    submitWorldCommand('quests 99');
    await waitFor(() => expect(history).toHaveTextContent(
      'Choose a number from 1 to 2, or enter a reply exactly as shown. Type “quests” to list replies.',
    ));

    submitWorldCommand('quests 1');
    await waitFor(() => {
      expect(history).toHaveTextContent('> quests 1');
      expect(history).toHaveTextContent('Mara: The marker points east to the Old Bell Tower.');
    });
    expect(await screen.findByRole('dialog', { name: 'Conversation with Mara' })).toHaveTextContent(
      'The marker points east to the Old Bell Tower.',
    );
  });

  it('equips available gear and updates the equipped slots in the Equipment screen', async () => {
    includeEquipmentFixture = true;
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    await openInfoSection('Equipment');

    expect(screen.getAllByText('Test sword')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Unequip weapon' })).toBeEnabled();
    const equipShield = screen.getByRole('button', { name: 'Equip Test shield' });
    expect(equipShield).toBeEnabled();
    fireEvent.click(equipShield);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Equipped Test shield' })).toBeDisabled());
    expect(screen.getAllByText('Test shield')).toHaveLength(2);
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'character.equip' &&
      JSON.parse(String(init?.body ?? '{}')).payload?.itemId === 'test-shield'
    )).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Unequip weapon' }));
    await waitFor(() => {
      const weaponSlot = screen.getByText('weapon').parentElement;
      expect(weaponSlot).toHaveTextContent('None');
    });
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'character.unequip' &&
      JSON.parse(String(init?.body ?? '{}')).payload?.slot === 'weapon'
    )).toBe(true);
  });

  it('opens and uses the carried-gear quick action list', async () => {
    includeEquipmentFixture = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    clickQuickAction('Show gear to equip');
    fireEvent.click(screen.getByRole('button', { name: 'Return to quick commands' }));
    clickQuickAction('Show gear to equip');
    fireEvent.click(screen.getByRole('button', { name: 'Equip Test shield' }));

    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([path, init]) =>
        path === '/api/commands' &&
        JSON.parse(String(init?.body ?? '{}')).type === 'character.equip',
      )).toBe(true);
    });
  });

  it('removes equipped gear from the quick action list', async () => {
    includeEquipmentFixture = true;
    equipmentSnapshot = { weaponItemId: 'test-sword', armorItemId: 'test-shield' };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    clickQuickAction('Show equipped gear to remove');
    fireEvent.click(screen.getByRole('button', { name: 'Return to quick commands' }));
    clickQuickAction('Show equipped gear to remove');
    fireEvent.click(screen.getByRole('button', { name: 'Unequip armor' }));

    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([path, init]) => {
        if (path !== '/api/commands') return false;
        const command = JSON.parse(String(init?.body ?? '{}'));
        return command.type === 'character.unequip' && command.payload?.slot === 'armor';
      })).toBe(true);
    });
  });

  it('keeps equipment unchanged when the server rejects an equip action', async () => {
    includeEquipmentFixture = true;
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'character.equip') {
          return json({ message: 'The shield strap is damaged.' }, 503);
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('equip test shield');

    expect(await screen.findByText('The shield strap is damaged.')).toBeVisible();
    expect(equipmentSnapshot).toBeNull();
  });

  it('supports equipping and unequipping gear through terminal commands', async () => {
    includeEquipmentFixture = true;
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    submitWorldCommand('equip test shield');
    await waitFor(() => expect(history).toHaveTextContent('You equip the test shield as your armor.'));
    submitWorldCommand('unequip armor');
    await waitFor(() => expect(history).toHaveTextContent('You unequip your armor.'));

    const equipmentCommands = apiFetch.mock.calls
      .filter(([path, init]) => path === '/api/commands' && init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body ?? '{}')) as {
        type?: string;
        payload?: { itemId?: string; slot?: string };
      });
    expect(equipmentCommands.some((command) =>
      command.type === 'character.equip' && command.payload?.itemId === 'test-shield',
    )).toBe(true);
    expect(equipmentCommands.some((command) =>
      command.type === 'character.unequip' && command.payload?.slot === 'armor',
    )).toBe(true);
  });

  it('explains missing gear and invalid slots in terminal equipment commands', async () => {
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    submitWorldCommand('equip');
    await waitFor(() => expect(history).toHaveTextContent('Equip what?'));
    submitWorldCommand('equip practice blade');
    await waitFor(() => expect(history).toHaveTextContent('You are not carrying an item called “practice blade”.'));
    submitWorldCommand('unequip fingers');
    await waitFor(() => expect(history).toHaveTextContent('Unequip which slot? Choose'));
  });

  it('rejects equipping a carried item that is not equipment', async () => {
    dailyFeatureEnabled = true;
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    submitWorldCommand('equip bound river mint');

    await waitFor(() => expect(history).toHaveTextContent('The bound river mint cannot be equipped.'));
  });

  it('offers retry and exit actions when the world session has no room projection', async () => {
    locationUnavailable = true;
    const onLeaveWorld = vi.fn().mockResolvedValue(undefined);
    render(<WorldClient onLeaveWorld={onLeaveWorld} />);

    expect(await screen.findByText('Character unavailable')).toBeVisible();
    expect(screen.getByText('This character can’t be loaded in the current world session.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Character unavailable')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Characters' }));
    await waitFor(() => expect(onLeaveWorld).toHaveBeenCalledTimes(1));
  });

  it('retries the initial world load after a temporary request failure', async () => {
    const original = apiFetch.getMockImplementation()!;
    let shouldFail = true;
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/game' && shouldFail) {
        shouldFail = false;
        throw new Error('Temporary network failure');
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    expect(await screen.findByText('Temporary network failure')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Mossgate Clearing' })).toBeVisible();
  });

  it('opens the crafting quantity dialog and submits the selected amount', async () => {
    craftingCatalog = {
      skill: { level: 1, experienceHundredths: 0 },
      atWorkbench: true,
      recipes: [{
        recipeId: 'leather-gloves',
        outputTypeId: 'leather-gloves',
        outputLabel: 'Leather gloves',
        requiredLevel: 1,
        experience: 13.8,
        maxCraftable: 5,
      }],
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('craft leather gloves');
    const dialog = await screen.findByRole('dialog', { name: 'How many?' });
    expect(screen.getByRole('button', { name: 'Leather gloves ×1' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Leather gloves ×5' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Leather gloves ×10' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Leather gloves ×5' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(await screen.findByText('You craft 5 × leather gloves.')).toBeVisible();
    expect(craftingCommandPayloads).toEqual([{ recipeId: 'leather-gloves', quantity: 5 }]);
  });

  it('refuses crafting without a character and skips the catalog request', async () => {
    characterProjectionUnavailable = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('craft leather gloves');

    expect(await screen.findByText('Choose a character before crafting.')).toBeVisible();
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/queries' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'crafting.catalog'
    )).toBe(false);
  });

  it('accepts the numbered crafting command form and maps option three to ten items', async () => {
    craftingCatalog = {
      skill: { level: 1, experienceHundredths: 0 },
      atWorkbench: true,
      recipes: [{
        recipeId: 'leather-gloves',
        outputTypeId: 'leather-gloves',
        outputLabel: 'Leather gloves',
        requiredLevel: 1,
        experience: 13.8,
        maxCraftable: 10,
      }],
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('craft leather gloves 3');

    expect(await screen.findByText('You craft 10 × leather gloves.')).toBeVisible();
    expect(craftingCommandPayloads).toEqual([{ recipeId: 'leather-gloves', quantity: 10 }]);
  });

  it('lists craftable recipes but refuses to start crafting away from a workbench', async () => {
    craftingCatalog = {
      skill: { level: 1, experienceHundredths: 0 },
      atWorkbench: false,
      recipes: [{
        recipeId: 'leather-gloves',
        outputTypeId: 'leather-gloves',
        outputLabel: 'Leather gloves',
        requiredLevel: 1,
        experience: 13.8,
        maxCraftable: 5,
      }],
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('craft');
    expect(await screen.findByText('You can craft:')).toBeVisible();
    expect(screen.getByText('Leather gloves — Crafting level 1, 13.8 XP each')).toBeVisible();
    expect(screen.getByText('Travel to a workbench to craft one of these items.')).toBeVisible();

    submitWorldCommand('craft leather gloves');
    expect(await screen.findByText('You need to be at a workbench to craft.')).toBeVisible();
    expect(craftingCommandPayloads).toEqual([]);
  });

  it('reports when no recipes are available and when the crafting catalog cannot load', async () => {
    craftingCatalog = {
      skill: { level: 1, experienceHundredths: 0 },
      atWorkbench: true,
      recipes: [],
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('craft');
    expect(await screen.findByText('Nothing is craftable with your current materials and Crafting level.')).toBeVisible();

    craftingCatalogError = 'Crafting list is temporarily unavailable.';
    submitWorldCommand('craft');
    expect(await screen.findByText('Crafting list is temporarily unavailable.')).toBeVisible();
  });

  it('handles ambiguous recipes and validates item and quantity selections', async () => {
    craftingCatalog = {
      skill: { level: 1, experienceHundredths: 0 },
      atWorkbench: true,
      recipes: [{
        recipeId: 'leather-gloves',
        outputTypeId: 'leather-gloves',
        outputLabel: 'Leather gloves',
        requiredLevel: 1,
        experience: 13.8,
        maxCraftable: 5,
      }, {
        recipeId: 'leather-boots',
        outputTypeId: 'leather-boots',
        outputLabel: 'Leather boots',
        requiredLevel: 1,
        experience: 16.25,
        maxCraftable: 5,
      }],
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    submitWorldCommand('craft leather');
    expect(await screen.findByText('Choose an item to craft:')).toBeVisible();
    expect(history).toHaveTextContent('Leather gloves');
    expect(history).toHaveTextContent('Leather boots');

    submitWorldCommand('craft leather gloves 3');
    expect(await screen.findByText('You have enough materials to craft at most 5.')).toBeVisible();
    submitWorldCommand('craft sword');
    expect(await screen.findByText('You cannot craft “sword” with your current materials and Crafting level.')).toBeVisible();
    submitWorldCommand('craft 2');
    expect(await screen.findByText('Name an item to craft before choosing a quantity.')).toBeVisible();
    submitWorldCommand('craft 4');
    expect(await screen.findByText('Choose option 1, 2, or 3. These make 1, 5, or 10 items.')).toBeVisible();
    expect(craftingCommandPayloads).toEqual([]);
  });

  it('closes the crafting dialog without sending a craft command', async () => {
    craftingCatalog = {
      skill: { level: 1, experienceHundredths: 0 },
      atWorkbench: true,
      recipes: [{
        recipeId: 'leather-gloves',
        outputTypeId: 'leather-gloves',
        outputLabel: 'Leather gloves',
        requiredLevel: 1,
        experience: 13.8,
        maxCraftable: 5,
      }],
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('craft leather gloves');
    const dialog = await screen.findByRole('dialog', { name: 'How many?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(craftingCommandPayloads).toEqual([]);
  });

  it('keeps the quantity dialog open when the server rejects crafting', async () => {
    craftingCatalog = {
      skill: { level: 1, experienceHundredths: 0 },
      atWorkbench: true,
      recipes: [{
        recipeId: 'leather-gloves',
        outputTypeId: 'leather-gloves',
        outputLabel: 'Leather gloves',
        requiredLevel: 1,
        experience: 13.8,
        maxCraftable: 5,
      }],
    };
    craftingCommandError = 'You need more tanned hides.';
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('craft leather gloves');
    const dialog = await screen.findByRole('dialog', { name: 'How many?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leather gloves ×1' }));

    await waitFor(() => expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'crafting.craft'
    )).toBe(true));
    expect(dialog).toBeInTheDocument();
    expect(craftingCommandPayloads).toEqual([]);
  });

  it('closes after a successful craft even when the character refresh fails', async () => {
    craftingCatalog = {
      skill: { level: 1, experienceHundredths: 0 },
      atWorkbench: true,
      recipes: [{
        recipeId: 'leather-gloves',
        outputTypeId: 'leather-gloves',
        outputLabel: 'Leather gloves',
        requiredLevel: 1,
        experience: 13.8,
        maxCraftable: 5,
      }],
    };
    failNextCraftingSnapshotRefresh = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('craft leather gloves');
    const dialog = await screen.findByRole('dialog', { name: 'How many?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leather gloves ×1' }));

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(await screen.findByText('You craft 1 × leather gloves.')).toBeVisible();
    expect(craftingSnapshotRefreshFailureCount).toBe(1);
    expect(craftingCommandPayloads).toEqual([{ recipeId: 'leather-gloves', quantity: 1 }]);
  });

  it('keeps an open NPC dialogue modal visible after the final reply until the player closes it', async () => {
    const original = apiFetch.getMockImplementation()!;
    let restartRequested = false;
    let restartedTalkRequests = 0;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'npc.dialogue.restart') restartRequested = true;
      }
      if (path === '/api/queries' && init?.method === 'POST') {
        const query = JSON.parse(String(init.body)) as { type?: string };
        if (query.type === 'npc.talk' && restartRequested) {
          restartedTalkRequests += 1;
          return json({ message: 'The conversation has reset.' }, 503);
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('talk Mara');

    const dialog = await screen.findByRole('dialog', { name: 'Conversation with Mara' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(dialog).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ask about the marker' }));
    await waitFor(() => expect(dialog).toHaveTextContent('The marker points east to the Old Bell Tower.'));

    fireEvent.click(screen.getByRole('button', { name: 'Ask about the bell tower' }));
    await waitFor(() => expect(dialog).toHaveTextContent('The bell has been silent for years.'));
    expect(dialog).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Mara response options' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
    expect(screen.queryByRole('dialog', { name: 'Conversation with Mara' })).not.toBeInTheDocument();
    await waitFor(() => expect(restartedTalkRequests).toBe(1));
    expect(screen.queryByRole('dialog', { name: 'Conversation with Mara' })).not.toBeInTheDocument();
  });

  it('shows a useful message when an NPC dialogue query fails', async () => {
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/queries' && init?.method === 'POST') {
        const query = JSON.parse(String(init.body)) as { type?: string };
        if (query.type === 'npc.talk') return json({ message: 'Mara cannot hear you over the rain.' }, 503);
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('talk Mara');

    expect(await screen.findByText('Mara cannot hear you over the rain.')).toBeVisible();
  });

  it('restarts an already-ended NPC conversation when the player talks to them again', async () => {
    maraChoice = 'ask-tower';
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    submitWorldCommand('talk Mara');

    const conversation = await screen.findByRole('dialog', { name: 'Conversation with Mara' });
    expect(conversation).toHaveTextContent('The old paths still have their stories. What would you like to ask?');
    expect(screen.getByRole('group', { name: 'Mara response options' })).toHaveTextContent('Ask about the marker');
    expect(history).not.toHaveTextContent('The bell has been silent for years. I still hope to hear it ring again.');
    expect(apiFetch.mock.calls.some(([, init]) =>
      JSON.parse(String(init?.body ?? '{}')).type === 'npc.dialogue.restart',
    )).toBe(true);
  });

  it('reports an error when an NPC conversation cannot be restarted on close', async () => {
    maraChoice = 'ask-tower';
    const original = apiFetch.getMockImplementation()!;
    let restartAttempts = 0;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'npc.dialogue.restart' && ++restartAttempts === 2) {
          return json({ message: 'The conversation could not be reset right now.' }, 503);
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('talk Mara');
    const conversation = await screen.findByRole('dialog', { name: 'Conversation with Mara' });
    await waitFor(() => expect(restartAttempts).toBe(1));
    fireEvent.click(within(conversation).getByRole('button', { name: 'Ask about the marker' }));
    await screen.findByText('The marker points east to the Old Bell Tower. Its direction is still true.');

    fireEvent.click(within(conversation).getByRole('button', { name: 'Until next time' }));

    expect(await screen.findByText('The conversation could not be reset right now.')).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Conversation with Mara' })).not.toBeInTheDocument();
  });

  it('reports an NPC reply failure without replacing the open conversation', async () => {
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'npc.dialogue.choose') {
          return json({ message: 'Mara cannot answer that just now.' }, 503);
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('talk Mara');
    const conversation = await screen.findByRole('dialog', { name: 'Conversation with Mara' });

    fireEvent.click(within(conversation).getByRole('button', { name: 'Ask about the marker' }));

    expect(await screen.findByText('Mara cannot answer that just now.')).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Conversation with Mara' })).toBeVisible();
  });

  it('shows the description of a named NPC with the look command', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('look Mara');

    const history = screen.getByRole('region', { name: 'Terminal output' });
    await waitFor(() => expect(history).toHaveTextContent('> look Mara'));
    expect(history).toHaveTextContent('A path keeper stands beside the weathered marker, watching the northern trail.');
    expect(history).not.toHaveTextContent('You cannot get a clear look at Mara right now.');
  });

  it('asks for a target when look and read commands omit one', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('look at');

    expect(await screen.findByText('Look at what? Try “look at marker”.')).toBeVisible();
    submitWorldCommand('read');
    expect(await screen.findByText('Read what? Try “read marker” or “read bulletin”.')).toBeVisible();
  });

  it('explains how to use an axe when no tree target is supplied', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('use copper axe');

    expect(await screen.findByText(
      'Use a healing item, a fishing rod at a marked spot, or an axe on a named tree (for example, “use Copper Axe pine”).',
    )).toBeVisible();
    submitWorldCommand('use missing tool on stump');
    expect(await screen.findByText('You are not carrying anything called “missing tool”.')).toBeVisible();
  });

  it('looks at visible objects by target and only while they are in the current room', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });
    const terminal = history.closest('.focused-terminal')!;
    const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });
    const appearance = 'A weathered stone marker, its carved arrow worn but still pointing east.';

    fireEvent.change(commandInput, { target: { value: 'look marker' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText(appearance);
    expect(history).toHaveTextContent('> look marker');
    await waitFor(() => expect(terminal).toHaveAttribute('aria-busy', 'false'));

    fireEvent.change(commandInput, { target: { value: 'look at marker' } });
    fireEvent.submit(commandInput.closest('form')!);
    await waitFor(() => expect(screen.getAllByText(appearance)).toHaveLength(2));
    await waitFor(() => expect(terminal).toHaveAttribute('aria-busy', 'false'));

    quickGo('north');
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    await waitFor(() => expect(terminal).toHaveAttribute('aria-busy', 'false'));
    fireEvent.change(commandInput, { target: { value: 'look marker' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('You do not see anything called “marker” here.');
  });

  it('runs a look command when a known person, place, or object is clicked in the terminal', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });
    const terminal = history.closest('.focused-terminal')!;
    const markerLink = await screen.findByRole('button', { name: 'Choose an action for Weathered marker in terminal' });

    fireEvent.click(markerLink);
    const actionDialog = await screen.findByRole('dialog', { name: 'Choose an action for Weathered marker' });
    expect(actionDialog).toHaveTextContent('Read');
    expect(actionDialog).toHaveTextContent('Look');
    fireEvent.click(within(actionDialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Choose an action for Weathered marker' })).not.toBeInTheDocument());
    fireEvent.click(markerLink);
    const reopenedActionDialog = await screen.findByRole('dialog', { name: 'Choose an action for Weathered marker' });
    fireEvent.click(within(reopenedActionDialog).getByRole('button', { name: 'Look' }));

    await screen.findByText('A weathered stone marker, its carved arrow worn but still pointing east.');
    expect(history).toHaveTextContent('> look Weathered marker');
    await waitFor(() => expect(terminal).toHaveAttribute('aria-busy', 'false'));
    expect(apiFetch.mock.calls.some(([path, init]) => {
      if (path !== '/api/queries') return false;
      const query = JSON.parse(String(init?.body ?? '{}'));
      return query.type === 'object.inspect' && query.payload?.objectId === 'mossgate-marker';
    })).toBe(true);

    quickGo('north');
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    expect(screen.queryByRole('button', { name: 'Look at Weathered marker' })).not.toBeInTheDocument();
  });

  it('records reading a current-room marker as a character action', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });
    const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });

    fireEvent.change(commandInput, { target: { value: 'read marker' } });
    fireEvent.submit(commandInput.closest('form')!);

    await screen.findByText('OLD BELL TOWER — EAST');
    expect(history).toHaveTextContent('> read marker');
    const readRequest = apiFetch.mock.calls.find(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'character.read'
    );
    expect(JSON.parse(String(readRequest?.[1]?.body))).toMatchObject({
      type: 'character.read',
      characterId,
      payload: { objectId: 'mossgate-marker' },
    });

    fireEvent.change(commandInput, { target: { value: 'read book' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('There is nothing readable called “book” here.');
    expect(apiFetch.mock.calls.filter(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'character.read'
    )).toHaveLength(1);
  });

  it('prints the authoritative error when reading a room object fails', async () => {
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string; commandId?: string };
        if (command.type === 'character.read') {
          return json({ message: 'The marker text is too faded to read.' }, 500);
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('read marker');

    expect(await screen.findByText('The marker text is too faded to read.')).toBeVisible();
  });

  it('prints the authoritative error when taking a room item fails', async () => {
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'character.take') {
          return json({ message: 'The loose stone is wedged in the earth.' }, 503);
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('take loose stone');

    expect(await screen.findByText('The loose stone is wedged in the earth.')).toBeVisible();
  });

  it('announces newly completed quest objectives once and does not replay them after reload', async () => {
    questJournal = [{
      questId: 'mara-wayfinding',
      title: 'The Waystone Path',
      summary: 'Read the marker and visit Glasswater Bridge.',
      status: 'active',
      objectives: [
        { id: 'read-marker', label: 'Read the weathered marker', completed: false },
        { id: 'visit-bridge', label: 'Visit Glasswater Bridge', completed: false },
      ],
    }, {
      questId: 'completed-sample',
      title: 'A Completed Errand',
      summary: 'Return a message.',
      status: 'completed',
      objectives: [{ id: 'deliver-message', label: 'Deliver the message', completed: true }],
    }];
    const firstRun = render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });
    expect(history).not.toHaveTextContent('Objective complete:');

    const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });
    fireEvent.change(commandInput, { target: { value: 'read marker' } });
    fireEvent.submit(commandInput.closest('form')!);
    const markerNotice = 'Objective complete: Read the weathered marker — The Waystone Path.';
    await screen.findByText(markerNotice);
    expect(history).not.toHaveTextContent('Objective complete: Deliver the message');
    fireEvent.change(commandInput, { target: { value: 'read marker' } });
    fireEvent.submit(commandInput.closest('form')!);
    await waitFor(() => expect(screen.getAllByText('OLD BELL TOWER — EAST')).toHaveLength(2));
    expect(screen.getAllByText(markerNotice)).toHaveLength(1);

    quickGo('north');
    const visitNotice = 'Objective complete: Visit Glasswater Bridge — The Waystone Path.';
    await screen.findByText(visitNotice);
    expect(screen.getAllByText(visitNotice)).toHaveLength(1);

    firstRun.unmount();
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    expect(screen.queryByText(/Objective complete:/)).not.toBeInTheDocument();
  });

  it('keeps a quest stone after taking it and refuses to drop it', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });
    const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });

    fireEvent.change(commandInput, { target: { value: 'take marker' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('You cannot take the weathered marker.');
    expect(apiFetch.mock.calls.filter(([path]) => path === '/api/commands')).toHaveLength(0);

    fireEvent.change(commandInput, { target: { value: 'take stone' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('You pick up the loose stone.');
    expect(history).toHaveTextContent('> take stone');
    const takeRequest = apiFetch.mock.calls.find(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'character.take'
    );
    expect(JSON.parse(String(takeRequest?.[1]?.body))).toMatchObject({
      type: 'character.take',
      characterId,
      expectedVersion: 1,
      payload: { itemId: 'mossgate-loose-stone' },
    });

    await openInfoSection('Items');
    expect(screen.getByText('Loose stone')).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: 'Play' }));
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    expect(screen.queryByRole('button', { name: 'Show items to drop' })).not.toBeInTheDocument();
    const commandInputAfterReturn = screen.getByRole('textbox', { name: 'Enter a command' });
    fireEvent.change(commandInputAfterReturn, { target: { value: 'drop stone' } });
    fireEvent.submit(commandInputAfterReturn.closest('form')!);
    await screen.findByText('Quest items cannot be dropped.');
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'character.drop'
    )).toBe(false);
  });

  it('treats get as an alias of take', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const input = screen.getByRole('textbox', { name: 'Enter a command' });
    fireEvent.change(input, { target: { value: 'get stone' } });
    fireEvent.submit(input.closest('form')!);

    await screen.findByText('You pick up the loose stone.');
    const request = apiFetch.mock.calls.find(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'character.take',
    );
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
      type: 'character.take',
      payload: { itemId: 'mossgate-loose-stone' },
    });
  });

  it('puts a carried item into a named container and gets it back', async () => {
    const originalFetch = apiFetch.getMockImplementation()!;
    const fixtureItem = {
      id: 'fixture-stone',
      label: 'test stone',
      description: 'A small test stone.',
    };
    const fixtureDuplicateItem = {
      id: 'fixture-stone-shard',
      label: 'test stone shard',
      description: 'A small stone fragment.',
    };
    const fixtureQuestItem = {
      id: 'fixture-bound-stone',
      label: 'bound stone',
      description: 'A small quest-bound stone.',
      questBound: true,
    };
    const fixtureSackContents = [
      { id: 'fixture-smooth-stone', label: 'Smooth stone', description: 'A smooth gray stone.' },
      { id: 'fixture-heavy-stone', label: 'Heavy stone', description: 'A heavy brown stone.' },
    ];
    const fixtureContainer = {
      id: 'fixture-sack',
      label: 'test sack',
      description: 'A small test sack.',
      readable: false,
      takeable: false,
      containerKind: 'sack',
      contents: [],
    };
    let stored = false;
    let failPut = false;
    const withContainer = (location: Record<string, unknown>) => {
      const existing = Array.isArray(location.objects)
        ? location.objects as Array<Record<string, unknown>>
        : [];
      const objects = existing.filter((object) =>
        object.id !== fixtureContainer.id &&
        object.id !== fixtureItem.id &&
        !fixtureSackContents.some((item) => item.id === object.id),
      );
      objects.push({
        ...fixtureContainer,
        contents: [
          ...fixtureSackContents.map(({ id, label, description }) => ({ id, label, description })),
          ...(stored ? [fixtureItem] : []),
        ],
      });
      objects.push(...fixtureSackContents.map((item) => ({
        ...item,
        readable: false,
        takeable: true,
        containerId: fixtureContainer.id,
      })));
      if (stored) {
        objects.push({
          ...fixtureItem,
          readable: false,
          takeable: true,
          containerId: fixtureContainer.id,
        });
      }
      return { ...location, objects };
    };
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/commands' && init?.body) {
        const command = JSON.parse(String(init.body)) as {
          type?: string;
          commandId?: string;
          payload?: { itemId?: string; containerId?: string };
        };
        if (command.type === 'character.put' && failPut) {
          return json({ message: 'The test sack is torn.' }, 503);
        }
        if (command.type === 'character.put' || (
          command.type === 'character.take' && command.payload?.itemId === fixtureItem.id
        )) {
          stored = command.type === 'character.put';
          revision += 1;
          return json({
            receipt: {
              ok: true,
              commandId: command.commandId,
              eventIds: [],
              newAggregateVersion: revision,
            },
            events: [],
          });
        }
      }
      const response = await originalFetch(path, init);
      if (path === '/api/game') {
        const snapshot = await response.json() as {
          character: { inventory: Array<{ id: string; label: string; description: string; questBound?: boolean }> };
          location: Record<string, unknown>;
        };
        const inventory = snapshot.character.inventory.filter((item) =>
          item.id !== fixtureItem.id && item.id !== fixtureQuestItem.id,
        );
        if (!stored) inventory.push(fixtureItem, fixtureQuestItem, fixtureDuplicateItem);
        return json({
          ...snapshot,
          character: { ...snapshot.character, inventory },
          location: withContainer(snapshot.location),
        });
      }
      if (path === '/api/queries' && init?.body) {
        const query = JSON.parse(String(init.body)) as { type?: string };
        if (query.type === 'location.describe') {
          const result = await response.json() as {
            ok: boolean;
            value: Record<string, unknown>;
          };
          return json({ ...result, value: withContainer(result.value) });
        }
      }
      return response;
    });

    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('equip test');
    await screen.findByText('Which item do you mean: test stone, test stone shard?');
    submitWorldCommand('equip test stone');
    await screen.findByText('The test stone cannot be equipped.');
    const initialItemAmbiguityCount = screen.getAllByText('Which item do you mean: test stone, test stone shard?').length;
    submitWorldCommand('use test');
    await waitFor(() => {
      expect(screen.getAllByText('Which item do you mean: test stone, test stone shard?')).toHaveLength(initialItemAmbiguityCount + 1);
    });
    const explicitUseAmbiguityCount = screen.getAllByText('Which item do you mean: test stone, test stone shard?').length;
    submitWorldCommand('use test on marker');
    await waitFor(() => {
      expect(screen.getAllByText('Which item do you mean: test stone, test stone shard?')).toHaveLength(explicitUseAmbiguityCount + 1);
    });
    submitWorldCommand('drop test');
    await screen.findByText('Which one do you mean: test stone, test stone shard?');
    submitWorldCommand('put unknown item nowhere');
    await screen.findByText('Name an item you carry and a container here, for example “put stone sack”.');
    submitWorldCommand('get stone test sack');
    await screen.findByText('Which item do you mean: Smooth stone in test sack, Heavy stone in test sack?');
    submitWorldCommand('put test test sack');
    await screen.findByText('Which item and container do you mean: test stone in test sack, test stone shard in test sack?');
    const input = screen.getByRole('textbox', { name: 'Enter a command' });
    fireEvent.change(input, { target: { value: 'put bound stone test sack' } });
    fireEvent.submit(input.closest('form')!);
    await screen.findByText('Quest items cannot be put away.');
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'character.put',
    )).toBe(false);

    fireEvent.change(input, { target: { value: 'put test stone test sack' } });
    fireEvent.submit(input.closest('form')!);
    await screen.findByText('You put the test stone in the test sack.');
    const putRequest = apiFetch.mock.calls.find(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'character.put',
    );
    expect(JSON.parse(String(putRequest?.[1]?.body))).toMatchObject({
      type: 'character.put',
      payload: { itemId: fixtureItem.id, containerId: fixtureContainer.id },
    });

    const inputAfterPut = screen.getByRole('textbox', { name: 'Enter a command' });
    fireEvent.change(inputAfterPut, { target: { value: 'get test stone test sack' } });
    fireEvent.submit(inputAfterPut.closest('form')!);
    await screen.findByText('You pick up the test stone.');
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'character.take' &&
      JSON.parse(String(init?.body ?? '{}')).payload?.itemId === fixtureItem.id,
    )).toBe(true);

    failPut = true;
    const inputAfterGet = screen.getByRole('textbox', { name: 'Enter a command' });
    fireEvent.change(inputAfterGet, { target: { value: 'put test stone test sack' } });
    fireEvent.submit(inputAfterGet.closest('form')!);
    await screen.findByText('The test sack is torn.');
    expect(stored).toBe(false);
  });

  it('loots available corpse contents and skips an item taken mid-action', async () => {
    const originalFetch = apiFetch.getMockImplementation()!;
    const fixtureCorpses = [
      {
        id: 'fixture-guard-corpse',
        label: 'Fallen guard corpse',
        description: 'A guard lies still here.',
        readable: false,
        takeable: false,
        containerKind: 'corpse',
      },
      {
        id: 'fixture-scout-corpse',
        label: 'Fallen scout corpse',
        description: 'A scout lies still here.',
        readable: false,
        takeable: false,
        containerKind: 'corpse',
      },
      {
        id: 'fixture-empty-corpse',
        label: 'Empty corpse',
        description: 'An old corpse has already been stripped bare.',
        readable: false,
        takeable: false,
        containerKind: 'corpse',
      },
      {
        id: 'fixture-rusty-corpse',
        label: 'Fallen raider corpse',
        description: 'A raider lies still here.',
        readable: false,
        takeable: false,
        containerKind: 'corpse',
      },
    ];
    const fixtureContents = [
      { id: 'fixture-bronze-ring', label: 'Bronze ring', description: 'A small bronze ring.', readable: false, takeable: true, containerId: 'fixture-guard-corpse' },
      { id: 'fixture-corpse-gold', label: '3 moss marks', description: 'Coins left by the guard.', readable: false, takeable: true, containerId: 'fixture-guard-corpse' },
      { id: 'fixture-broken-arrow', label: 'Broken arrow', description: 'A snapped arrow.', readable: false, takeable: true, containerId: 'fixture-scout-corpse' },
      { id: 'fixture-scout-arrowhead', label: 'Dull arrowhead', description: 'A dull iron arrowhead.', readable: false, takeable: true, containerId: 'fixture-scout-corpse' },
      { id: 'fixture-failing-dagger', label: 'Rusty dagger', description: 'A dull dagger.', readable: false, takeable: true, containerId: 'fixture-rusty-corpse' },
    ];
    const takenItemIds = new Set<string>();
    const corpseIds = new Set(fixtureCorpses.map((corpse) => corpse.id));
    let failNextGameRefresh = false;
    let omitGuardCorpseOnNextGame = false;
    const withCorpses = (location: Record<string, unknown>, omitGuardCorpse = false) => {
      const existing = Array.isArray(location.objects)
        ? location.objects as Array<Record<string, unknown>>
        : [];
      const objects = existing.filter((object) =>
        !corpseIds.has(String(object.id)) &&
        !fixtureContents.some((item) => item.id === object.id),
      );
      const availableContents = fixtureContents.filter((item) => !takenItemIds.has(item.id));
      objects.push(
        ...fixtureCorpses.filter((corpse) =>
          !omitGuardCorpse || corpse.id !== 'fixture-guard-corpse',
        ).map((corpse) => ({
          ...corpse,
          contents: availableContents
            .filter((item) => item.containerId === corpse.id)
            .map(({ id, label, description }) => ({ id, label, description })),
        })),
        ...availableContents,
      );
      return { ...location, objects };
    };

    apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/game' && failNextGameRefresh) {
        failNextGameRefresh = false;
        throw new Error('The world could not be reached after looting.');
      }
      if (path === '/api/commands' && init?.body) {
        const command = JSON.parse(String(init.body)) as {
          type?: string;
          commandId?: string;
          payload?: { itemId?: string };
        };
        const itemId = command.payload?.itemId;
        if (command.type === 'character.take' && itemId && fixtureContents.some((item) => item.id === itemId)) {
          if (itemId === 'fixture-failing-dagger') {
            failNextGameRefresh = true;
            throw new Error('The corpse is too far away.');
          }
          takenItemIds.add(itemId);
          if (itemId === 'fixture-broken-arrow') {
            takenItemIds.add('fixture-scout-arrowhead');
          }
          revision += 1;
          return json({
            receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision },
            streamId: characterId,
          });
        }
      }
      const response = await originalFetch(path, init);
      if (path === '/api/game') {
        const snapshot = await response.json() as { location: Record<string, unknown> | null };
        const omitGuardCorpse = omitGuardCorpseOnNextGame;
        omitGuardCorpseOnNextGame = false;
        return json({
          ...snapshot,
          ...(snapshot.location ? { location: withCorpses(snapshot.location, omitGuardCorpse) } : {}),
        });
      }
      if (path === '/api/queries' && init?.body) {
        const query = JSON.parse(String(init.body)) as { type?: string };
        if (query.type === 'location.describe') {
          const result = await response.json() as { ok: boolean; value: Record<string, unknown> };
          return json({ ...result, value: withCorpses(result.value) });
        }
      }
      return response;
    });

    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('loot corpse');
    await screen.findByText(/Which corpse do you mean:/);
    const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });
    fireEvent.change(commandInput, { target: { value: 'loot fallen guard corpse' } });
    fireEvent.submit(commandInput.closest('form')!);

    await screen.findByText('You pick up the bronze ring.');
    await screen.findByText('You pick up the 3 moss marks.');
    clickQuickAction('Show corpses to loot');
    const lootMenu = screen.getByRole('group', { name: 'Corpses to loot' });
    fireEvent.click(screen.getByRole('button', { name: 'Return to quick commands' }));
    clickQuickAction('Show corpses to loot');
    fireEvent.click(within(lootMenu).getByRole('button', { name: 'Loot Fallen scout corpse' }));
    await screen.findByText('You pick up the broken arrow.');
    expect(screen.queryByText('You pick up the dull arrowhead.')).not.toBeInTheDocument();
    const history = screen.getByRole('region', { name: 'Terminal output' });
    await waitFor(() => expect(history.closest('.focused-terminal')).toHaveAttribute('aria-busy', 'false'));
    submitWorldCommand('loot empty corpse');
    await waitFor(() => expect(history).toHaveTextContent('The empty corpse has nothing left to loot.'));
    submitWorldCommand('loot fallen raider corpse');
    await screen.findByText('The corpse is too far away.');
    await screen.findByText('The world could not be reached after looting.');

    expect(history).toHaveTextContent('> loot fallen guard corpse');
    expect(history).toHaveTextContent('> loot Fallen scout corpse');
    expect([...takenItemIds]).toEqual(expect.arrayContaining([
      'fixture-bronze-ring',
      'fixture-corpse-gold',
      'fixture-broken-arrow',
    ]));
    expect(takenItemIds).not.toContain('fixture-failing-dagger');
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'character.take' &&
      JSON.parse(String(init?.body ?? '{}')).payload?.itemId === 'fixture-scout-arrowhead',
    )).toBe(false);

    await waitFor(() => expect(history.closest('.focused-terminal')).toHaveAttribute('aria-busy', 'false'));
    omitGuardCorpseOnNextGame = true;
    submitWorldCommand('loot fallen guard corpse');
    await screen.findByText('You do not see the fallen guard corpse here.');
  });

  it('inspects carried items from the Items tab and by command, including after leaving their room', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });

    fireEvent.change(commandInput, { target: { value: 'take stone' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('You pick up the loose stone.');

    await openInfoSection('Items');
    const carriedStone = screen.getByRole('button', { name: 'Inspect Loose stone' });
    expect(carriedStone).toHaveClass('focused-inventory-item--compact');
    expect(carriedStone.closest('.focused-inventory')).toHaveClass('focused-inventory--compact');
    fireEvent.click(carriedStone);
    await screen.findByText('A smooth, palm-sized stone with a pale stripe running through it.');

    fireEvent.click(screen.getByRole('link', { name: 'Play' }));
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const commandHistory = screen.getByRole('region', { name: 'Terminal output' });
    const commandInputAfterReturn = screen.getByRole('textbox', { name: 'Enter a command' });
    fireEvent.change(commandInputAfterReturn, { target: { value: 'look at stone' } });
    fireEvent.submit(commandInputAfterReturn.closest('form')!);
    await waitFor(() => expect(commandHistory).toHaveTextContent('> look at stone'));
    expect(commandHistory).toHaveTextContent('A smooth, palm-sized stone with a pale stripe running through it.');

    quickGo('north');
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    fireEvent.change(commandInputAfterReturn, { target: { value: 'look stone' } });
    fireEvent.submit(commandInputAfterReturn.closest('form')!);
    await waitFor(() => expect(commandHistory).toHaveTextContent('> look stone'));
    expect(commandHistory).toHaveTextContent('A smooth, palm-sized stone with a pale stripe running through it.');

    fireEvent.change(commandInputAfterReturn, { target: { value: 'look marker' } });
    fireEvent.submit(commandInputAfterReturn.closest('form')!);
    await screen.findByText('You do not see anything called “marker” here.');
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/queries' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'object.inspect' &&
      JSON.parse(String(init?.body ?? '{}')).payload.objectId === 'mossgate-loose-stone'
    )).toBe(true);
  });

  it('keeps the inventory visible and reports an inspection query failure', async () => {
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/queries' && init?.method === 'POST') {
        const query = JSON.parse(String(init.body)) as { type?: string };
        if (query.type === 'object.inspect') {
          return json({ ok: false, message: 'Item details are temporarily unavailable.' });
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('take loose stone');
    await screen.findByText('You pick up the loose stone.');
    await openInfoSection('Items');

    fireEvent.click(screen.getByRole('button', { name: 'Inspect Loose stone' }));

    expect(await screen.findByText('Item details are temporarily unavailable.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Inspect Loose stone' })).toBeVisible();
  });

  it('ignores repeated, modified, prevented, and input-focused movement keys', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const commandCount = apiFetch.mock.calls.filter(([path]) => path === '/api/commands').length;

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, repeat: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, altKey: true }));
    const prevented = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
    prevented.preventDefault();
    document.dispatchEvent(prevented);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Enter a command' }), { key: 'ArrowUp' });

    expect(screen.getByRole('heading', { name: 'Mossgate Clearing' })).toBeVisible();
    expect(apiFetch.mock.calls.filter(([path]) => path === '/api/commands')).toHaveLength(commandCount);
  });

  it('travels with an unmodified arrow key while the play area is focused', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const playArea = screen.getByRole('region', { name: 'Play screen' });
    const movementKey = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      bubbles: true,
      cancelable: true,
    });
    playArea.dispatchEvent(movementKey);

    expect(movementKey.defaultPrevented).toBe(true);
    expect(await screen.findByRole('heading', { name: 'Glasswater Bridge' })).toBeVisible();
  });

  it('keeps quick actions available while moving with directional controls', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    clickQuickAction('Show look targets');
    const lookTargets = screen.getByRole('group', { name: 'Things to look at' });
    expect(lookTargets).toContainElement(screen.getByRole('button', { name: 'Look around' }));
    expect(lookTargets).toContainElement(screen.getByRole('button', { name: 'Look at Weathered marker' }));
    fireEvent.click(screen.getByRole('button', { name: 'Return to quick commands' }));
    clickQuickAction('Show look targets');
    fireEvent.click(screen.getByRole('button', { name: 'Look around' }));
    await waitFor(() => expect(screen.getAllByText('> look')).toHaveLength(2));
    expect(apiFetch.mock.calls.some(([path]) => path === '/api/queries')).toBe(true);
    expect(screen.getByRole('button', { name: 'Show look targets' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show quick actions page 2' })).toBeVisible();
    clickQuickAction('Show look targets');
    fireEvent.click(screen.getByRole('button', { name: 'Look at Weathered marker' }));
    await waitFor(() => expect(history).toHaveTextContent('> look at Weathered marker'));

    fireEvent.click(screen.getByRole('button', { name: 'Show quick actions page 2' }));
    expect(screen.getByRole('group', { name: 'Quick commands, page 2' })).toBeVisible();
    const quickNavigation = screen.getByRole('navigation', { name: 'Quick navigation' });
    fireEvent.click(within(quickNavigation).getByRole('button', { name: 'North' }));
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    expect(screen.getByRole('group', { name: 'Quick commands, page 1' })).toBeVisible();
    expect(history).not.toHaveTextContent('You travel north.');
    expect(within(screen.getByRole('navigation', { name: 'Quick navigation' }))
      .getByRole('button', { name: 'South' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Show look targets' })).toBeVisible();

    const moveCommand = JSON.parse(
      apiFetch.mock.calls.find(([path]) => path === '/api/commands')?.[1].body as string,
    );
    expect(moveCommand).toMatchObject({
      type: 'character.move',
      characterId,
      expectedVersion: 1,
      payload: { exitId: 'clearing-to-bridge' },
    });

    expect(screen.getByRole('button', { name: 'Show look targets' })).toBeVisible();
  });

  it('shows contextual quick actions for supported commands and carried items', async () => {
    includeSecondTakeable = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    expect(screen.queryByText('Quick', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show look targets' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Quick help' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show readable objects' })).toBeVisible();
    expect(quickActionVisibleAnywhere('Show items to take')).toBe(true);
    expect(quickActionVisibleAnywhere('Show items to drop')).toBe(false);
    expect(quickActionVisibleAnywhere('Show items to use')).toBe(false);

    clickQuickAction('Show readable objects');
    const readableObjects = screen.getByRole('group', { name: 'Readable objects' });
    expect(readableObjects).toContainElement(screen.getByRole('button', { name: 'Read Weathered marker' }));
    fireEvent.click(screen.getByRole('button', { name: 'Return to quick commands' }));
    clickQuickAction('Show readable objects');
    fireEvent.click(screen.getByRole('button', { name: 'Read Weathered marker' }));
    await screen.findByText('OLD BELL TOWER — EAST');
    expect(history).toHaveTextContent('> read Weathered marker');

    clickQuickAction('Show items to take');
    const itemsToTake = screen.getByRole('group', { name: 'Items to take' });
    expect(itemsToTake).toContainElement(screen.getByRole('button', { name: 'Take Loose stone' }));
    expect(itemsToTake).toContainElement(screen.getByRole('button', { name: 'Take all available items' }));

    fireEvent.click(screen.getByRole('button', { name: 'Return to quick commands' }));
    clickQuickAction('Show items to take');
    fireEvent.click(screen.getByRole('button', { name: 'Take Loose stone' }));
    await screen.findByText('You pick up the loose stone.');
    expect(screen.queryByRole('button', { name: 'Take Loose stone' })).not.toBeInTheDocument();
    expect(quickActionVisibleAnywhere('Show items to take')).toBe(true);
    clickQuickAction('Show items to take');
    fireEvent.click(screen.getByRole('button', { name: 'Take Lost feather' }));
    await screen.findByText('You pick up the lost feather.');
    expect(screen.queryByRole('button', { name: 'Take all available items' })).not.toBeInTheDocument();
    expect(quickActionVisibleAnywhere('Show items to take')).toBe(false);
    expect(quickActionVisibleAnywhere('Show items to drop')).toBe(true);

    clickQuickAction('Show look targets');
    const updatedLookTargets = screen.getByRole('group', { name: 'Things to look at' });
    expect(updatedLookTargets).toContainElement(screen.getByRole('button', { name: 'Look at Weathered marker' }));
    expect(screen.queryByRole('button', { name: 'Look at Loose stone' })).not.toBeInTheDocument();
    const terminalEntriesBeforeLook = history.querySelectorAll('li').length;
    fireEvent.click(screen.getByRole('button', { name: 'Look around' }));
    await waitFor(() => {
      expect(history).toHaveTextContent(
        'A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east.',
      );
    });
    const lookOutput = Array.from(history.querySelectorAll('li'))
      .slice(terminalEntriesBeforeLook)
      .map((entry) => entry.textContent)
      .join(' ');
    expect(lookOutput).not.toContain('One loose stone bears a pale stripe.');

    clickQuickAction('Show items to drop');
    const itemsToDrop = screen.getByRole('group', { name: 'Items to drop' });
    expect(itemsToDrop).toContainElement(screen.getByRole('button', { name: 'Drop Lost feather' }));
    expect(screen.queryByRole('button', { name: 'Drop Loose stone' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Return to quick commands' }));
    clickQuickAction('Show items to drop');
    fireEvent.click(screen.getByRole('button', { name: 'Drop Lost feather' }));
    await screen.findByText('You put down the lost feather.');
    expect(quickActionVisibleAnywhere('Show items to drop')).toBe(false);
    expect(quickActionVisibleAnywhere('Show items to take')).toBe(true);
  });

  it('offers Take all only while room items remain and picks up every room item', async () => {
    includeSecondTakeable = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    clickQuickAction('Show items to take');
    const itemsToTake = screen.getByRole('group', { name: 'Items to take' });
    expect(itemsToTake).toContainElement(screen.getByRole('button', { name: 'Take Loose stone' }));
    expect(itemsToTake).toContainElement(screen.getByRole('button', { name: 'Take Lost feather' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take all available items' }));

    await waitFor(() => expect(history).toHaveTextContent('You pick up the loose stone.'));
    await waitFor(() => expect(history).toHaveTextContent('You pick up the lost feather.'));
    expect(history).toHaveTextContent('> take all');
    expect(quickActionVisibleAnywhere('Show items to take')).toBe(false);

    const takeCommands = apiFetch.mock.calls
      .filter(([path, init]) => path === '/api/commands' &&
        JSON.parse(String(init?.body ?? '{}')).type === 'character.take')
      .map(([, init]) => JSON.parse(String(init?.body ?? '{}')) as {
        expectedVersion: number;
        payload: { itemId: string };
      });
    expect(takeCommands).toHaveLength(2);
    expect(takeCommands.map((entry) => entry.payload.itemId)).toEqual([
      'mossgate-loose-stone',
      'mossgate-lost-feather',
    ]);
    expect(takeCommands.map((entry) => entry.expectedVersion)).toEqual([1, 2]);

  });

  it('keeps the last successful map snapshot after a journey is rejected', async () => {
    room = 'market';
    visitedLocationIds = ['mossgate-clearing', 'glasswater-bridge', 'reedbank-stalls'];
    moveError = 'Exit is blocked.';
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Reedbank Stalls' });

    const map = screen.getByRole('region', { name: 'World map' });
    const visitedRooms = () =>
      [...map.querySelectorAll<SVGGElement>('.focused-world-map__location')]
        .map((location) => location.querySelector('title')?.textContent);
    expect(visitedRooms()).toEqual([
      'Mossgate Clearing',
      'Glasswater Bridge',
      'Reedbank Stalls',
    ]);
    expect(map.querySelectorAll('.focused-world-map__path')).toHaveLength(2);
    expect(within(map).getByRole('button', { name: 'Focus Reedbank Stalls on map, current location' })).toHaveAttribute('aria-current', 'location');

    quickGo('east');
    await screen.findByText('Exit is blocked.');
    expect(screen.getByRole('heading', { name: 'Reedbank Stalls' })).toBeVisible();
    expect(within(screen.getByRole('navigation', { name: 'Quick navigation' }))
      .getByRole('button', { name: 'East' })).toBeEnabled();
    expect(visitedRooms()).toEqual([
      'Mossgate Clearing',
      'Glasswater Bridge',
      'Reedbank Stalls',
    ]);
    expect(map).not.toHaveTextContent('Willowrest Inn');
    expect(map.querySelectorAll('.focused-world-map__path')).toHaveLength(2);
    expect(within(map).getByRole('button', { name: 'Focus Reedbank Stalls on map, current location' })).toHaveAttribute('aria-current', 'location');
    const attemptedMove = apiFetch.mock.calls
      .filter(([path]) => path === '/api/commands')
      .map(([, init]) => JSON.parse(String(init?.body ?? '{}')) as {
        type: string;
        payload: { exitId?: string };
      })
      .find((command) => command.type === 'character.move');
    expect(attemptedMove).toMatchObject({
      type: 'character.move',
      payload: { exitId: 'reedbank-to-willowrest' },
    });
  });

  it('shows the wallet using the active world currency', async () => {
    worldCurrency = { id: 'gold', name: 'gold piece', symbol: 'g' };
    walletBalance = 0;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    expect(screen.getByRole('group', { name: 'Character currency balance: 0 gold piece' })).toHaveTextContent('0 g');
    fireEvent.click(screen.getByRole('link', { name: 'Info' }));
    await screen.findByRole('heading', { name: 'Vitals' });
    expect(screen.getByText('0 gold pieces')).toBeVisible();
  });

  it('omits the currency vital when the active world has no currency', async () => {
    worldCurrency = undefined;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    expect(screen.queryByRole('group', { name: /Character currency balance/ })).not.toBeInTheDocument();
  });

  it('defaults to dark and persists the selected theme', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    expect(screen.getByRole('main')).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem('mudd-theme')).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem('mudd-theme')).toBe('light');
  });

  it('restores a previously saved light theme', async () => {
    window.localStorage.setItem('mudd-theme', 'light');
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    expect(screen.getByRole('main')).toHaveAttribute('data-theme', 'light');
  });

  it('responds to browser back/forward when changing gameplay screens', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    await openInfoSection('Vitals');
    act(() => {
      window.location.hash = '#/play';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
  });

  it('requires explicit confirmation for one-time class adoption and renders the recorded identity', async () => {
    const commands = classApiFixture();
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    await openInfoSection('Stats');
    expect(await screen.findByRole('heading', { name: 'Choose your class' })).toBeVisible();
    const choose = screen.getByRole('button', { name: 'Adopt this class' });
    expect(choose).toBeDisabled();
    fireEvent.click(screen.getByRole('radio'));
    fireEvent.click(choose);
    expect(commands).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm permanent choice' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Adopt this class' })).not.toBeInTheDocument());
    expect(commands[0]).toMatchObject({ type: 'character.class.choose', payload: { classId: 'fixture.vanguard' } });
    expect(await screen.findByRole('heading', { name: 'Class · Vanguard' })).toBeVisible();
  });

  it('reports class-adoption failures without recording a class', async () => {
    classApiFixture(false, false, false, true);
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    await openInfoSection('Stats');
    await screen.findByRole('heading', { name: 'Choose your class' });
    fireEvent.click(screen.getByRole('radio'));
    fireEvent.click(screen.getByRole('button', { name: 'Adopt this class' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Confirm permanent choice' }));

    fireEvent.click(screen.getByRole('link', { name: 'Play' }));
    expect(await screen.findByText('Class adoption is temporarily unavailable.')).toBeVisible();
    await openInfoSection('Stats');
    expect(screen.getByRole('heading', { name: 'Choose your class' })).toBeVisible();
  });

  it('shows a recovery message when class choices fail to load', async () => {
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/worlds') return Promise.reject(new Error('Network unavailable.'));
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    await openInfoSection('Stats');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Class choices could not be loaded. Reconnect or reload to try again.',
    );
  });

  it.each(['solo', 'team'] as const)('routes %s class actions correctly after a completed PvP duel, keeping the terminal hidden', async (mode) => {
    const commands = classApiFixture(true, true);
    combatEncounter = {
      encounterId: 'class-encounter', locationId: 'mossgate-clearing',
      opponentNpcId: 'mossgate-training-sentinel', opponentName: 'Practice Sentinel',
      round: 1, playerHealth: 6, playerMaxHealth: 6, opponentHealth: 6, opponentMaxHealth: 6,
      status: 'active', lastAction: 'attack', lastNarration: 'The practice continues.',
    };
    if (mode === 'team') {
      combatEncounter = null;
      await apiFetch('/api/commands', { method: 'POST', body: JSON.stringify({
        type: 'team.combat.start', payload: { targetNpcId: 'mossgate-training-sentinel' },
      }) });
    }
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByText('The earlier duel is finished.');
    const use = await screen.findByRole('button', { name: 'Use Heavy Strike' });
    expect(screen.queryByRole('textbox', { name: /command/i })).not.toBeInTheDocument();
    fireEvent.click(use);
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({ type: mode === 'solo' ? 'combat.action' : 'team.combat.action', payload: {
      action: 'ability', encounterId: mode === 'solo' ? 'class-encounter' : 'team-combat-ui-encounter', abilityId: 'fixture.heavy-strike',
    } });
  });

  it('reports class-action failures while keeping the combat action available', async () => {
    classApiFixture(true, true, true);
    combatEncounter = {
      encounterId: 'class-encounter',
      locationId: 'mossgate-clearing',
      opponentNpcId: 'mossgate-training-sentinel',
      opponentName: 'Practice Sentinel',
      round: 1,
      playerHealth: 6,
      playerMaxHealth: 6,
      opponentHealth: 6,
      opponentMaxHealth: 6,
      status: 'active',
      lastAction: 'attack',
      lastNarration: 'The practice continues.',
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByText('The earlier duel is finished.');

    fireEvent.click(await screen.findByRole('button', { name: 'Use Heavy Strike' }));

    expect(await screen.findByText('Heavy Strike cannot be used right now.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Use Heavy Strike' })).toBeEnabled();
  });

  it('reports when a merchant catalog cannot be loaded', async () => {
    room = 'market';
    visitedLocationIds = ['mossgate-clearing', 'glasswater-bridge', 'reedbank-stalls'];
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/queries' && init?.method === 'POST') {
        const query = JSON.parse(String(init.body)) as { type?: string };
        if (query.type === 'merchant.catalog') {
          return json({ ok: false, message: 'Sella’s catalog is temporarily unavailable.' });
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Reedbank Stalls' });
    clickQuickAction('Show merchants');
    fireEvent.click(screen.getByRole('button', { name: 'Shop with Sella' }));

    expect(await screen.findByText('Sella’s catalog is temporarily unavailable.')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Sella shop catalog' })).not.toBeInTheDocument();
  });

  it('keeps the merchant catalog open and shows a purchase failure', async () => {
    room = 'market';
    visitedLocationIds = ['mossgate-clearing', 'glasswater-bridge', 'reedbank-stalls'];
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'merchant.purchase') {
          return json({ message: 'The lantern cannot be purchased right now.' }, 503);
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Reedbank Stalls' });
    clickQuickAction('Show merchants');
    fireEvent.click(screen.getByRole('button', { name: 'Shop with Sella' }));
    await screen.findByRole('region', { name: 'Sella shop catalog' });

    fireEvent.click(screen.getByRole('button', { name: 'Buy Brass lantern for 8 moss mark' }));

    expect(await screen.findByText('The lantern cannot be purchased right now.')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Sella shop catalog' })).toBeVisible();
  });

  it('browses and buys merchant goods from the terminal catalog', async () => {
    room = 'market';
    visitedLocationIds = ['mossgate-clearing', 'glasswater-bridge', 'reedbank-stalls'];
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Reedbank Stalls' });
    expect(quickActionVisibleAnywhere('Show merchants')).toBe(true);
    expect(quickActionVisibleAnywhere('Show items to buy')).toBe(false);

    clickQuickAction('Show merchants');
    fireEvent.click(screen.getByRole('button', { name: 'Return to quick commands' }));
    clickQuickAction('Show merchants');
    fireEvent.click(screen.getByRole('button', { name: 'Shop with Sella' }));
    await screen.findByRole('region', { name: 'Sella shop catalog' });
    expect(screen.getByText('Balance: 12 moss mark')).toBeVisible();
    expect(quickActionVisibleAnywhere('Show items to buy')).toBe(true);
    submitWorldCommand('buy unknown');
    await screen.findByText('The open catalog has no item called “unknown”.');
    submitWorldCommand('buy r');
    await screen.findByText('Which item do you mean: Brass lantern, Waxed cord?');

    clickQuickAction('Show items to buy');
    fireEvent.click(screen.getByRole('button', { name: 'Return to quick commands' }));
    clickQuickAction('Show items to buy');
    fireEvent.click(screen.getByRole('button', { name: 'Buy Brass lantern for 8 moss mark' }));
    await screen.findByRole('button', { name: 'Purchased Brass lantern for 8 moss mark' });
    expect(screen.getByText('Balance: 4 moss mark')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Terminal output' })).toHaveTextContent(
      'You buy the brass lantern for 8 moss marks.',
    );
    expect(quickActionVisibleAnywhere('Show items to buy')).toBe(false);
    const purchaseRequest = apiFetch.mock.calls.find(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'merchant.purchase',
    );
    expect(JSON.parse(String(purchaseRequest?.[1].body ?? '{}')).payload).toEqual({
      merchantNpcId: 'sella-reedbank-merchant',
      listingId: 'reedbank-brass-lantern',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close merchant catalog' }));
    expect(screen.queryByRole('region', { name: 'Sella shop catalog' })).not.toBeInTheDocument();
  });

  it('buys a catalog listing from the contextual quick-action list', async () => {
    room = 'market';
    visitedLocationIds = ['mossgate-clearing', 'glasswater-bridge', 'reedbank-stalls'];
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Reedbank Stalls' });
    clickQuickAction('Show merchants');
    fireEvent.click(screen.getByRole('button', { name: 'Shop with Sella' }));
    await screen.findByRole('region', { name: 'Sella shop catalog' });

    clickQuickAction('Show items to buy');
    fireEvent.click(screen.getByRole('button', { name: 'Buy Brass lantern' }));

    expect(await screen.findByRole('button', { name: 'Purchased Brass lantern for 8 moss mark' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Terminal output' })).toHaveTextContent(
      'You buy the brass lantern for 8 moss marks.',
    );
  });

  it('browses a daily board and accepts and delivers postings from terminal commands', async () => {
    dailyFeatureEnabled = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('read bulletin');

    const board = await screen.findByRole('region', { name: 'Reedbank Bulletin' });
    expect(board).toHaveTextContent('Sella');
    expect(board).toHaveTextContent('Bring river mint');
    expect(board).toHaveTextContent('river-mint: 0/1 carried');
    expect(board).toHaveTextContent('15 gold · 9 XP');
    const terminal = screen.getByRole('region', { name: 'Terminal output' });
    expect(terminal).toHaveTextContent('> read bulletin');
    expect(terminal).toHaveTextContent('Resets at');
    expect(terminal).toHaveTextContent('Sella: Bring river mint.');

    submitWorldCommand('jobs accept river-mint-delivery');
    await screen.findByText('In progress');
    submitWorldCommand('jobs deliver river-mint-delivery');
    await screen.findByText(/Delivered “Bring river mint” for 15 gold and 9 XP/);
    await screen.findByText('Complete');
    expect(dailyCommandPayloads).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'daily.job', payload: expect.objectContaining({ action: 'accept', cycle: '2026-10-23' }) }),
      expect.objectContaining({ type: 'daily.job', payload: expect.objectContaining({ action: 'deliver', cycle: '2026-10-23' }) }),
    ]));
  });

  it('uses the posting reward when the delivery event omits reward totals', async () => {
    dailyFeatureEnabled = true;
    omitDailyRewardTotals = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('read bulletin');
    await screen.findByRole('region', { name: 'Reedbank Bulletin' });

    submitWorldCommand('jobs accept river-mint-delivery');
    await screen.findByText('In progress');
    submitWorldCommand('jobs deliver river-mint-delivery');

    expect(await screen.findByText(/Delivered “Bring river mint” for 15 gold and 9 XP/)).toBeVisible();
  });

  it('keeps a daily posting available when its acceptance request fails', async () => {
    dailyFeatureEnabled = true;
    const original = apiFetch.getMockImplementation()!;
    let acceptAttempts = 0;
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/commands' && init?.body) {
        const command = JSON.parse(String(init.body)) as { type?: string; commandId?: string };
        if (command.type === 'daily.job') {
          acceptAttempts += 1;
          throw new Error('This posting is no longer available.');
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('read bulletin');
    const board = await screen.findByRole('region', { name: 'Reedbank Bulletin' });

    fireEvent.click(within(board).getByRole('button', { name: 'Accept' }));

    const terminal = screen.getByRole('region', { name: 'Terminal output' });
    await waitFor(() => expect(terminal).toHaveTextContent('This posting is no longer available.'));
    expect(within(board).getByRole('button', { name: 'Accept' })).toBeEnabled();
    expect(dailyJobStatus).toBe('available');
    expect(acceptAttempts).toBe(1);
  });

  it('lists the bulletin in read quick actions and supports accepting and delivering jobs', async () => {
    dailyFeatureEnabled = true;
    bulletinReadableObject = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    clickQuickAction('Show readable objects');
    const readableObjects = screen.getByRole('group', { name: 'Readable objects' });
    expect(within(readableObjects).getByRole('button', { name: 'Read bulletin' })).toBeVisible();
    expect(within(readableObjects).queryByRole('button', { name: 'Read Bulletin board' })).not.toBeInTheDocument();
    clickQuickAction('Read bulletin');
    await waitFor(() => expect(dailyBoardQueryCount).toBe(1));
    const board = await screen.findByRole('region', { name: 'Reedbank Bulletin' });
    fireEvent.click(within(board).getByRole('button', { name: 'Accept' }));
    await screen.findByText('In progress');
    fireEvent.click(within(board).getByRole('button', { name: 'Deliver' }));
    await screen.findByText('Complete');
    expect(screen.getByRole('region', { name: 'Terminal output' })).toHaveTextContent('15 gold and 9 XP');
    fireEvent.click(within(board).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: 'Reedbank Bulletin' })).not.toBeInTheDocument();
  });

  it('clears the board after leaving and does not query it while gathering elsewhere', async () => {
    dailyFeatureEnabled = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('jobs');
    await screen.findByRole('region', { name: 'Reedbank Bulletin' });
    expect(dailyBoardQueryCount).toBe(1);

    quickGo('north');
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    expect(screen.queryByRole('region', { name: 'Reedbank Bulletin' })).not.toBeInTheDocument();
    submitWorldCommand('gather fishing pools');
    await screen.findByText('Gathered supplies at Glasswater fishing pools.');
    expect(dailyBoardQueryCount).toBe(1);
    expect(dailyCommandPayloads).toContainEqual(expect.objectContaining({ type: 'supply.gather' }));
    expect(screen.getByRole('region', { name: 'Terminal output' })).not.toHaveTextContent('could not gather');
    expect(screen.queryByText(/That bulletin is not available/)).not.toBeInTheDocument();
  });

  it('does not reopen a bulletin response after the player travels away', async () => {
    dailyFeatureEnabled = true;
    const original = apiFetch.getMockImplementation()!;
    let releaseBoard: (() => void) | undefined;
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/queries' && init?.body) {
        const query = JSON.parse(String(init.body)) as { type?: string };
        if (query.type === 'daily.board') {
          const response = await original(path, init);
          return new Promise<Response>((resolve) => {
            releaseBoard = () => resolve(response);
          });
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('read bulletin');
    await waitFor(() => expect(releaseBoard).toBeTypeOf('function'));

    quickGo('north');
    expect(await screen.findByRole('heading', { name: 'Glasswater Bridge' })).toBeVisible();
    await act(async () => {
      releaseBoard?.();
    });

    expect(screen.queryByRole('region', { name: 'Reedbank Bulletin' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Terminal output' })).not.toHaveTextContent('Reedbank Bulletin');
    expect(dailyBoardQueryCount).toBe(1);
  });

  it('refreshes the open bulletin when its reset time arrives', async () => {
    dailyFeatureEnabled = true;
    const original = apiFetch.getMockImplementation()!;
    let boardRequests = 0;
    apiFetch.mockImplementation(async (path, init) => {
      const response = await original(path, init);
      if (path === '/api/queries' && init?.body) {
        const query = JSON.parse(String(init.body)) as { type?: string };
        if (query.type === 'daily.board') {
          boardRequests += 1;
          const result = await response.json() as {
            value: Record<string, unknown> & { resetsAt?: string };
          };
          if (boardRequests === 1) {
            return json({
              ...result,
              value: { ...result.value, resetsAt: new Date(Date.now() + 20).toISOString() },
            });
          }
          return json(result);
        }
      }
      return response;
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('read bulletin');
    await screen.findByRole('region', { name: 'Reedbank Bulletin' });

    await waitFor(() => expect(boardRequests).toBeGreaterThan(1), { timeout: 2_000 });
  });

  it('reports a bulletin loading error without opening a broken board', async () => {
    dailyFeatureEnabled = true;
    const original = apiFetch.getMockImplementation()!;
    let failOnce = true;
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/queries' && init?.body) {
        const query = JSON.parse(String(init.body)) as { type?: string };
        if (query.type === 'daily.board' && failOnce) {
          failOnce = false;
          dailyBoardQueryCount += 1;
          return json({ ok: false, message: 'The bulletin is temporarily unavailable.' });
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('read bulletin');

    const board = await screen.findByRole('region', { name: 'Reedbank Bulletin' });
    expect(within(board).getByRole('alert')).toHaveTextContent('The bulletin is temporarily unavailable.');
    fireEvent.click(within(board).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(dailyBoardQueryCount).toBe(2));
    expect(await within(board).findByText('Bring river mint')).toBeVisible();
    expect(within(board).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps a successful supply gather when refreshing its bulletin fails', async () => {
    dailyFeatureEnabled = true;
    dailySourceAtBoard = true;
    failDailyBoardRefreshAfterFirst = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('read bulletin');
    await screen.findByRole('region', { name: 'Reedbank Bulletin' });

    submitWorldCommand('gather Mossgate spring');

    expect(await screen.findByText('Gathered supplies at Mossgate spring.')).toBeVisible();
    await waitFor(() => expect(dailyBoardQueryCount).toBe(2));
    expect(dailyCommandPayloads).toContainEqual(expect.objectContaining({ type: 'supply.gather' }));
    expect(screen.getByRole('region', { name: 'Terminal output' })).not.toHaveTextContent('could not gather');
  });

  it('asks which fishing rod to use when multiple carried rods match', async () => {
    fishingRodCarried = true;
    secondFishingRodCarried = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('use rod');

    expect(await screen.findByText('Which item do you mean: old rod, old rod?')).toBeVisible();
    const firstAmbiguityCount = screen.getAllByText('Which item do you mean: old rod, old rod?').length;
    submitWorldCommand('use fishingrod');
    await waitFor(() => {
      expect(screen.getAllByText('Which item do you mean: old rod, old rod?')).toHaveLength(firstAmbiguityCount + 1);
    });
  });

  it('offers a carried fishing rod as a quick action at a fishing spot', async () => {
    room = 'bridge';
    fishingRodCarried = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    fireEvent.click(await screen.findByRole('button', { name: 'Show items to use' }));
    expect(await screen.findByRole('button', { name: 'Use old rod to fish at Glasswater Bridge' })).toBeInTheDocument();
  });

  it('uses a carried fishing rod when selected from its room-description action dialog', async () => {
    room = 'bridge';
    fishingRodCarried = true;
    currentRoomMentionsInventory = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });

    fireEvent.click(await screen.findByRole('button', { name: 'Choose an action for old rod in terminal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose an action for old rod' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use' }));

    expect(await screen.findByText('You cast your line and wait...')).toBeVisible();
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body)).type === 'fishing.cast',
    )).toBe(true);
  });

  it('starts fishing with the use rod terminal command', async () => {
    room = 'bridge';
    fishingRodCarried = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    submitWorldCommand('use old rod');

    expect(await screen.findByText('You cast your line and wait...')).toBeVisible();
  });

  it.each([
    {
      events: [{ type: 'character.woodcutting_action_advanced' }],
      narration: 'You lower your axe, cast your line, and wait...',
    },
    {
      events: [{ type: 'character.fishing_cast_advanced' }],
      narration: 'You reel in your line, cast again, and wait...',
    },
    {
      events: [],
      narration: 'You cast your line and wait...',
    },
  ])('starts a fishing cast and narrates interrupted work', async ({ events, narration }) => {
    room = 'bridge';
    fishingRodCarried = true;
    fishingCastEvents = events;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    clickQuickAction('Show items to use');
    fireEvent.click(await screen.findByRole('button', { name: 'Use old rod to fish at Glasswater Bridge' }));

    expect(await screen.findByText(narration)).toBeVisible();
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'fishing.cast'
    )).toBe(true);
  });

  it('keeps the fishing action available when the server rejects a cast', async () => {
    room = 'bridge';
    fishingRodCarried = true;
    fishingCastStartFailure = 'The water is too shallow.';
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    clickQuickAction('Show items to use');
    const startButton = await screen.findByRole('button', { name: 'Use old rod to fish at Glasswater Bridge' });
    fireEvent.click(startButton);

    await waitFor(() => expect(fishingCastStartAttempts).toBe(1));
    expect(await screen.findByRole('button', { name: 'Use old rod to fish at Glasswater Bridge' })).toBeEnabled();
    expect(activeFishingCastState).toBeNull();
  });

  it.each([
    {
      payload: {
        status: 'caught',
        item: {
          label: 'River trout',
          fishCatch: { lengthCm: 35, weightGrams: 420, rarity: 'rare' },
        },
      },
      messages: ['You caught a River trout!', 'Rare catch: 35 cm, 420 g.'],
    },
    {
      payload: { status: 'caught', item: { label: 'River trout' } },
      messages: ['You caught a River trout!'],
    },
    { payload: { status: 'no-bite' }, messages: ['No bites. You reel in your line.'] },
    { payload: { status: 'interrupted' }, messages: ['Your fishing is interrupted. You reel in your line.'] },
    { payload: undefined, messages: [] },
  ])('renders the result of a timed fishing tick', async ({ payload, messages }) => {
    room = 'bridge';
    activeFishingCastState = {
      castId: 'test-fishing-cast',
      spotId: 'glasswater-fishing-spot',
      locationId: 'glasswater-bridge',
      rodItemId: 'old-rod',
      rodQualityId: 'old',
      startedAt: '2000-01-01T00:00:00.000Z',
      tickIntervalSeconds: 1,
      ticksRequired: 10,
      ticksCompleted: 0,
    };
    fishingAdvanceEvents = [{ type: 'character.fishing_cast_advanced', payload }];
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    await waitFor(() => expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'fishing.advance'
    )).toBe(true));

    for (const message of messages) {
      expect(await screen.findByText(message)).toBeVisible();
    }
    if (messages.length === 0) {
      expect(screen.queryByText(/You caught a|No bites|fishing is interrupted/)).not.toBeInTheDocument();
    }
  });

  it.each([
    {
      error: 'The line is still in the water.',
      payload: { status: 'no-bite' },
      outcome: 'No bites. You reel in your line.',
    },
    {
      error: 'The current interrupted the request.',
      payload: { status: 'interrupted' },
      outcome: 'Your fishing is interrupted. You reel in your line.',
    },
  ])('recovers from a transient fishing tick error', async ({ error, payload, outcome }) => {
    room = 'bridge';
    activeFishingCastState = {
      castId: 'test-fishing-cast',
      spotId: 'glasswater-fishing-spot',
      locationId: 'glasswater-bridge',
      rodItemId: 'old-rod',
      rodQualityId: 'old',
      startedAt: '2000-01-01T00:00:00.000Z',
      tickIntervalSeconds: 1,
      ticksRequired: 10,
      ticksCompleted: 0,
    };
    fishingAdvanceError = error;
    fishingAdvanceEvents = [{ type: 'character.fishing_cast_advanced', payload }];
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    await screen.findByRole('region', { name: 'Fishing in progress' });
    expect(await screen.findByText(outcome, {}, { timeout: 10_000 })).toBeVisible();
    await waitFor(() => {
      const attempts = apiFetch.mock.calls.filter(([path, init]) =>
        path === '/api/commands' &&
        JSON.parse(String(init?.body ?? '{}')).type === 'fishing.advance'
      );
      expect(attempts.length).toBeGreaterThanOrEqual(2);
    }, { timeout: 10_000 });
  });

  it('does not start overlapping fishing ticks while a tick is unresolved', async () => {
    room = 'bridge';
    activeFishingCastState = {
      castId: 'single-flight-fishing-cast',
      spotId: 'glasswater-fishing-spot',
      locationId: 'glasswater-bridge',
      rodItemId: 'old-rod',
      rodQualityId: 'old',
      startedAt: '2000-01-01T00:00:00.000Z',
      tickIntervalSeconds: 1,
      ticksRequired: 10,
      ticksCompleted: 0,
    };
    const original = apiFetch.getMockImplementation()!;
    let releaseAdvance: ((response: Response) => void) | undefined;
    let attempts = 0;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'fishing.advance') {
          attempts += 1;
          return new Promise<Response>((resolve) => { releaseAdvance = resolve; });
        }
      }
      return original(path, init);
    });
    const view = render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('region', { name: 'Fishing in progress' });
    await waitFor(() => expect(attempts).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(attempts).toBe(1);

    activeFishingCastState = null;
    revision += 1;
    await act(async () => {
      releaseAdvance?.(json({
        receipt: { ok: true, commandId: 'mock-command', eventIds: [], newAggregateVersion: revision },
        streamId: characterId,
        events: [{ type: 'character.fishing_cast_advanced', payload: { status: 'no-bite' } }],
      }));
    });
    view.unmount();
  });

  it('reconciles a fishing stop when the cast already ended on the server', async () => {
    room = 'bridge';
    activeFishingCastState = {
      castId: 'already-ended-fishing-cast',
      spotId: 'glasswater-fishing-spot',
      locationId: 'glasswater-bridge',
      rodItemId: 'old-rod',
      rodQualityId: 'old',
      startedAt: new Date().toISOString(),
      tickIntervalSeconds: 1,
      ticksRequired: 10,
      ticksCompleted: 0,
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    const activity = await screen.findByRole('region', { name: 'Fishing in progress' });
    activeFishingCastState = null;
    fireEvent.click(within(activity).getByRole('button', { name: 'Stop' }));

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Fishing in progress' })).not.toBeInTheDocument());
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'fishing.cancel',
    )).toBe(false);
  });

  it('cancels a live fishing cast and reports that the line was reeled in', async () => {
    room = 'bridge';
    activeFishingCastState = {
      castId: 'test-fishing-cast',
      spotId: 'glasswater-fishing-spot',
      locationId: 'glasswater-bridge',
      rodItemId: 'old-rod',
      rodQualityId: 'old',
      startedAt: new Date(Date.now() + 60_000).toISOString(),
      tickIntervalSeconds: 10,
      ticksRequired: 10,
      ticksCompleted: 1,
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    const stopButton = await screen.findByRole('button', { name: 'Stop' });
    await waitFor(() => expect(stopButton).toBeEnabled());
    fireEvent.click(stopButton);

    await waitFor(() => expect(fishingCancelAttempts).toBe(1), { timeout: 5_000 });
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Fishing in progress' })).not.toBeInTheDocument()
    );
    expect(activeFishingCastState).toBeNull();
  });

  it('preserves an active fishing cast when the server rejects stopping it', async () => {
    room = 'bridge';
    fishingCancelFailure = 'The current is too strong to reel in.';
    activeFishingCastState = {
      castId: 'test-fishing-cast',
      spotId: 'glasswater-fishing-spot',
      locationId: 'glasswater-bridge',
      rodItemId: 'old-rod',
      rodQualityId: 'old',
      startedAt: new Date(Date.now() + 60_000).toISOString(),
      tickIntervalSeconds: 10,
      ticksRequired: 10,
      ticksCompleted: 1,
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));

    await waitFor(() => expect(fishingCancelAttempts).toBe(1));
    expect(screen.getByRole('region', { name: 'Fishing in progress' })).toBeInTheDocument();
    expect(activeFishingCastState?.castId).toBe('test-fishing-cast');
  });

  it('refreshes a conflicted fishing cast and retries cancellation once', async () => {
    room = 'bridge';
    const original = apiFetch.getMockImplementation()!;
    let cancelAttempts = 0;
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'fishing.cancel') {
          cancelAttempts += 1;
          if (cancelAttempts === 1) {
            return json({ message: 'Revision conflict while stopping the cast.' }, 409);
          }
        }
      }
      return original(path, init);
    });
    activeFishingCastState = {
      castId: 'test-fishing-cast',
      spotId: 'glasswater-fishing-spot',
      locationId: 'glasswater-bridge',
      rodItemId: 'old-rod',
      rodQualityId: 'old',
      startedAt: new Date(Date.now() + 60_000).toISOString(),
      tickIntervalSeconds: 10,
      ticksRequired: 10,
      ticksCompleted: 1,
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));

    await waitFor(() => expect(cancelAttempts).toBe(2));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Fishing in progress' })).not.toBeInTheDocument()
    );
    expect(activeFishingCastState).toBeNull();
    expect(await screen.findByText('You reel in your line and stop fishing.')).toBeVisible();
  });

  it('keeps the fishing cast visible when the retry after a conflict is rejected', async () => {
    room = 'bridge';
    const original = apiFetch.getMockImplementation()!;
    let cancelAttempts = 0;
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'fishing.cancel') {
          cancelAttempts += 1;
          if (cancelAttempts === 1) {
            return json({ message: 'Revision conflict while stopping the cast.' }, 409);
          }
          throw new Error('The line is too tangled to reel in.');
        }
      }
      return original(path, init);
    });
    activeFishingCastState = {
      castId: 'test-fishing-cast',
      spotId: 'glasswater-fishing-spot',
      locationId: 'glasswater-bridge',
      rodItemId: 'old-rod',
      rodQualityId: 'old',
      startedAt: new Date(Date.now() + 60_000).toISOString(),
      tickIntervalSeconds: 10,
      ticksRequired: 10,
      ticksCompleted: 1,
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));

    expect(await screen.findByText('The line is too tangled to reel in.')).toBeVisible();
    expect(cancelAttempts).toBe(2);
    expect(screen.getByRole('region', { name: 'Fishing in progress' })).toBeInTheDocument();
    expect(activeFishingCastState?.castId).toBe('test-fishing-cast');
  });

  it('refreshes state instead of cancelling a fishing cast that already ended', async () => {
    room = 'bridge';
    activeFishingCastState = {
      castId: 'test-fishing-cast',
      spotId: 'glasswater-fishing-spot',
      locationId: 'glasswater-bridge',
      rodItemId: 'old-rod',
      rodQualityId: 'old',
      startedAt: new Date(Date.now() + 60_000).toISOString(),
      tickIntervalSeconds: 10,
      ticksRequired: 10,
      ticksCompleted: 1,
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    activeFishingCastState = null;

    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Fishing in progress' })).not.toBeInTheDocument()
    );
    expect(fishingCancelAttempts).toBe(0);
    expect(screen.queryByText('You reel in your line and stop fishing.')).not.toBeInTheDocument();
  });

  it('lets the player choose which in-room tree to chop from quick actions', async () => {
    woodcuttingAxeCarried = true;
    availableWoodcuttingTrees = [
      { id: 'southbound-pine', label: 'pine' },
      { id: 'southbound-oak', label: 'oak' },
    ];
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    clickQuickAction('Show items to use');
    fireEvent.click(screen.getByRole('button', { name: 'Return to quick commands' }));
    clickQuickAction('Show items to use');
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a tree for Copper Axe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Return to items to use' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose a tree for Copper Axe' }));

    const treeChoices = await screen.findByRole('group', { name: 'Choose a tree' });
    expect(within(treeChoices).getByRole('button', { name: 'Use Copper Axe on pine' })).toBeInTheDocument();
    expect(within(treeChoices).getByRole('button', { name: 'Use Copper Axe on oak' })).toBeInTheDocument();
    fireEvent.click(within(treeChoices).getByRole('button', { name: 'Use Copper Axe on pine' }));

    await screen.findByText('You begin swinging your axe at the tree...');
    const startCommand = apiFetch.mock.calls.find(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body)).type === 'woodcutting.start',
    );
    expect(startCommand).toBeDefined();
    expect(JSON.parse(String(startCommand?.[1]?.body))).toMatchObject({
      payload: { axeItemId: 'copper-axe', treeId: 'southbound-pine' },
    });
  });

  it('shows a woodcutting start failure and restores the action control', async () => {
    woodcuttingAxeCarried = true;
    availableWoodcuttingTrees = [{ id: 'southbound-pine', label: 'pine' }];
    woodcuttingStartError = 'The pine is too wet to chop.';
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    clickQuickAction('Show items to use');
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a tree for Copper Axe' }));
    const treeChoices = await screen.findByRole('group', { name: 'Choose a tree' });
    fireEvent.click(within(treeChoices).getByRole('button', { name: 'Use Copper Axe on pine' }));

    expect(await screen.findByText('The pine is too wet to chop.')).toBeVisible();
  });

  it('does not offer woodcutting interactions for a tree without a carried axe', async () => {
    availableWoodcuttingTrees = [{ id: 'southbound-pine', label: 'pine' }];
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    expect(screen.getByRole('region', { name: 'Terminal transcript' }))
      .toHaveTextContent('A pine tree stands beside the path.');
    expect(screen.queryByRole('dialog', { name: 'Choose an item to use on A pine tree' }))
      .not.toBeInTheDocument();
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'woodcutting.start',
    )).toBe(false);
  });

  it('opens an item picker when clicking a tree and starts chopping only after selection', async () => {
    woodcuttingAxeCarried = true;
    availableWoodcuttingTrees = [{ id: 'southbound-pine', label: 'pine' }];
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    expect(screen.getByRole('region', { name: 'Terminal transcript' })).toHaveTextContent('A pine tree stands beside the path.');
    const pineTree = await screen.findByRole('button', {
      name: 'Choose an item to use on A pine tree in terminal',
    });
    fireEvent.click(pineTree);

    const dialog = await screen.findByRole('dialog', { name: 'Choose an item to use on A pine tree' });
    expect(within(dialog).getByRole('button', { name: 'Copper Axe' })).toBeInTheDocument();
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body)).type === 'woodcutting.start',
    )).toBe(false);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Copper Axe' }));
    await screen.findByText('You begin swinging your axe at the tree...');
    const startCommand = apiFetch.mock.calls.find(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body)).type === 'woodcutting.start',
    );
    expect(JSON.parse(String(startCommand?.[1]?.body))).toMatchObject({
      payload: { axeItemId: 'copper-axe', treeId: 'southbound-pine' },
    });
  });

  it('continues an active woodcutting task from its progress control', async () => {
    activeWoodcuttingState = {
      actionId: 'continuable-woodcutting-action',
      treeId: 'southbound-pine',
      treeLabel: 'pine',
      axeItemId: 'copper-axe',
      locationId: 'mossgate-clearing',
      startedAt: new Date(Date.now() + 60_000).toISOString(),
      ticksCompleted: 3,
      ticksRequired: 10,
    };
    woodcuttingAdvancePayload = { status: 'logged' };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    const task = await screen.findByRole('region', { name: 'Woodcutting in progress' });
    const timer = vi.spyOn(window, 'setTimeout').mockImplementation(
      () => 0 as unknown as ReturnType<typeof window.setTimeout>,
    );
    try {
      fireEvent.click(within(task).getByRole('button', { name: 'Continue' }));
      expect(timer).toHaveBeenCalledWith(expect.any(Function), expect.any(Number));
    } finally {
      timer.mockRestore();
    }
  });

  it('says only a stump remains when a woodcutting action cuts down a tree', async () => {
    woodcuttingDepletesTree = true;
    activeWoodcuttingState = {
      actionId: 'depleting-woodcutting-action',
      treeId: 'southbound-pine',
      treeLabel: 'pine',
      axeItemId: 'copper-axe',
      locationId: 'mossgate-clearing',
      startedAt: new Date(Date.now() - 10_000).toISOString(),
      ticksCompleted: 9,
      ticksRequired: 10,
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    const stumpMessage = await screen.findByText('You cut down the pine; only a stump remains.');
    expect(stumpMessage).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Terminal transcript' })).not.toHaveTextContent(/regrow/i);
  });

  it('continues an active fishing cast from its progress control', async () => {
    room = 'bridge';
    activeFishingCastState = {
      castId: 'continuable-fishing-cast',
      spotId: 'glasswater-fishing-spot',
      locationId: 'glasswater-bridge',
      rodItemId: 'old-rod',
      rodQualityId: 'old',
      startedAt: new Date(Date.now() + 60_000).toISOString(),
      tickIntervalSeconds: 60,
      ticksRequired: 10,
      ticksCompleted: 3,
    };
    fishingAdvanceEvents = [{ type: 'character.fishing_cast_advanced', payload: { status: 'no-bite' } }];
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    const task = await screen.findByRole('region', { name: 'Fishing in progress' });
    const timer = vi.spyOn(window, 'setTimeout').mockImplementation(
      () => 0 as unknown as ReturnType<typeof window.setTimeout>,
    );
    try {
      fireEvent.click(within(task).getByRole('button', { name: 'Continue' }));
      expect(timer).toHaveBeenCalledWith(expect.any(Function), expect.any(Number));
    } finally {
      timer.mockRestore();
    }
  });

  it.each([
    ['logged', { status: 'logged' }, 'You cut a bundle of logs.'],
    ['no-log', { status: 'no-log' }, 'You swing for ten seconds, but no logs come free.'],
    ['tree-depleted', { status: 'tree-depleted' }, 'Only a stump remains where the tree stood.'],
    ['interrupted', { status: 'interrupted' }, 'You stop chopping.'],
  ])('renders the woodcutting %s outcome', async (_status, payload, message) => {
    woodcuttingAdvancePayload = payload;
    activeWoodcuttingState = {
      actionId: 'outcome-woodcutting-action',
      treeId: 'southbound-pine',
      treeLabel: 'pine',
      axeItemId: 'copper-axe',
      locationId: 'mossgate-clearing',
      startedAt: new Date(Date.now() - 10_000).toISOString(),
      ticksCompleted: 0,
      ticksRequired: 10,
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    expect(await screen.findByText(message)).toBeVisible();
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body)).type === 'woodcutting.advance',
    )).toBe(true);
  });

  it('ignores a woodcutting event without an outcome status', async () => {
    woodcuttingAdvancePayload = {};
    activeWoodcuttingState = {
      actionId: 'statusless-woodcutting-action',
      treeId: 'southbound-pine',
      treeLabel: 'pine',
      axeItemId: 'copper-axe',
      locationId: 'mossgate-clearing',
      startedAt: new Date(Date.now() - 10_000).toISOString(),
      ticksCompleted: 0,
      ticksRequired: 10,
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([path, init]) =>
        path === '/api/commands' &&
        JSON.parse(String(init?.body)).type === 'woodcutting.advance',
      )).toBe(true);
    });
    const terminal = screen.getByRole('region', { name: 'Terminal transcript' });
    expect(terminal).not.toHaveTextContent('You cut a bundle of logs.');
    expect(terminal).not.toHaveTextContent('Only a stump remains where the tree stood.');
  });

  it.each([
    ['axe still swinging', 'axe is still swinging; wait.'],
    ['revision conflict', 'revision conflict'],
  ])('retries woodcutting after a %s response', async (_failure, errorMessage) => {
    woodcuttingAdvanceError = errorMessage;
    woodcuttingAdvancePayload = { status: 'no-log' };
    activeWoodcuttingState = {
      actionId: 'retry-woodcutting-action',
      treeId: 'southbound-pine',
      treeLabel: 'pine',
      axeItemId: 'copper-axe',
      locationId: 'mossgate-clearing',
      startedAt: new Date(Date.now() - 10_000).toISOString(),
      ticksCompleted: 0,
      ticksRequired: 10,
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    expect(await screen.findByText(
      'You swing for ten seconds, but no logs come free.',
      {},
      { timeout: 8_000 },
    )).toBeVisible();
    const advanceRequests = apiFetch.mock.calls.filter(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body)).type === 'woodcutting.advance',
    );
    expect(advanceRequests.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the persisted woodcutting action visible after a transient error', async () => {
    woodcuttingAdvanceError = 'temporary service failure';
    activeWoodcuttingState = {
      actionId: 'transient-error-woodcutting-action',
      treeId: 'southbound-pine',
      treeLabel: 'pine',
      axeItemId: 'copper-axe',
      locationId: 'mossgate-clearing',
      startedAt: new Date(Date.now() - 10_000).toISOString(),
      ticksCompleted: 0,
      ticksRequired: 10,
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    expect(await screen.findByText('temporary service failure')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Woodcutting in progress' })).toBeInTheDocument();
  });

  it('keeps woodcutting recoverable when an NPC room announcement arrives', async () => {
    activeWoodcuttingState = {
      actionId: 'persisted-woodcutting-action',
      treeId: 'southbound-pine',
      treeLabel: 'pine',
      axeItemId: 'copper-axe',
      locationId: 'mossgate-clearing',
      startedAt: new Date(Date.now() - 10_000).toISOString(),
      ticksCompleted: 2,
      ticksRequired: 10,
    };
    roomChatMessages.push({
      id: nextRoomChatMessageId++,
      roomId: 'mossgate-clearing',
      speakerType: 'npc',
      speakerId: 'orin-vale',
      speakerName: 'Orin Vale',
      text: 'Orin arrives from the north, glancing toward the river.',
      createdAt: new Date().toISOString(),
    });

    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    const activity = await screen.findByRole('region', { name: 'Woodcutting in progress' });
    expect(within(activity).getByRole('button', { name: 'Continue' })).toBeEnabled();
    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([path, init]) =>
        path === '/api/commands' &&
        JSON.parse(String(init?.body)).type === 'woodcutting.advance',
      )).toBe(true);
    });
    const stop = within(activity).getByRole('button', { name: 'Stop' });
    expect(stop).toBeEnabled();
    fireEvent.click(stop);

    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([path, init]) =>
        path === '/api/commands' &&
        JSON.parse(String(init?.body)).type === 'woodcutting.cancel' &&
        JSON.parse(String(init?.body)).payload.actionId === 'persisted-woodcutting-action',
      )).toBe(true);
    });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Woodcutting in progress' })).not.toBeInTheDocument());
  });

  it('refreshes a conflicted woodcutting action and retries cancellation once', async () => {
    activeWoodcuttingState = {
      actionId: 'conflicted-woodcutting-action',
      treeId: 'southbound-pine',
      treeLabel: 'pine',
      axeItemId: 'copper-axe',
      locationId: 'mossgate-clearing',
      startedAt: new Date(Date.now() + 60_000).toISOString(),
      ticksCompleted: 0,
      ticksRequired: 10,
    };
    const original = apiFetch.getMockImplementation()!;
    let cancelAttempts = 0;
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'woodcutting.cancel') {
          cancelAttempts += 1;
          if (cancelAttempts === 1) {
            return json({ message: 'Revision conflict while stopping woodcutting.' }, 409);
          }
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    const activity = await screen.findByRole('region', { name: 'Woodcutting in progress' });
    fireEvent.click(within(activity).getByRole('button', { name: 'Stop' }));

    await waitFor(() => expect(cancelAttempts).toBe(2));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Woodcutting in progress' })).not.toBeInTheDocument()
    );
    expect(activeWoodcuttingState).toBeNull();
  });

  it('keeps woodcutting active when cancellation is rejected after a conflict', async () => {
    activeWoodcuttingState = {
      actionId: 'conflicted-woodcutting-action',
      treeId: 'southbound-pine',
      treeLabel: 'pine',
      axeItemId: 'copper-axe',
      locationId: 'mossgate-clearing',
      startedAt: new Date(Date.now() + 60_000).toISOString(),
      ticksCompleted: 0,
      ticksRequired: 10,
    };
    const original = apiFetch.getMockImplementation()!;
    let cancelAttempts = 0;
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'woodcutting.cancel') {
          cancelAttempts += 1;
          if (cancelAttempts === 1) {
            return json({ message: 'Revision conflict while stopping woodcutting.' }, 409);
          }
          throw new Error('The axe head is stuck.');
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    const activity = await screen.findByRole('region', { name: 'Woodcutting in progress' });

    fireEvent.click(within(activity).getByRole('button', { name: 'Stop' }));

    expect(await screen.findByText('The axe head is stuck.')).toBeVisible();
    expect(cancelAttempts).toBe(2);
    expect(screen.getByRole('region', { name: 'Woodcutting in progress' })).toBeInTheDocument();
    expect(activeWoodcuttingState?.actionId).toBe('conflicted-woodcutting-action');
  });

  it('bounds room-event deduplication while refreshing temporary-object lifecycle changes', async () => {
    campfireVisible = true;
    terminalRoomEvents.push(...Array.from({ length: 257 }, (_, index) => ({
      id: index + 1,
      roomId: 'mossgate-clearing',
      speakerType: 'npc' as const,
      speakerId: 'room:mossgate-clearing',
      speakerName: 'The room',
      text: 'The campfire burns down to embers and goes dark.',
      createdAt: new Date().toISOString(),
    })));
    const duplicateEvent = terminalRoomEvents.at(-1);
    if (duplicateEvent) terminalRoomEvents.push({ ...duplicateEvent });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    campfireVisible = false;

    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([path, init]) =>
        path === '/api/queries' &&
        JSON.parse(String(init?.body)).type === 'location.describe',
      )).toBe(true);
    }, { timeout: 6_000 });
  });

  it('keeps a campfire visible and reports when extinguishing fails', async () => {
    campfireVisible = true;
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'campfire.extinguish') {
          return json({ message: 'The fire flares back to life.' }, 503);
        }
      }
      return original(path, init);
    });
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    submitWorldCommand('extinguish campfire');

    expect(await screen.findByText('The fire flares back to life.')).toBeVisible();
    expect(campfireVisible).toBe(true);
  });

  it('lets a traveler extinguish a campfire through the room command', async () => {
    campfireVisible = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('extinguish campfire');

    await waitFor(() => {
      const call = apiFetch.mock.calls.find(([path, init]) =>
        path === '/api/commands' &&
        JSON.parse(String(init?.body)).type === 'campfire.extinguish',
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        characterId,
        payload: { campfireId: 'test-campfire' },
      });
    });
    await waitFor(() => expect(campfireVisible).toBe(false));
    expect(await screen.findByText('You extinguish the campfire.')).toBeInTheDocument();
  });

  it('lets a traveler extinguish a campfire from its room description', async () => {
    campfireVisible = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    fireEvent.click(await screen.findByRole('button', { name: 'Choose an action for Campfire in terminal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose an action for Campfire' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Extinguish' }));

    expect(await screen.findByText('You extinguish the campfire.')).toBeVisible();
    await waitFor(() => expect(campfireVisible).toBe(false));
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body)).type === 'campfire.extinguish' &&
      JSON.parse(String(init?.body)).payload?.campfireId === 'test-campfire',
    )).toBe(true);
  });

  it('opens the use-target picker when a carried tool is mentioned in room narration', async () => {
    woodcuttingAxeCarried = true;
    currentRoomMentionsInventory = true;
    availableWoodcuttingTrees = [{ id: 'southbound-pine', label: 'pine' }];
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });

    fireEvent.click(await screen.findByRole('button', { name: 'Choose an action for Copper Axe in terminal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose an action for Copper Axe' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use Copper Axe on pine' }));

    expect(await screen.findByText('You begin swinging your axe at the tree...')).toBeVisible();
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body)).type === 'woodcutting.start' &&
      JSON.parse(String(init?.body)).payload?.axeItemId === 'copper-axe',
    )).toBe(true);
  });

  it('does not start overlapping woodcutting ticks while a tick is unresolved', async () => {
    activeWoodcuttingState = {
      actionId: 'single-flight-woodcutting-action',
      treeId: 'southbound-pine',
      treeLabel: 'pine',
      axeItemId: 'copper-axe',
      locationId: 'mossgate-clearing',
      startedAt: '2000-01-01T00:00:00.000Z',
      ticksCompleted: 0,
      ticksRequired: 10,
    };
    const original = apiFetch.getMockImplementation()!;
    let releaseAdvance: ((response: Response) => void) | undefined;
    let attempts = 0;
    apiFetch.mockImplementation((path, init) => {
      if (path === '/api/commands' && init?.method === 'POST') {
        const command = JSON.parse(String(init.body)) as { type?: string };
        if (command.type === 'woodcutting.advance') {
          attempts += 1;
          return new Promise<Response>((resolve) => { releaseAdvance = resolve; });
        }
      }
      return original(path, init);
    });
    const view = render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('region', { name: 'Woodcutting in progress' });
    await waitFor(() => expect(attempts).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(attempts).toBe(1);

    activeWoodcuttingState = null;
    revision += 1;
    await act(async () => {
      releaseAdvance?.(json({
        receipt: { ok: true, commandId: 'mock-command', eventIds: [], newAggregateVersion: revision },
        streamId: characterId,
        events: [{
          type: 'character.woodcutting_action_advanced',
          payload: { status: 'no-log' },
        }],
      }));
    });
    view.unmount();
  });

  it('prints Chop! every two seconds while woodcutting remains active', async () => {
    activeWoodcuttingState = {
      actionId: 'persisted-woodcutting-action',
      treeId: 'southbound-pine',
      treeLabel: 'pine',
      axeItemId: 'copper-axe',
      locationId: 'mossgate-clearing',
      startedAt: new Date().toISOString(),
      ticksCompleted: 0,
      ticksRequired: 10,
    };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    const terminal = await screen.findByRole('region', { name: 'Terminal transcript' });
    await waitFor(() => {
      expect(within(terminal).getAllByText('Chop!')).toHaveLength(1);
    }, { timeout: 3_000 });
    await waitFor(() => {
      expect(within(terminal).getAllByText('Chop!')).toHaveLength(2);
    }, { timeout: 3_000 });
  });

  it('accepts the explicit use axe on tree command form', async () => {
    woodcuttingAxeCarried = true;
    availableWoodcuttingTrees = [{ id: 'southbound-pine', label: 'pine' }];
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('use axe no tree');
    await screen.findByText('There is no tree called “no tree” here.');
    submitWorldCommand('use Copper Axe on nonexistent tree');
    await screen.findByText('There is no tree called “nonexistent tree” here.');
    submitWorldCommand('use Copper Axe on pine tree');

    await screen.findByText('You begin swinging your axe at the tree...');
    const startCommand = apiFetch.mock.calls.find(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body)).type === 'woodcutting.start',
    );
    expect(JSON.parse(String(startCommand?.[1]?.body))).toMatchObject({
      payload: { axeItemId: 'copper-axe', treeId: 'southbound-pine' },
    });
  });

  it('asks which axe to use when multiple carried axes match', async () => {
    woodcuttingAxeCarried = true;
    secondWoodcuttingAxeCarried = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });
    submitWorldCommand('use Copper Axe pine');

    await waitFor(() => expect(history).toHaveTextContent('Which axe do you mean: Copper Axe, Copper Axe?'));
    const ambiguityCount = screen.getAllByText('Which axe do you mean: Copper Axe, Copper Axe?').length;
    submitWorldCommand('use axe pine');
    await waitFor(() => {
      expect(screen.getAllByText('Which axe do you mean: Copper Axe, Copper Axe?')).toHaveLength(ambiguityCount + 1);
    });
    const afterGenericAxeCount = screen.getAllByText('Which axe do you mean: Copper Axe, Copper Axe?').length;
    submitWorldCommand('use axe on pine');
    await waitFor(() => {
      expect(screen.getAllByText('Which axe do you mean: Copper Axe, Copper Axe?')).toHaveLength(afterGenericAxeCount + 1);
    });
  });

  it('asks which tree when several match an axe command', async () => {
    woodcuttingAxeCarried = true;
    availableWoodcuttingTrees = [
      { id: 'southbound-pine', label: 'pine tree' },
      { id: 'ridge-white-pine', label: 'white pine tree' },
    ];
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('use Copper Axe on pine tree');

    expect(await screen.findByText(/Which tree do you mean:.*pine tree/)).toBeVisible();
    expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'woodcutting.start',
    )).toBe(false);
  });

  it('shows active daily postings from previous cycles as expired in Field notes', async () => {
    dailyFeatureEnabled = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    await openInfoSection('Field notes');
    expect(screen.getByText('An old river-mint posting')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('2000-01-01')).toBeInTheDocument();
    expect(screen.getByText('Posted by Sella')).toBeInTheDocument();
    expect(screen.getByText('Bring 3 river-mint · carried 1/3')).toBeInTheDocument();
    expect(screen.getByText('Reward: 15 gold · 9 XP')).toBeInTheDocument();
    const localResetDate = new Date(Date.parse('2098-12-31T00:00:00.000Z') + 86_400_000)
      .toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    expect(screen.getByText(/resets/)).toHaveTextContent(localResetDate);
  });
});
