import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamCombatEncounter } from '@mudd/contracts';

const { apiFetch } = vi.hoisted(() => {
  const apiFetch = vi.fn();
  vi.stubGlobal('fetch', apiFetch);
  return { apiFetch };
});

import { WorldClient } from './App.js';

async function openInfoSection(section: 'Vitals' | 'Items' | 'Equipment' | 'Stats' | 'Field notes') {
  fireEvent.click(screen.getByRole('link', { name: 'Info' }));
  const tabs = await screen.findByRole('navigation', { name: 'Info sections' });
  fireEvent.click(within(tabs).getByRole('link', { name: section }));
  await screen.findByRole('heading', { name: section });
  return tabs;
}

const characterId = '11111111-1111-4111-8111-111111111111';
let room: 'clearing' | 'bridge' | 'market' | 'inn' | 'belfry';
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
let nextRoomChatMessageId: number;
let roomOccupants: Array<{ id: string; displayName: string }>;
let heartbeatOccupants: Array<{ id: string; displayName: string }>;
let walletBalance: number;
let merchantLanternPurchased: boolean;
let healingDraughtCarried: boolean;
let characterHealth: { current: number; maximum: number } | null;
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

function currentLocation() {
  return {
    worldInstanceId: 'mudd-demo-instance',
    locationId: room === 'clearing' ? 'mossgate-clearing' : room === 'market' ? 'reedbank-stalls' : room === 'inn' ? 'willowrest-inn' : 'glasswater-bridge',
    title: room === 'clearing' ? 'Mossgate Clearing' : room === 'market' ? 'Reedbank Stalls' : room === 'inn' ? 'Willowrest Inn' : 'Glasswater Bridge',
    description: room === 'clearing'
      ? itemTaken
        ? 'A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east.'
        : 'A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east. One loose stone bears a pale stripe.'
      : room === 'market'
        ? 'Canvas awnings line the riverbank.'
        : room === 'inn'
          ? 'A warm timber inn offers a full night’s rest for five moss marks.'
          : 'A stone bridge crosses clear water.',
    revision,
    ...(room === 'inn' ? {
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
    }] : room === 'bridge' ? [{
      id: 'bridge-to-clearing',
      label: 'South to Mossgate Clearing',
      direction: 'south',
      available: true,
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
      description: 'A path keeper stands beside the weathered marker, watching the northern trail.',
      canChallenge: false,
      canShop: false,
    }, {
      id: 'mossgate-training-sentinel',
      name: 'Practice Sentinel',
      description: 'A knee-high wooden sentinel waits beside the trail. Its padded arms lift as you approach.',
      canChallenge: true,
      canShop: false,
    }] : room === 'market' ? [{
      id: 'sella-reedbank-merchant',
      name: 'Sella',
      description: 'A careful trader sorts travel goods beneath a green awning.',
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
  const locations = allLocations.filter((location) => visitedLocationIds.includes(location.id));
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
    currentLocationId: currentLocation().locationId,
    locations,
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
  visitedLocationIds = ['mossgate-clearing'];
  revision = 1;
  moveError = null;
  itemTaken = false;
  maraChoice = null;
  includeSecondTakeable = false;
  secondItemTaken = false;
  questJournal = [];
  roomChatMessages = [];
  nextRoomChatMessageId = 1;
  roomOccupants = [];
  heartbeatOccupants = [];
  walletBalance = 12;
  merchantLanternPurchased = false;
  healingDraughtCarried = false;
  characterHealth = null;
  combatEncounter = null;
  activePartyInfo = null;
  partyRevision = 0;
  partyActivity = [];
  teamCombatEncounter = null;
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
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
      return json({ roomId, messages });
    }
    if (path === '/api/game') {
      return json({
        player: { id: 'account-1', displayName: 'Traveler' },
        character: {
          characterId,
          worldInstanceId: 'mudd-demo-instance',
          name: 'Rowan',
          locationId: currentLocation().locationId,
          visitedLocationIds,
          revision,
          wallet: { currencyId: 'moss-mark', balance: walletBalance },
          ...(characterHealth ? { health: characterHealth } : {}),
          ...(combatEncounter ? { combat: combatEncounter } : {}),
          inventory: [
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
          ],
        },
        location: currentLocation(),
        map: currentWorldMap(),
        questJournal,
      });
    }
    if (path === '/api/queries') {
      const query = JSON.parse(String(init?.body ?? '{}')) as {
        type?: string;
        payload?: { objectId?: string; npcId?: string; topic?: string; merchantNpcId?: string };
      };
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
        const choices = topic
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
          action?: 'attack' | 'defend' | 'flee' | 'use-item';
          encounterId?: string;
          targetNpcId?: string;
        };
      };
      if (command.type === 'inn.rest') {
        if (room !== 'inn' || command.payload?.innId !== 'willowrest-inn-service') {
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
              lastAction: action ?? combatEncounter.lastAction,
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
      if (moveError) return json({ message: moveError }, 409);
      const destinationByExitId: Record<string, typeof room> = {
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
  it('refreshes and displays the other players in the current room', async () => {
    heartbeatOccupants = [{ id: 'mira-character', displayName: 'Mira' }];
    render(<WorldClient onLeaveWorld={async () => undefined} />);

    expect(await screen.findByText('Here now: Mira')).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledWith('/api/world-session/heartbeat', expect.objectContaining({
      method: 'POST',
    }));
    expect(screen.getByRole('group', { name: 'Players in this room' })).toBeTruthy();
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
      'Show command help',
    ]);
    expect(pages).toHaveLength(2);
  });

  it('shows up to six quick actions per page at the desktop breakpoint', async () => {
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
      expect(within(firstPage).queryByRole('button', { name: 'Show quick actions page 2' })).not.toBeInTheDocument();
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
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });
    expect(history).toHaveTextContent('> look');
    await screen.findByText('A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east. One loose stone bears a pale stripe.');
    expect(screen.getAllByText('A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east. One loose stone bears a pale stripe.')).toHaveLength(1);
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
    await screen.findByRole('heading', { name: 'Stats' });
    expect(screen.getByText('Character attributes such as Strength and Dexterity are not tracked yet.')).toBeVisible();
    fireEvent.click(within(infoTabs).getByRole('link', { name: 'Field notes' }));
    await screen.findByRole('heading', { name: 'Field notes' });
    expect(screen.getByText('No current quests.')).toBeVisible();
    expect(screen.getByText('No completed quests yet.')).toBeVisible();
    expect(screen.getByText('A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east. One loose stone bears a pale stripe.')).toBeVisible();
    expect(document.querySelector('.focused-topbar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('region', { name: 'Menu' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Characters/ }));
    expect(onLeaveWorld).toHaveBeenCalledOnce();
  });

  it('preserves terminal scroll position for live updates and offers a scroll-to-latest control', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
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

    quickGo('east');

    await screen.findByRole('heading', { name: 'Willowrest Inn' });
    await waitFor(() => expect(map).toHaveTextContent('Willowrest Inn'));
    const reedbankMarker = locationMarker('Reedbank Stalls');
    const willowrestMarker = locationMarker('Willowrest Inn');
    expect(reedbankMarker).toBeDefined();
    expect(willowrestMarker).toBeDefined();
    expect(map.querySelectorAll('.focused-world-map__path')).toHaveLength(3);

    expect(map.querySelectorAll('.focused-world-map__path')).toHaveLength(3);
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
    expect(await screen.findByText('The way is clear.')).toBeVisible();
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
      expect(chat.closest('.focused-terminal')).not.toBeNull();
      expect(chat.closest('.focused-terminal-body')).not.toBeNull();
      expect(quickActions).not.toBeNull();
      expect(Boolean(quickActions!.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
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

    fireEvent.click(screen.getByRole('button', { name: 'Collapse room chat' }));
    expect(panel).toHaveClass('focused-room-chat--collapsed');
    const expandChat = screen.getByRole('button', { name: 'Expand room chat' });
    expect(expandChat).toHaveClass('mudd-disclosure-button');
    expect(expandChat).toHaveAttribute('aria-expanded', 'false');
    expect(expandChat).toHaveAttribute('aria-controls', 'room-chat-content');

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
    expect(screen.getByRole('button', { name: 'Collapse room chat' })).toHaveAttribute('aria-expanded', 'true');
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
    expect(history).toHaveTextContent('You travel north.');
    expect(history).toHaveTextContent('A stone bridge crosses clear water.');
    const command = JSON.parse(apiFetch.mock.calls.find(([path]) => path === '/api/commands')?.[1].body as string);
    expect(command).toMatchObject({
      type: 'character.move',
      characterId,
      expectedVersion: 1,
      payload: { exitId: 'clearing-to-bridge' },
    });

    await openInfoSection('Field notes');
    expect(screen.getByText('You travel north.')).toBeVisible();
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
      expect(screen.getAllByText('A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east. One loose stone bears a pale stripe.')).toHaveLength(2);
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
    expect(history).toHaveTextContent('take <item> | take all — Pick up one or all items in the current room.');
    expect(history).toHaveTextContent('talk <npc> [about <topic>] — Speak privately with someone in the current room.');
    expect(history).toHaveTextContent('use <item> on <target> | use <healing item> — Use a room item or restore health during or between encounters.');
    expect(history).toHaveTextContent('Quick actions include available movement, item, equipment, merchant, dialogue, and combat actions.');
    expect(history).toHaveTextContent('equip <item> — Equip a carried weapon or armor item.');

    fireEvent.change(commandInput, { target: { value: 'help LOOK' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('Usage: look | look [at] <object>');
    expect(history).toHaveTextContent('Look describes the current room. Add an object to inspect it here or in your inventory.');

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
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    expect(screen.getByLabelText('Character health')).toHaveTextContent('Health 2/6');
    const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });
    fireEvent.change(commandInput, { target: { value: 'use Small healing draught' } });
    fireEvent.submit(commandInput.closest('form')!);

    await screen.findByText(/You use the small healing draught and recover 3 health/);
    expect(screen.getByLabelText('Character health')).toHaveTextContent('Health 5/6');
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

  it('restores health at Willowrest Inn for the listed fee through a contextual quick action', async () => {
    room = 'inn';
    visitedLocationIds = ['mossgate-clearing', 'glasswater-bridge', 'reedbank-stalls', 'willowrest-inn'];
    characterHealth = { current: 4, maximum: 6 };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Willowrest Inn' });
    expect(screen.getByText(/full night’s rest for five moss marks/i)).toBeInTheDocument();
    expect(quickActionVisibleAnywhere('Rest at Willowrest Inn for 5 moss marks')).toBe(true);

    clickQuickAction('Rest at Willowrest Inn for 5 moss marks');

    await screen.findByText(/You rest at Willowrest Inn, restore 2 health, and pay 5 moss marks/);
    expect(screen.getByLabelText('Character health')).toHaveTextContent('Health 6/6');
    expect(walletBalance).toBe(7);
    expect(apiFetch.mock.calls.some(([path, init]) => {
      if (path !== '/api/commands') return false;
      const body = JSON.parse(String(init?.body ?? '{}'));
      return body.type === 'inn.rest' &&
        body.payload.innId === 'willowrest-inn-service' &&
        body.expectedVersion === 1;
    })).toBe(true);
  });

  it('hides inn rest quick action when the traveler is already at full health', async () => {
    room = 'inn';
    visitedLocationIds = ['mossgate-clearing', 'glasswater-bridge', 'reedbank-stalls', 'willowrest-inn'];
    characterHealth = { current: 6, maximum: 6 };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Willowrest Inn' });

    expect(quickActionVisibleAnywhere('Rest at Willowrest Inn for 5 moss marks')).toBe(false);
  });

  it('offers between-fight potion use in quick actions only when health is missing', async () => {
    healingDraughtCarried = true;
    characterHealth = { current: 4, maximum: 6 };
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    clickQuickAction('Show items to use');
    fireEvent.click(screen.getByRole('button', { name: 'Use Small healing draught' }));
    await screen.findByText(/You use the small healing draught and recover 2 health/);
    expect(screen.getByLabelText('Character health')).toHaveTextContent('Health 6/6');
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

    fireEvent.change(commandInput, { target: { value: 'talk Mara' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('Mara: The old paths still have their stories. What would you like to ask?');
    expect(history).toHaveTextContent('> talk Mara');
    expect(chat).not.toHaveTextContent('What would you like to ask?');
    expect(screen.getByRole('group', { name: 'Mara dialogue choices' })).toHaveTextContent('Ask about the marker');
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
    await screen.findByText('Mara: The marker points east to the Old Bell Tower. Its direction is still true.');
    const remainingChoices = screen.getByRole('group', { name: 'Mara dialogue choices' });
    expect(remainingChoices).toHaveTextContent('Ask about the bell tower');
    expect(remainingChoices).not.toHaveTextContent('Ask about the marker');
    expect(chat).not.toHaveTextContent('The marker points east to the Old Bell Tower. Its direction is still true.');

    fireEvent.change(commandInput, { target: { value: 'talk Mara about bell' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('Mara: The bell has not rung in years. The tower stands east of this clearing.');

    clickQuickAction('Show people to talk to');
    fireEvent.click(screen.getByRole('button', { name: 'Talk to Mara' }));
    expect(screen.getByRole('group', { name: /^Quick commands, page \d+$/ })).toBeVisible();
    await waitFor(() => {
      expect(screen.getAllByText('Mara: The marker points east to the Old Bell Tower. Its direction is still true.')).toHaveLength(2);
    });

    quickGo('north');
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    quickGo('south');
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    fireEvent.change(commandInput, { target: { value: 'talk Mara' } });
    fireEvent.submit(commandInput.closest('form')!);
    await waitFor(() => {
      expect(screen.getAllByText('Mara: The marker points east to the Old Bell Tower. Its direction is still true.')).toHaveLength(3);
    });

    quickGo('north');
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    fireEvent.change(commandInput, { target: { value: 'talk Mara' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('You do not see anyone called “Mara” here.');
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

  it('inspects carried items from the Items tab and by command, including after leaving their room', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });

    fireEvent.change(commandInput, { target: { value: 'take stone' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('You pick up the loose stone.');

    await openInfoSection('Items');
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Loose stone' }));
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
    expect(history).toHaveTextContent('You travel north.');
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
    await screen.findByText('A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east.');
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

    await screen.findByText('You pick up the loose stone.');
    await screen.findByText('You pick up the lost feather.');
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
    expect(screen.getByText('You buy the brass lantern for 8 moss marks.')).toBeVisible();
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
});
