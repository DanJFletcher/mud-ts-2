import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InteractionInbox, TeamCombatEncounter } from '@mudd/contracts';

const { apiFetch } = vi.hoisted(() => {
  const apiFetch = vi.fn();
  vi.stubGlobal('fetch', apiFetch);
  return { apiFetch };
});

vi.mock('./codex/CodexScreen.js', () => ({
  default: () => <><h1>A world, carefully remembered</h1><p>Orraveth is separate from the active MUDD world.</p></>,
}));

import { WorldClient } from './App.js';

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

function classApiFixture(initiallySelected = false, completedDuel = false) {
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
let bulletinReadableObject: boolean;
let dailyJobStatus: 'available' | 'active' | 'completed';
let dailySupplyCount: number;
let dailyBoardQueryCount: number;
let dailyCommandPayloads: Array<{ type: string; payload: Record<string, unknown> }>;
let visitedLocationIds: string[];
let revision: number;
let moveError: string | null;
let itemTaken: boolean;
let maraChoice: string | null;
let includeSecondTakeable: boolean;
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
let roomOccupants: Array<{ id: string; displayName: string }>;
let heartbeatOccupants: Array<{ id: string; displayName: string }>;
let walletBalance: number;
let worldCurrency: { id: string; name: string; symbol: string } | undefined;
let merchantLanternPurchased: boolean;
let healingDraughtCarried: boolean;
let fishingRodCarried: boolean;
let woodcuttingAxeCarried: boolean;
let availableWoodcuttingTrees: Array<{ id: string; label: string }>;
let woodcuttingDepletesTree: boolean;
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
      ].join('\n\n')
      : room === 'market'
        ? 'Canvas awnings line the riverbank.'
        : room === 'inn'
          ? 'A warm timber inn offers a full night’s rest for five moss marks.'
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
        npcs: [{ id: 'bridge-watcher', name: 'Bridge Watcher', mobile: true }],
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
      ...(includeNpcDescriptions
        ? { description: 'A path keeper stands beside the weathered marker, watching the northern trail.' }
        : {}),
      canChallenge: false,
      canShop: false,
    }, {
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
  bulletinReadableObject = false;
  dailyJobStatus = 'available';
  dailySupplyCount = 0;
  dailyBoardQueryCount = 0;
  dailyCommandPayloads = [];
  visitedLocationIds = ['mossgate-clearing'];
  revision = 1;
  moveError = null;
  itemTaken = false;
  maraChoice = null;
  includeSecondTakeable = false;
  secondItemTaken = false;
  questJournal = [];
  roomChatMessages = [];
  terminalRoomEvents = [];
  nextRoomChatMessageId = 1;
  campfireVisible = false;
  roomOccupants = [];
  heartbeatOccupants = [];
  walletBalance = 12;
  worldCurrency = { id: 'moss-mark', name: 'moss mark', symbol: 'm' };
  merchantLanternPurchased = false;
  healingDraughtCarried = false;
  fishingRodCarried = false;
  woodcuttingAxeCarried = false;
  availableWoodcuttingTrees = [];
  woodcuttingDepletesTree = false;
  activeWoodcuttingState = null;
  characterHealth = null;
  characterStamina = { current: 100, maximum: 100 };
  staminaPosture = 'standing';
  combatEncounter = null;
  activePartyInfo = null;
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
      return json({
        player: { id: 'account-1', displayName: 'Traveler' },
        character: {
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
            lastSettledAt: '2026-10-23T12:00:00.000Z',
            fractionalCarry: 0,
          },
          ...(combatEncounter ? { combat: combatEncounter } : {}),
          ...(activeWoodcuttingState ? { activeWoodcutting: activeWoodcuttingState } : {}),
          ...(dailyFeatureEnabled ? { equipment: { weaponItemId: 'mint-equipped', armorItemId: null } } : {}),
          inventory: [
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
            ...(woodcuttingAxeCarried ? [{
              id: 'copper-axe',
              typeId: 'copper-axe',
              label: 'Copper Axe',
              description: 'A worn copper axe.',
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
        location: currentLocation(),
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
            }] : [],
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
      if (query.type === 'location.describe') {
        return json({ ok: true, value: currentLocation(query.payload?.includeNpcDescriptions === true) });
      }
      if (query.type === 'party.info') {
        return json({ ok: true, value: { party: activePartyInfo, revision: partyRevision, activity: partyActivity } });
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
        };
      };
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
            payload: { gold: payload.action === 'deliver' ? 15 : 0, experience: payload.action === 'deliver' ? 9 : 0 },
          }],
        });
      }
      if (command.type === 'supply.gather') {
        const payload = command.payload ?? {};
        dailyCommandPayloads.push({ type: 'supply.gather', payload: payload as Record<string, unknown> });
        if (room !== 'bridge' || payload.sourceId !== 'bridge-fishing-pools') {
          return json({ receipt: { ok: false, commandId: command.commandId ?? 'mock-command', code: 'RULE_VIOLATION', message: 'That supply is not here.' } });
        }
        dailySupplyCount += 1;
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
              health: 6,
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
        revision += 1;
        return json({
          receipt: {
            ok: true,
            commandId: command.commandId ?? 'mock-command',
            eventIds: [],
            newAggregateVersion: revision,
          },
          streamId: characterId,
        });
      }
      if (command.type === 'woodcutting.advance') {
        const treeDepleted = woodcuttingDepletesTree;
        woodcuttingDepletesTree = false;
        if (treeDepleted) {
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
              : { status: 'waiting', ticksCompleted: activeWoodcuttingState?.ticksCompleted ?? 0 },
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
      return json({ receipt: { ok: true, commandId: command.commandId ?? 'mock-command', eventIds: [], newAggregateVersion: revision }, streamId: characterId });
    }
    return json({ message: 'Not found.' }, 404);
  });
});

describe('single-character world session client', () => {
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
        location: game.location,
        map: game.map,
        questJournal: game.questJournal ?? [],
        availableFishingSpots: game.availableFishingSpots ?? [],
        availableWoodcuttingTrees: game.availableWoodcuttingTrees ?? [],
        dailyActivities: game.dailyActivities ?? { cycle: '2000-01-01', boards: [], sources: [] },
      };
      return Response.json({ ...commandResult, movementProjection: projection });
    });

    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const gameRequestCountBeforeMove = apiFetch.mock.calls.filter(([path]) => path === '/api/game').length;

    quickGo('north');

    expect(await screen.findByRole('heading', { name: 'Glasswater Bridge' })).toBeVisible();
    await waitFor(() => expect(apiFetch.mock.calls.some(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'character.move'
    )).toBe(true));
    expect(apiFetch.mock.calls.filter(([path]) => path === '/api/game')).toHaveLength(gameRequestCountBeforeMove);
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

    submitWorldCommand('accept incoming-challenge');
    expect(await screen.findByText('Sending your accept…')).toBeVisible();
    await act(async () => {
      releases[0]!(Response.json({ message: 'Temporary server issue.' }, { status: 503 }));
    });
    expect(await screen.findByText('Response status is unconfirmed.')).toBeVisible();

    submitWorldCommand('accept incoming-challenge');
    expect(await screen.findByText('Sending your accept…')).toBeVisible();
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

  it('starts and controls combat through terminal actions backed by SDK commands', async () => {
    render(<WorldClient onLeaveWorld={async () => undefined} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
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
    ]));
  });

  it('starts a cooperative encounter from a party and keeps combat-only controls', async () => {
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
    expect(screen.getByRole('group', { name: 'Cooperative combat actions' })).toBeInTheDocument();
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
    expect(within(history).getByRole('button', { name: 'Look at Mossgate Clearing in terminal' })).toBeInTheDocument();
    expect(history).not.toHaveTextContent('A path keeper stands beside the weathered marker');
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

    partyRevision = 1;
    partyActivity = [{
      revision: 1,
      groupId: 'party-terminal-scroll-test',
      type: 'joined',
      playerId: 'other-player',
      displayName: 'Aster',
    }];
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(await screen.findByText('Aster joined the party.')).toBeVisible();
    expect(scrollTop).toBe(60);
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to latest' }));
    expect(scrollTop).toBe(400);
  });

  it('closes the bottom navigation menu on Escape and restores focus to its trigger', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const menuTrigger = screen.getByRole('button', { name: 'Open menu' });

    fireEvent.click(menuTrigger);
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

    const fullscreenHeading = dialog.querySelector('.focused-terminal-location');
    expect(fullscreenHeading).not.toBeNull();
    fireTouchSwipe(fullscreenHeading!, { x: 150, y: 160 }, { x: 152, y: 45 });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Terminal' })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Open terminal full screen' }));
    await screen.findByRole('dialog', { name: 'Terminal' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Terminal' })).not.toBeInTheDocument());
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

    fireEvent.change(screen.getByPlaceholderText('Type a command'), { target: { value: 'go down' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/More than one exit leads down/);
    expect(apiFetch.mock.calls.filter(([path]) => path === '/api/commands')).toHaveLength(0);
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
    const chat = await screen.findByRole('region', { name: 'Room chat' });

    fireEvent.change(screen.getByRole('textbox', { name: 'Message the room' }), {
      target: { value: 'The marker points east.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send room message' }));

    expect(await screen.findByText('The marker still points east.')).toBeVisible();
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

  it('uses a carried item on a room target from the terminal', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });

    fireEvent.change(commandInput, { target: { value: 'take loose stone' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('You pick up the loose stone.');

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
    const conversation = screen.getByRole('dialog', { name: 'Conversation with Mara' });
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
    fireEvent.click(screen.getByRole('button', { name: 'Talk to Mara' }));
    expect(screen.getByRole('group', { name: /^Quick commands, page \d+$/ })).toBeVisible();
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
    const history = screen.getByRole('region', { name: 'Terminal output' });

    submitWorldCommand('talk Mara');
    await waitFor(() => expect(history).toHaveTextContent('Mara: The old paths still have their stories.'));
    expect(await screen.findByRole('dialog', { name: 'Conversation with Mara' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));

    submitWorldCommand('quests');
    await waitFor(() => expect(history).toHaveTextContent('1. Ask about the marker'));
    expect(history).toHaveTextContent('2. Ask about the bell tower');
    expect(history).toHaveTextContent('Choose a reply with “quests <number>”.');

    submitWorldCommand('quests 1');
    await waitFor(() => {
      expect(history).toHaveTextContent('> quests 1');
      expect(history).toHaveTextContent('Mara: The marker points east to the Old Bell Tower.');
    });
    expect(await screen.findByRole('dialog', { name: 'Conversation with Mara' })).toHaveTextContent(
      'The marker points east to the Old Bell Tower.',
    );
  });

  it('keeps an open NPC dialogue modal visible after the final reply until the player closes it', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    submitWorldCommand('talk Mara');

    const dialog = await screen.findByRole('dialog', { name: 'Conversation with Mara' });
    fireEvent.click(screen.getByRole('button', { name: 'Ask about the marker' }));
    await waitFor(() => expect(dialog).toHaveTextContent('The marker points east to the Old Bell Tower.'));

    fireEvent.click(screen.getByRole('button', { name: 'Ask about the bell tower' }));
    await waitFor(() => expect(dialog).toHaveTextContent('The bell has been silent for years.'));
    expect(dialog).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Mara response options' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
    expect(screen.queryByRole('dialog', { name: 'Conversation with Mara' })).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Look' }));

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
    const withContainer = (location: Record<string, unknown>) => {
      const existing = Array.isArray(location.objects)
        ? location.objects as Array<Record<string, unknown>>
        : [];
      const objects = existing.filter((object) =>
        object.id !== fixtureContainer.id && object.id !== fixtureItem.id,
      );
      objects.push({
        ...fixtureContainer,
        contents: stored ? [fixtureItem] : [],
      });
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
          character: { inventory: Array<{ id: string; label: string; description: string }> };
          location: Record<string, unknown>;
        };
        const inventory = snapshot.character.inventory.filter((item) => item.id !== fixtureItem.id);
        if (!stored) inventory.push(fixtureItem);
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
    const input = screen.getByRole('textbox', { name: 'Enter a command' });
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
  });

  it('loots all corpse contents by command and from the loot quick-action menu', async () => {
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
    ];
    const fixtureContents = [
      { id: 'fixture-bronze-ring', label: 'Bronze ring', description: 'A small bronze ring.', readable: false, takeable: true, containerId: 'fixture-guard-corpse' },
      { id: 'fixture-corpse-gold', label: '3 moss marks', description: 'Coins left by the guard.', readable: false, takeable: true, containerId: 'fixture-guard-corpse' },
      { id: 'fixture-broken-arrow', label: 'Broken arrow', description: 'A snapped arrow.', readable: false, takeable: true, containerId: 'fixture-scout-corpse' },
    ];
    const takenItemIds = new Set<string>();
    const corpseIds = new Set(fixtureCorpses.map((corpse) => corpse.id));
    const withCorpses = (location: Record<string, unknown>) => {
      const existing = Array.isArray(location.objects)
        ? location.objects as Array<Record<string, unknown>>
        : [];
      const objects = existing.filter((object) =>
        !corpseIds.has(String(object.id)) &&
        !fixtureContents.some((item) => item.id === object.id),
      );
      const availableContents = fixtureContents.filter((item) => !takenItemIds.has(item.id));
      objects.push(
        ...fixtureCorpses.map((corpse) => ({
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
      if (path === '/api/commands' && init?.body) {
        const command = JSON.parse(String(init.body)) as {
          type?: string;
          commandId?: string;
          payload?: { itemId?: string };
        };
        const itemId = command.payload?.itemId;
        if (command.type === 'character.take' && itemId && fixtureContents.some((item) => item.id === itemId)) {
          takenItemIds.add(itemId);
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
        return json({
          ...snapshot,
          ...(snapshot.location ? { location: withCorpses(snapshot.location) } : {}),
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
    const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });
    fireEvent.change(commandInput, { target: { value: 'loot fallen guard corpse' } });
    fireEvent.submit(commandInput.closest('form')!);

    await screen.findByText('You pick up the bronze ring.');
    await screen.findByText('You pick up the 3 moss marks.');
    clickQuickAction('Show corpses to loot');
    const lootMenu = screen.getByRole('group', { name: 'Corpses to loot' });
    fireEvent.click(within(lootMenu).getByRole('button', { name: 'Loot Fallen scout corpse' }));
    await screen.findByText('You pick up the broken arrow.');

    const history = screen.getByRole('region', { name: 'Terminal output' });
    expect(history).toHaveTextContent('> loot fallen guard corpse');
    expect(history).toHaveTextContent('> loot Fallen scout corpse');
    expect([...takenItemIds]).toEqual(expect.arrayContaining([
      'fixture-bronze-ring',
      'fixture-corpse-gold',
      'fixture-broken-arrow',
    ]));
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

  it('keeps quick actions available while moving with directional controls', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    clickQuickAction('Show look targets');
    const lookTargets = screen.getByRole('group', { name: 'Things to look at' });
    expect(lookTargets).toContainElement(screen.getByRole('button', { name: 'Look around' }));
    expect(lookTargets).toContainElement(screen.getByRole('button', { name: 'Look at Weathered marker' }));
    fireEvent.click(screen.getByRole('button', { name: 'Look around' }));
    await waitFor(() => expect(screen.getAllByText('> look')).toHaveLength(2));
    expect(apiFetch.mock.calls.some(([path]) => path === '/api/queries')).toBe(true);
    expect(screen.getByRole('button', { name: 'Show look targets' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show quick actions page 2' })).toBeVisible();

    const quickNavigation = screen.getByRole('navigation', { name: 'Quick navigation' });
    fireEvent.click(within(quickNavigation).getByRole('button', { name: 'North' }));
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
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
    fireEvent.click(screen.getByRole('button', { name: 'Read Weathered marker' }));
    await screen.findByText('OLD BELL TOWER — EAST');
    expect(history).toHaveTextContent('> read Weathered marker');

    clickQuickAction('Show items to take');
    const itemsToTake = screen.getByRole('group', { name: 'Items to take' });
    expect(itemsToTake).toContainElement(screen.getByRole('button', { name: 'Take Loose stone' }));
    expect(itemsToTake).toContainElement(screen.getByRole('button', { name: 'Take all available items' }));

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

  it('restores and persists the selected theme', async () => {
    window.localStorage.setItem('mudd-theme', 'dark');
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    expect(screen.getByRole('main')).toHaveAttribute('data-theme', 'dark');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem('mudd-theme')).toBe('light');
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

  it('browses and buys merchant goods from the terminal catalog', async () => {
    room = 'market';
    visitedLocationIds = ['mossgate-clearing', 'glasswater-bridge', 'reedbank-stalls'];
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Reedbank Stalls' });
    expect(quickActionVisibleAnywhere('Show merchants')).toBe(true);
    expect(quickActionVisibleAnywhere('Show items to buy')).toBe(false);

    clickQuickAction('Show merchants');
    fireEvent.click(screen.getByRole('button', { name: 'Shop with Sella' }));
    await screen.findByRole('region', { name: 'Sella shop catalog' });
    expect(screen.getByText('Balance: 12 moss mark')).toBeVisible();
    expect(quickActionVisibleAnywhere('Show items to buy')).toBe(true);

    clickQuickAction('Show items to buy');
    fireEvent.click(screen.getByRole('button', { name: 'Buy Brass lantern' }));
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

  it('offers a carried fishing rod as a quick action at a fishing spot', async () => {
    room = 'bridge';
    fishingRodCarried = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    fireEvent.click(await screen.findByRole('button', { name: 'Show items to use' }));
    expect(await screen.findByRole('button', { name: 'Use old rod to fish at Glasswater Bridge' })).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a tree for Copper Axe' }));

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

  it('refreshes the current room projection after a temporary-object lifecycle announcement', async () => {
    campfireVisible = true;
    terminalRoomEvents.push({
      id: 1,
      roomId: 'mossgate-clearing',
      speakerType: 'npc',
      speakerId: 'room:mossgate-clearing',
      speakerName: 'The room',
      text: 'The campfire burns down to embers and goes dark.',
      createdAt: new Date().toISOString(),
    });
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
