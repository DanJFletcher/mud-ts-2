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

import { CharacterRoster } from './AccountApp.js';

const firstCharacter = {
  worldInstanceId: 'mudd-demo-instance',
  characterId: '11111111-1111-4111-8111-111111111111',
  name: 'Rowan',
  locationId: 'mossgate-clearing',
  locationTitle: 'Mossgate Clearing',
  revision: 1,
  inventory: [],
  archived: false,
};
const secondCharacter = {
  ...firstCharacter,
  characterId: '22222222-2222-4222-8222-222222222222',
  name: 'Moss',
  locationId: 'glasswater-bridge',
  locationTitle: 'Glasswater Bridge',
};

let characters: CharacterRosterSnapshot['characters'];
let active: CharacterRosterSnapshot['activeWorldSession'];
const commandBodies: Array<Record<string, unknown>> = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function commandRequest(body: Record<string, unknown>) {
  commandBodies.push(body);
  if (body.type === 'character.create') {
    characters.unshift({
      ...firstCharacter,
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
  return json({ receipt: { ok: true, newAggregateVersion: 2 } });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
  characters = [{ ...firstCharacter }, { ...secondCharacter }];
  active = null;
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
      });
    }
    if (path === '/api/commands') return commandRequest(JSON.parse(init?.body as string));
    if (path === '/api/world-session' && init?.method === 'POST') {
      const characterId = (JSON.parse(init.body as string) as { characterId: string }).characterId;
      if (active && active.characterId !== characterId) return json({ message: 'Leave the current world session before switching characters.' }, 409);
      active = { id: 'session-1', characterId };
      return json({ sessionId: active.id, characterId });
    }
    if (path === '/api/world-session' && init?.method === 'DELETE') {
      active = null;
      return new Response(null, { status: 204 });
    }
    return json({ message: 'Not found.' }, 404);
  });
});

describe('account character roster', () => {
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
