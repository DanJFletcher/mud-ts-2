import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterRosterSnapshot } from '@mudd/client-sdk';

const { apiFetch, clerkSignOut, navigate } = vi.hoisted(() => {
  const apiFetch = vi.fn();
  const clerkSignOut = vi.fn().mockResolvedValue(undefined);
  const navigate = vi.fn();
  vi.stubGlobal('fetch', apiFetch);
  return { apiFetch, clerkSignOut, navigate };
});

vi.mock('@clerk/react', () => ({
  useUser: () => ({ user: { fullName: 'Rowan Example', primaryEmailAddress: { emailAddress: 'rowan@example.test' } } }),
  useClerk: () => ({ signOut: clerkSignOut }),
}));
vi.mock('@clerk/react/internal', () => ({ publishableKeyFromHost: () => 'pk_test_example' }));
vi.mock('@clerk/themes', () => ({ shadcn: {} }));
vi.mock('wouter', () => ({ useLocation: () => ['/characters', navigate] }));

import { CharacterRoster, GuestPlayButton, GuestWorldPage } from './AccountApp.js';

vi.mock('./App.js', () => ({
  WorldClient: () => <div>World play</div>,
}));

const firstCharacter = {
  worldInstanceId: 'mudd-demo-instance',
  characterId: '11111111-1111-4111-8111-111111111111',
  name: 'Rowan',
  locationId: 'mossgate-clearing',
  locationTitle: 'Mossgate Clearing',
  visitedLocationIds: ['mossgate-clearing'],
  revision: 1,
  inventory: [],
  equipment: { weaponItemId: null, armorItemId: null },
  availableClassActions: [],
  attributes: { strength: 10, intelligence: 10, constitution: 10, dexterity: 10 },
  honors: { glory: 0, medals: 0 },
  resources: {
    stamina: { current: 100, maximum: 100 },
    mana: { current: 100, maximum: 100 },
  },
  purchasedMerchantListingIds: [],
  itemLocations: [],
  claimedContainerItemIds: [],
  claimedCorpseGoldIds: [],
  npcProgress: [],
  readableObservations: [],
  itemUseObservations: [],
  questProgress: [],
  questRewardedIds: [],
  archived: false,
};
const secondCharacter = {
  ...firstCharacter,
  characterId: '22222222-2222-4222-8222-222222222222',
  name: 'Moss',
  locationId: 'glasswater-bridge',
  locationTitle: 'Glasswater Bridge',
  visitedLocationIds: ['mossgate-clearing', 'glasswater-bridge'],
};
const availableWorlds = [
  { worldInstanceId: 'mudd-demo-instance', packId: 'mudd.first-steps', name: 'The Waystone Path', summary: 'Mossgate and the old bell tower.' },
  {
    worldInstanceId: 'orraveth-bellwold-instance',
    packId: 'orraveth.bellwold',
    name: 'Orraveth: Bellwold',
    summary: 'A frontier village with an old bell.',
    classCatalog: {
      id: 'bellwold-classes',
      revision: 1,
      classes: [{
        id: 'warden',
        revision: 1,
        label: 'Warden',
        description: 'A measured protector.',
        primaryAttribute: 'strength' as const,
        attributes: { strength: 14, intelligence: 8, constitution: 13, dexterity: 10 },
        coreAction: {
          id: 'shield-break',
          revision: 1,
          label: 'Shield break',
          description: 'A deliberate strike.',
          cost: { resource: 'stamina' as const, amount: 3 },
          baseDamage: 6,
          scalingAttribute: 'strength' as const,
          weaponBonus: true,
        },
      }],
    },
  },
];

let characters: CharacterRosterSnapshot['characters'];
let active: CharacterRosterSnapshot['activeWorldSession'];
let activeWorldId: string | null;
const commandBodies: Array<Record<string, unknown>> = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function commandRequest(body: Record<string, unknown>) {
  commandBodies.push(body);
  if (body.type === 'character.create') {
    characters.unshift({
      ...firstCharacter,
      worldInstanceId: String(body.worldInstanceId ?? 'mudd-demo-instance'),
      characterId: '33333333-3333-4333-8333-333333333333',
      name: (body.payload as { name: string }).name,
      revision: 1,
      archived: false,
    });
  } else if (body.type === 'character.rename') {
    const character = characters.find((item) => item.characterId === body.characterId);
    if (character) {
      character.name = (body.payload as { name: string }).name;
      character.revision += 1;
    }
  } else if (body.type === 'character.archive') {
    const character = characters.find((item) => item.characterId === body.characterId);
    if (character) {
      character.archived = true;
      character.revision += 1;
    }
  } else if (body.type === 'character.restore') {
    const character = characters.find((item) => item.characterId === body.characterId);
    if (character) {
      character.archived = false;
      character.revision += 1;
    }
  }
  return json({
    receipt: {
      ok: true,
      commandId: String(body.commandId),
      eventIds: [],
      newAggregateVersion: 2,
    },
  });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
  characters = [{ ...firstCharacter }, { ...secondCharacter }];
  active = null;
  activeWorldId = null;
  commandBodies.length = 0;
  apiFetch.mockReset();
  clerkSignOut.mockClear();
  navigate.mockClear();
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/characters') {
      return json({
        player: { id: 'account-1', displayName: 'Traveler' },
        characters: characters.map((character) => ({ ...character })),
        activeWorldSession: active,
        activeWorldSessions: active && activeWorldId
          ? [{ ...active, worldInstanceId: activeWorldId }]
          : [],
      });
    }
    if (path === '/api/worlds') return json(availableWorlds);
    if (path === '/api/commands') return commandRequest(JSON.parse(init?.body as string));
    if (path === '/api/world-session' && init?.method === 'POST') {
      const body = JSON.parse(init.body as string) as { characterId: string; worldInstanceId?: string };
      const characterId = body.characterId;
      if (active && active.characterId !== characterId) return json({ message: 'Leave the current world session before switching characters.' }, 409);
      active = { id: 'session-1', characterId };
      activeWorldId = body.worldInstanceId ?? 'mudd-demo-instance';
      return json({ sessionId: active.id, characterId });
    }
    if (path === '/api/world-session' && init?.method === 'DELETE') {
      active = null;
      activeWorldId = null;
      return new Response(null, { status: 204 });
    }
    return json({ message: 'Not found.' }, 404);
  });
});

describe('account character roster', () => {
  it('creates a character in the selected world while preserving characters from the other world', async () => {
    render(<CharacterRoster />);
    await screen.findByRole('heading', { name: 'Rowan' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Select a world' }), {
      target: { value: 'orraveth-bellwold-instance' },
    });
    await screen.findByRole('textbox', { name: 'Character name' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Character name' }), { target: { value: 'Anwen' } });
    const warden = screen.getByRole('radio', { name: /Warden/ });
    expect(warden).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Create character' })).toBeDisabled();
    fireEvent.click(warden);
    fireEvent.click(screen.getByRole('button', { name: 'Create character' }));
    await screen.findByRole('heading', { name: 'Anwen' });

    expect(commandBodies[0]).toMatchObject({
      type: 'character.create',
      worldInstanceId: 'orraveth-bellwold-instance',
      payload: { name: 'Anwen', classId: 'warden' },
    });
    expect(screen.getByRole('heading', { name: 'Rowan' })).toBeInTheDocument();
    expect(window.localStorage.getItem('mudd-world-instance-id')).toBe('orraveth-bellwold-instance');
  });

  it('creates multiple characters on the signed-in account', async () => {
    render(<CharacterRoster />);
    await screen.findByRole('heading', { name: 'Rowan' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Character name' }), { target: { value: 'Willow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create character' }));
    await screen.findByRole('heading', { name: 'Willow' });
    expect(commandBodies[0]).toMatchObject({
      type: 'character.create',
      payload: { name: 'Willow' },
    });
    expect(screen.getByRole('button', { name: /Characters/ })).toHaveTextContent('3');
  });

  it('renames and archives characters through versioned engine commands', async () => {
    render(<CharacterRoster />);
    await screen.findByRole('heading', { name: 'Rowan' });
    fireEvent.click(screen.getByRole('button', { name: 'Rename Rowan' }));
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Character name' })[0], { target: { value: 'Fern' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await screen.findByRole('heading', { name: 'Fern' });
    fireEvent.click(screen.getByRole('button', { name: 'Archive Moss' }));
    await screen.findByText('Archive Moss?');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Moss' })).not.toBeInTheDocument());
    expect(commandBodies.map((body) => body.type)).toEqual(['character.rename', 'character.archive']);
    expect(commandBodies[0]).toMatchObject({ expectedVersion: 1, payload: { name: 'Fern' } });
    expect(commandBodies[1]).toMatchObject({ expectedVersion: 1, characterId: secondCharacter.characterId });
  });

  it('keeps archived characters recoverable from the account roster', async () => {
    render(<CharacterRoster />);
    await screen.findByRole('heading', { name: 'Rowan' });
    fireEvent.click(screen.getByRole('button', { name: 'Archive Moss' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Moss' })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Archived/ }));
    await screen.findByRole('heading', { name: 'Moss' });
    fireEvent.click(screen.getByRole('button', { name: 'Restore Moss' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Moss' })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Characters/ }));
    await screen.findByRole('heading', { name: 'Moss' });
    expect(commandBodies.map((body) => body.type)).toEqual(['character.archive', 'character.restore']);
  });

  it('marks dead characters as game over, leaves the session, and lets the account start fresh', async () => {
    characters[0] = {
      ...firstCharacter,
      combat: {
        encounterId: 'dead-encounter',
        locationId: 'mossgate-clearing',
        opponentNpcId: 'mossgate-training-sentinel',
        opponentName: 'Practice Sentinel',
        opponentStyle: 'steady',
        round: 2,
        playerHealth: 0,
        playerMaxHealth: 6,
        opponentHealth: 1,
        opponentMaxHealth: 4,
        status: 'defeat',
        lastAction: 'attack',
        lastNarration: 'You fall beneath the sentinel’s final strike.',
      },
    };
    active = { id: 'dead-session', characterId: firstCharacter.characterId };
    render(<CharacterRoster />);

    expect(await screen.findByRole('complementary', { name: 'Active world session' })).toHaveTextContent('has died');
    expect(screen.getByRole('button', { name: 'Leave world to start over' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Game over' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Leave world to start over' }));
    await waitFor(() => expect(active).toBeNull());

    fireEvent.change(screen.getByRole('textbox', { name: 'Character name' }), { target: { value: 'Rowan Again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create character' }));
    await screen.findByRole('heading', { name: 'Rowan Again' });
    expect(commandBodies.at(-1)).toMatchObject({
      type: 'character.create',
      payload: { name: 'Rowan Again' },
    });
  });

  it('binds one character to the world session and requires leaving before switching', async () => {
    render(<CharacterRoster />);
    await screen.findByRole('heading', { name: 'Rowan' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Enter world' })[0]);
    const activeBanner = await screen.findByRole('complementary', { name: 'Active world session' });
    expect(activeBanner).toHaveTextContent('Playing as Rowan.');
    expect(active?.characterId).toBe(firstCharacter.characterId);
    expect(screen.getAllByRole('button', { name: 'Leave world to switch' })[0]).toBeEnabled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Leave world to switch' })[0]);
    await waitFor(() => expect(active).toBeNull());
    fireEvent.click(screen.getAllByRole('button', { name: 'Enter world' })[1]);
    await waitFor(() => expect(active?.characterId).toBe(secondCharacter.characterId));
    expect(navigate).toHaveBeenCalledWith('/world');
  });
});

describe('guest entry', () => {
  it('starts a guest identity and routes to world selection without creating a character yet', async () => {
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/guest-session') {
        expect(init?.method).toBe('POST');
        return json({ player: { id: 'guest-player', displayName: 'Traveler GUEST' } });
      }
      return json({ message: 'Not found.' }, 404);
    });

    render(<GuestPlayButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Play as guest' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/guest-world'));
    expect(apiFetch.mock.calls.map(([path]) => path)).toEqual(['/api/guest-session']);
    expect(screen.queryByRole('textbox', { name: 'Character name' })).not.toBeInTheDocument();
  });

  it('routes returning guests to world selection so they can resume or choose another world', async () => {
    apiFetch.mockImplementation(async (path: string, _init?: RequestInit) => {
      if (path === '/api/guest-session') {
        return json({ player: { id: 'guest-player', displayName: 'Traveler GUEST' } });
      }
      return json({ message: 'Not found.' }, 404);
    });

    render(<GuestPlayButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Play as guest' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/guest-world'));
    expect(screen.queryByRole('textbox', { name: 'Character name' })).not.toBeInTheDocument();
    expect(apiFetch.mock.calls.map(([path]) => path)).toEqual(['/api/guest-session']);
  });

  it('lets a guest create and enter a character in a selected world', async () => {
    const guestCommands: Record<string, unknown>[] = [];
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/guest-session') return json({ player: { id: 'guest-player', displayName: 'Traveler GUEST' } });
      if (path === '/api/worlds') return json(availableWorlds);
      if (path === '/api/characters') {
        return json({
          player: { id: 'guest-player', displayName: 'Traveler GUEST' },
          characters: [],
          activeWorldSession: null,
          activeWorldSessions: [],
        });
      }
      if (path === '/api/commands') {
        guestCommands.push(JSON.parse(String(init?.body)));
        return json({
          receipt: { ok: true, commandId: 'guest-create', eventIds: [], newAggregateVersion: 1 },
          streamId: 'guest-orraveth-character',
        });
      }
      if (path === '/api/world-session' && init?.method === 'POST') {
        return json({ sessionId: 'guest-world-session', characterId: 'guest-orraveth-character' });
      }
      return json({ message: 'Not found.' }, 404);
    });

    render(<GuestWorldPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Orraveth: Bellwold/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New character name' }), { target: { value: 'Willow' } });
    fireEvent.click(screen.getByRole('radio', { name: /Warden/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create and enter' }));

    expect(await screen.findByText('World play')).toBeInTheDocument();
    expect(guestCommands[0]).toMatchObject({
      type: 'character.create',
      worldInstanceId: 'orraveth-bellwold-instance',
      payload: { name: 'Willow', classId: 'warden' },
    });
    const sessionRequest = apiFetch.mock.calls.find(([path]) => path === '/api/world-session' && (apiFetch.mock.calls.find(([candidate]) => candidate === path)?.[1] as RequestInit | undefined)?.method === 'POST');
    expect(JSON.parse(String(sessionRequest?.[1]?.body))).toMatchObject({
      worldInstanceId: 'orraveth-bellwold-instance',
    });
  });
});
