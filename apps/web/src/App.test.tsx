import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => {
  const apiFetch = vi.fn();
  vi.stubGlobal('fetch', apiFetch);
  return { apiFetch };
});

import { WorldClient } from './App.js';

const characterId = '11111111-1111-4111-8111-111111111111';
let room: 'clearing' | 'bridge';
let visitedLocationIds: string[];
let revision: number;
let moveError: string | null;
let itemTaken: boolean;
let maraChoice: string | null;
let includeSecondTakeable: boolean;
let secondItemTaken: boolean;
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

function currentLocation() {
  return {
    worldInstanceId: 'mudd-demo-instance',
    locationId: room === 'clearing' ? 'mossgate-clearing' : 'glasswater-bridge',
    title: room === 'clearing' ? 'Mossgate Clearing' : 'Glasswater Bridge',
    description: room === 'clearing'
      ? itemTaken
        ? 'A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east.'
        : 'A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east. One loose stone bears a pale stripe.'
      : 'A stone bridge crosses clear water.',
    revision,
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
    ] : [],
    exits: [{
      id: room === 'clearing' ? 'clearing-to-bridge' : 'bridge-to-clearing',
      label: room === 'clearing' ? 'North to Glasswater Bridge' : 'South to Mossgate Clearing',
      direction: room === 'clearing' ? 'north' : 'south',
      available: true,
    }],
    npcs: room === 'clearing' ? [{
      id: 'mara-waykeeper',
      name: 'Mara',
      description: 'A path keeper stands beside the weathered marker, watching the northern trail.',
    }] : [],
  };
}

function currentWorldMap() {
  const allLocations = [
    { id: 'mossgate-clearing', name: 'Mossgate Clearing', x: 0, y: 0 },
    { id: 'glasswater-bridge', name: 'Glasswater Bridge', x: 0, y: 1 },
    { id: 'bell-tower', name: 'Old Bell Tower', x: 1, y: 0 },
  ];
  const locations = allLocations.filter((location) => visitedLocationIds.includes(location.id));
  const hasClearing = visitedLocationIds.includes('mossgate-clearing');
  const hasBridge = visitedLocationIds.includes('glasswater-bridge');
  return {
    worldInstanceId: 'mudd-demo-instance',
    currentLocationId: currentLocation().locationId,
    locations,
    connections: hasClearing && hasBridge
      ? [{ fromLocationId: 'mossgate-clearing', toLocationId: 'glasswater-bridge' }]
      : [],
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function quickGo(direction: 'north' | 'south') {
  fireEvent.click(screen.getByRole('button', { name: 'Show available exits' }));
  fireEvent.click(screen.getByRole('button', { name: `Go ${direction}` }));
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
  roomChatMessages = [];
  nextRoomChatMessageId = 1;
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
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
        return json({ message }, 201);
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
          inventory: [
            ...(itemTaken ? [{
              id: 'mossgate-loose-stone',
              label: 'Loose stone',
              description: 'A smooth, palm-sized stone with a pale stripe running through it.',
            }] : []),
            ...(secondItemTaken ? [{
              id: 'mossgate-lost-feather',
              label: 'Lost feather',
              description: 'A small gray feather lies among the pale stones.',
            }] : []),
          ],
        },
        location: currentLocation(),
        map: currentWorldMap(),
      });
    }
    if (path === '/api/queries') {
      const query = JSON.parse(String(init?.body ?? '{}')) as {
        type?: string;
        payload?: { objectId?: string; npcId?: string; topic?: string };
      };
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
        payload?: { itemId?: string; choiceId?: string };
      };
      if (command.type === 'npc.dialogue.choose') {
        maraChoice = command.payload?.choiceId ?? null;
        revision += 1;
        return json({ receipt: { ok: true, newAggregateVersion: revision }, streamId: characterId });
      }
      if (command.type === 'character.take') {
        if (command.payload?.itemId === 'mossgate-loose-stone') itemTaken = true;
        if (command.payload?.itemId === 'mossgate-lost-feather') secondItemTaken = true;
        revision += 1;
        return json({ receipt: { ok: true, newAggregateVersion: revision }, streamId: characterId });
      }
      if (command.type === 'character.drop') {
        if (command.payload?.itemId === 'mossgate-loose-stone') itemTaken = false;
        if (command.payload?.itemId === 'mossgate-lost-feather') secondItemTaken = false;
        revision += 1;
        return json({ receipt: { ok: true, newAggregateVersion: revision }, streamId: characterId });
      }
      if (moveError) return json({ message: moveError }, 409);
      room = room === 'clearing' ? 'bridge' : 'clearing';
      const newLocationId = currentLocation().locationId;
      if (!visitedLocationIds.includes(newLocationId)) visitedLocationIds.push(newLocationId);
      revision += 1;
      return json({ receipt: { ok: true, newAggregateVersion: revision }, streamId: characterId });
    }
    return json({ message: 'Not found.' }, 404);
  });
});

describe('single-character world session client', () => {
  it('opens directly into focused gameplay with separate Traveler and Field notes screens', async () => {
    const onLeaveWorld = vi.fn().mockResolvedValue(undefined);
    render(<WorldClient onLeaveWorld={onLeaveWorld} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });
    expect(history).toHaveTextContent('> look');
    await screen.findByText('A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east. One loose stone bears a pale stripe.');
    expect(screen.getAllByText('A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east. One loose stone bears a pale stripe.')).toHaveLength(1);
    expect(screen.queryByText(/World activity|\b\d+\s+events?\b/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Look around' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Enter a command' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Traveler' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Field notes' })).toBeVisible();
    expect(screen.queryByText(/No rush|Guest identity|room:mosgate/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Traveler' }));
    await screen.findByRole('heading', { name: 'Traveler' });
    expect(screen.getByRole('heading', { name: 'Rowan' })).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: 'Field notes' }));
    await screen.findByRole('heading', { name: 'Field notes' });
    expect(screen.getByText('A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east. One loose stone bears a pale stripe.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Characters/ }));
    expect(onLeaveWorld).toHaveBeenCalledOnce();
  });

  it('collapses the terminal to its room header and restores the command history', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const terminal = screen.getByRole('heading', { name: 'Mossgate Clearing' }).closest('.focused-terminal');
    const history = screen.getByRole('region', { name: 'Terminal output' });
    expect(terminal).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse terminal' }));
    expect(terminal).toHaveClass('focused-terminal--collapsed');
    expect(screen.getByRole('button', { name: 'Expand terminal' })).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Expand terminal' }));
    expect(terminal).not.toHaveClass('focused-terminal--collapsed');
    expect(history).toHaveTextContent('> look');
    expect(screen.getByRole('textbox', { name: 'Enter a command' })).toBeInTheDocument();
  });

  it('tracks the current room and rooms already visited on the map', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    const map = await screen.findByRole('region', { name: 'World map' });
    expect(map.querySelector('.focused-world-map__compass')).toBeInTheDocument();
    expect(map.querySelector('desc')).toHaveTextContent('North is up.');
    expect(map.querySelector('.focused-world-map__location--current')).toHaveTextContent('Mossgate Clearing');
    expect(map).not.toHaveTextContent('Glasswater Bridge');

    quickGo('north');
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    await waitFor(() => expect(map).toHaveTextContent('Glasswater Bridge'));
    expect(map.querySelector('.focused-world-map__location--current')).toHaveTextContent('Glasswater Bridge');
    expect(map.querySelectorAll('.focused-world-map__path')).toHaveLength(1);
  });

  it('collapses the map and can still open it full screen', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    const map = await screen.findByRole('region', { name: 'World map' });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse map' }));
    expect(map).toHaveClass('focused-world-map--collapsed');
    expect(screen.getByRole('button', { name: 'Expand map' })).toHaveAttribute('aria-expanded', 'false');

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
    });
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
    expect(screen.getByRole('button', { name: 'Expand room chat' })).toHaveAttribute('aria-expanded', 'false');

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
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });
    expect(history).toHaveClass('focused-terminal-history');
    expect(screen.getByRole('region', { name: 'Text command' })).toBeInTheDocument();
    expect(screen.queryByText('Available paths')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Room chat' })).toBeVisible();
    quickGo('north');
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

    fireEvent.click(screen.getByRole('link', { name: 'Field notes' }));
    await screen.findByRole('heading', { name: 'Field notes' });
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
    fireEvent.click(screen.getByRole('button', { name: 'Show available exits' }));
    expect(screen.getByRole('group', { name: 'Available directions' })).toContainElement(
      screen.getByRole('button', { name: 'Go north' }),
    );
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
    expect(history).toHaveTextContent('Quick actions: Look, Read, Take, Drop, Go, Talk, and Help.');

    fireEvent.change(commandInput, { target: { value: 'help LOOK' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('Usage: look | look [at] <object>');
    expect(history).toHaveTextContent('Look describes the current room. Add an object to inspect it here or in your inventory.');

    fireEvent.change(commandInput, { target: { value: 'help unknown' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('No help is available for "unknown".');
    expect(history).toHaveTextContent('Try "help" for the command list.');
    expect(apiFetch.mock.calls.some(([path]) => path === '/api/commands' || path === '/api/queries')).toBe(false);
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

    fireEvent.click(screen.getByRole('button', { name: 'Show more quick actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show people to talk to' }));
    fireEvent.click(screen.getByRole('button', { name: 'Talk to Mara' }));
    expect(screen.getByRole('button', { name: 'Show more quick actions' })).toBeVisible();
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

  it('reads a current-room marker through a read-only query', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });
    const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });

    fireEvent.change(commandInput, { target: { value: 'read marker' } });
    fireEvent.submit(commandInput.closest('form')!);

    await screen.findByText('OLD BELL TOWER — EAST');
    expect(history).toHaveTextContent('> read marker');
    const readRequest = apiFetch.mock.calls.find(([path, init]) =>
      path === '/api/queries' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'object.read'
    );
    expect(JSON.parse(String(readRequest?.[1]?.body))).toMatchObject({
      type: 'object.read',
      characterId,
      payload: { objectId: 'mossgate-marker' },
    });

    fireEvent.change(commandInput, { target: { value: 'read book' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('There is nothing readable called “book” here.');
    expect(apiFetch.mock.calls.filter(([path, init]) =>
      path === '/api/queries' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'object.read'
    )).toHaveLength(1);
  });

  it('takes a loose stone, drops it in the room, and can take it again', async () => {
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

    fireEvent.click(screen.getByRole('link', { name: 'Traveler' }));
    await screen.findByRole('heading', { name: 'Traveler' });
    expect(screen.getByText('Loose stone')).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: 'Play' }));
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const commandInputAfterReturn = screen.getByRole('textbox', { name: 'Enter a command' });
    fireEvent.change(commandInputAfterReturn, { target: { value: 'drop stone' } });
    fireEvent.submit(commandInputAfterReturn.closest('form')!);
    await screen.findByText('You put down the loose stone.');
    const dropRequest = apiFetch.mock.calls.find(([path, init]) =>
      path === '/api/commands' &&
      JSON.parse(String(init?.body ?? '{}')).type === 'character.drop'
    );
    expect(JSON.parse(String(dropRequest?.[1]?.body))).toMatchObject({
      type: 'character.drop',
      characterId,
      expectedVersion: 2,
      payload: { itemId: 'mossgate-loose-stone' },
    });
    fireEvent.change(commandInputAfterReturn, { target: { value: 'take stone' } });
    fireEvent.submit(commandInputAfterReturn.closest('form')!);
    await screen.findByText('You pick up the loose stone.');
    expect(apiFetch.mock.calls.filter(([path, init]) =>
      path === '/api/commands' &&
      ['character.take', 'character.drop'].includes(JSON.parse(String(init?.body ?? '{}')).type)
    )).toHaveLength(3);
  });

  it('inspects carried items from Traveler and by command, including after leaving their room', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });

    fireEvent.change(commandInput, { target: { value: 'take stone' } });
    fireEvent.submit(commandInput.closest('form')!);
    await screen.findByText('You pick up the loose stone.');

    fireEvent.click(screen.getByRole('link', { name: 'Traveler' }));
    await screen.findByRole('heading', { name: 'Traveler' });
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

  it('shows look targets and switches quick commands to available directions', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    fireEvent.click(screen.getByRole('button', { name: 'Show look targets' }));
    const lookTargets = screen.getByRole('group', { name: 'Things to look at' });
    expect(lookTargets).toContainElement(screen.getByRole('button', { name: 'Look around' }));
    expect(lookTargets).toContainElement(screen.getByRole('button', { name: 'Look at Weathered marker' }));
    fireEvent.click(screen.getByRole('button', { name: 'Look around' }));
    await waitFor(() => expect(screen.getAllByText('> look')).toHaveLength(2));
    expect(apiFetch.mock.calls.some(([path]) => path === '/api/queries')).toBe(true);
    expect(screen.getByRole('button', { name: 'Show look targets' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show more quick actions' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Show available exits' }));
    expect(screen.queryByRole('button', { name: 'Show look targets' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Available directions' })).toContainElement(
      screen.getByRole('button', { name: 'Go north' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Go north' }));
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    expect(history).toHaveTextContent('> go north');
    expect(history).toHaveTextContent('You travel north.');
    expect(screen.queryByRole('button', { name: 'Go south' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show look targets' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show more quick actions' })).toBeVisible();

    const moveCommand = JSON.parse(
      apiFetch.mock.calls.find(([path]) => path === '/api/commands')?.[1].body as string,
    );
    expect(moveCommand).toMatchObject({
      type: 'character.move',
      characterId,
      expectedVersion: 1,
      payload: { exitId: 'clearing-to-bridge' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show available exits' }));
    expect(screen.getByRole('group', { name: 'Available directions' })).toContainElement(
      screen.getByRole('button', { name: 'Go south' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Return to quick commands' }));
    expect(screen.getByRole('button', { name: 'Show look targets' })).toBeVisible();
  });

  it('shows contextual quick actions for supported commands and carried items', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    expect(screen.queryByText('Quick', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show look targets' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Quick help' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show readable objects' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Show items to take' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show more quick actions' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show items to drop' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Show readable objects' }));
    const readableObjects = screen.getByRole('group', { name: 'Readable objects' });
    expect(readableObjects).toContainElement(screen.getByRole('button', { name: 'Read Weathered marker' }));
    fireEvent.click(screen.getByRole('button', { name: 'Read Weathered marker' }));
    await screen.findByText('OLD BELL TOWER — EAST');
    expect(history).toHaveTextContent('> read Weathered marker');
    expect(screen.getByRole('button', { name: 'Show more quick actions' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Show more quick actions' }));
    const moreQuickActions = screen.getByRole('group', { name: 'More quick actions' });
    expect(screen.queryByText('More', { exact: true })).not.toBeInTheDocument();
    expect(moreQuickActions).toContainElement(screen.getByRole('button', { name: 'Quick help' }));
    expect(moreQuickActions).toContainElement(screen.getByRole('button', { name: 'Show items to take' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show items to take' }));
    const itemsToTake = screen.getByRole('group', { name: 'Items to take' });
    expect(itemsToTake).toContainElement(screen.getByRole('button', { name: 'Take Loose stone' }));
    expect(itemsToTake).toContainElement(screen.getByRole('button', { name: 'Take all available items' }));

    fireEvent.click(screen.getByRole('button', { name: 'Take Loose stone' }));
    await screen.findByText('You pick up the loose stone.');
    expect(screen.getByRole('button', { name: 'Show look targets' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show more quick actions' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Take Loose stone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take all available items' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show more quick actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show items to take' }));
    const emptyTakeActions = screen.getByRole('group', { name: 'Items to take' });
    expect(emptyTakeActions).toHaveTextContent('Nothing to take here');
    fireEvent.click(screen.getByRole('button', { name: 'Return to more quick actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Return to main quick actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show look targets' }));
    const updatedLookTargets = screen.getByRole('group', { name: 'Things to look at' });
    expect(updatedLookTargets).toContainElement(screen.getByRole('button', { name: 'Look at Weathered marker' }));
    expect(screen.queryByRole('button', { name: 'Look at Loose stone' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Look around' }));
    await screen.findByText('A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east.');
    expect(screen.getAllByText('A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east. One loose stone bears a pale stripe.')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Show more quick actions' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show items to drop' }));
    const itemsToDrop = screen.getByRole('group', { name: 'Items to drop' });
    expect(itemsToDrop).toContainElement(screen.getByRole('button', { name: 'Drop Loose stone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Drop Loose stone' }));
    await screen.findByText('You put down the loose stone.');
    expect(screen.getByRole('button', { name: 'Show look targets' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show items to drop' }));
    expect(screen.getByRole('group', { name: 'Items to drop' })).toHaveTextContent('Nothing to drop');
    fireEvent.click(screen.getByRole('button', { name: 'Return to quick commands' }));
    expect(screen.getByRole('button', { name: 'Show more quick actions' })).toBeVisible();
  });

  it('shows Help on the second quick-action page and lets Take all pick up every room item', async () => {
    includeSecondTakeable = true;
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    fireEvent.click(screen.getByRole('button', { name: 'Show more quick actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Quick help' }));
    expect(history).toHaveTextContent('> help');
    expect(history).toHaveTextContent('Commands');
    expect(screen.getByRole('button', { name: 'Show look targets' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show more quick actions' }));

    fireEvent.click(screen.getByRole('button', { name: 'Show items to take' }));
    const itemsToTake = screen.getByRole('group', { name: 'Items to take' });
    expect(itemsToTake).toContainElement(screen.getByRole('button', { name: 'Take Loose stone' }));
    expect(itemsToTake).toContainElement(screen.getByRole('button', { name: 'Take Lost feather' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take all available items' }));

    await screen.findByText('You pick up the loose stone.');
    await screen.findByText('You pick up the lost feather.');
    expect(history).toHaveTextContent('> take all');
    expect(screen.getByRole('button', { name: 'Show look targets' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show more quick actions' })).toBeVisible();

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

    fireEvent.click(screen.getByRole('button', { name: 'Show more quick actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show items to take' }));
    expect(screen.getByRole('group', { name: 'Items to take' })).toHaveTextContent('Nothing to take here');
  });

  it('surfaces rejected movement without changing rooms or leaving controls disabled', async () => {
    moveError = 'Exit is blocked.';
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    quickGo('north');
    await screen.findByText('Exit is blocked.');
    expect(screen.getByRole('heading', { name: 'Mossgate Clearing' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show available exits' })).toBeEnabled();
  });

  it('restores and persists the selected theme', async () => {
    window.localStorage.setItem('mudd-theme', 'dark');
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    expect(screen.getByRole('main')).toHaveAttribute('data-theme', 'dark');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem('mudd-theme')).toBe('light');
  });

  it('responds to browser back/forward when changing gameplay screens', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    fireEvent.click(screen.getByRole('link', { name: 'Traveler' }));
    await screen.findByRole('heading', { name: 'Traveler' });
    act(() => {
      window.location.hash = '#/play';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
  });
});
