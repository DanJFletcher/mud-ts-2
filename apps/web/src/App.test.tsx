import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => {
  const apiFetch = vi.fn();
  vi.stubGlobal('fetch', apiFetch);
  return { apiFetch };
});

import App from './App.js';

const characterId = '11111111-1111-4111-8111-111111111111';
let created: boolean;
let revision: number;
let currentRoom: 'clearing' | 'bridge';
let rejectMove: boolean;
let rejectCreate: boolean;
let offline: boolean;

function location() {
  return {
    worldInstanceId: 'mudd-demo-instance',
    locationId: currentRoom === 'clearing' ? 'mossgate-clearing' : 'glasswater-bridge',
    title: currentRoom === 'clearing' ? 'Mossgate Clearing' : 'Glasswater Bridge',
    description: currentRoom === 'clearing' ? 'Pale stones break through the moss.' : 'A stone bridge crosses clear water.',
    revision,
    exits: [{
      id: currentRoom === 'clearing' ? 'clearing-to-bridge' : 'bridge-to-clearing',
      label: currentRoom === 'clearing' ? 'North to Glasswater Bridge' : 'South to Mossgate Clearing',
      direction: currentRoom === 'clearing' ? 'north' : 'south',
      available: true,
    }],
  };
}

function snapshot() {
  return {
    player: { id: 'guest-1', displayName: 'Guest' },
    ...(created ? {
      character: { characterId, name: 'Rowan', worldInstanceId: 'mudd-demo-instance', locationId: location().locationId, revision },
      location: location(),
    } : {}),
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function postedCommands() {
  return apiFetch.mock.calls
    .filter(([path]) => path === '/api/commands')
    .map(([, init]) => JSON.parse(init.body as string));
}

async function navigate(name: string) {
  fireEvent.click(screen.getByRole('link', { name }));
  await waitFor(() => expect(screen.getByRole('link', { name })).toHaveAttribute('aria-current', 'page'));
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.stubGlobal('scrollTo', vi.fn());
  created = true;
  revision = 1;
  currentRoom = 'clearing';
  rejectMove = false;
  rejectCreate = false;
  offline = false;
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (offline) throw new Error('Connection lost.');
    if (path === '/api/game') return json(snapshot());
    const command = JSON.parse(init?.body as string);
    if (path === '/api/queries') return json({ ok: true, value: location() });
    if (command.type === 'character.create') {
      if (rejectCreate) return json({ message: 'That name is unavailable.' }, 409);
      created = true;
      return json({ receipt: { ok: true, newAggregateVersion: revision } });
    }
    if (rejectMove) return json({ message: 'Exit is blocked.' }, 409);
    currentRoom = currentRoom === 'clearing' ? 'bridge' : 'clearing';
    revision += 1;
    return json({ receipt: { ok: true, newAggregateVersion: revision } });
  });
});

describe('mobile gameplay client', () => {
  it('keeps Play focused and separates Traveler and Field notes with real navigation', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    expect(screen.queryByText(/No rush|The world is waiting|Pay attention/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Traveler' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Field notes' })).not.toBeInTheDocument();

    await navigate('Traveler');
    expect(window.location.hash).toBe('#/traveler');
    expect(screen.getByRole('heading', { name: 'Rowan' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Look around' })).not.toBeInTheDocument();

    await navigate('Field notes');
    expect(screen.getByText(/No activity this session/)).toBeVisible();
    await navigate('Play');
    expect(screen.getByRole('heading', { name: 'Mossgate Clearing' })).toBeVisible();
    act(() => {
      window.location.hash = '#/traveler';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await screen.findByRole('heading', { name: 'Traveler' });
  });

  it('uses the real SDK for button movement, typed movement, and Look; keeps notes across screens', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    fireEvent.click(screen.getByRole('button', { name: 'North to Glasswater Bridge' }));
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    expect(postedCommands()[0]).toMatchObject({
      type: 'character.move',
      characterId,
      expectedVersion: 1,
      payload: { exitId: 'clearing-to-bridge' },
    });
    const input = screen.getByRole('textbox', { name: 'Enter a command' });
    fireEvent.change(input, { target: { value: 'go south' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    expect(postedCommands()[1]).toMatchObject({ expectedVersion: 2, payload: { exitId: 'bridge-to-clearing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look around' }));
    await waitFor(() => expect(apiFetch.mock.calls.some(([path]) => path === '/api/queries')).toBe(true));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Look around' })).toBeEnabled());
    await navigate('Field notes');
    const notes = screen.getByRole('region', { name: 'Field notes' });
    expect(within(notes).getByText('You travel north.')).toBeVisible();
    expect(within(notes).getByText('You travel south.')).toBeVisible();
    expect(within(notes).getByText(/You look around/)).toBeVisible();
    await navigate('Play');
    expect(screen.getByRole('heading', { name: 'Mossgate Clearing' })).toBeVisible();
  });

  it('creates a real guest character and keeps the form available after a rejected name', async () => {
    created = false;
    rejectCreate = true;
    render(<App />);
    const name = await screen.findByRole('textbox', { name: 'Name' });
    fireEvent.change(name, { target: { value: 'Rowan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Begin' }));
    await screen.findByText('That name is unavailable.');
    expect(name).toHaveValue('Rowan');
    rejectCreate = false;
    fireEvent.click(screen.getByRole('button', { name: 'Begin' }));
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    expect(postedCommands()[1]).toMatchObject({ type: 'character.create', payload: { name: 'Rowan' } });
  });

  it('shows command and server errors without changing location or leaving controls disabled', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Enter a command' }), { target: { value: 'go west' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('No available exit matches “west”.');
    expect(postedCommands()).toHaveLength(0);
    rejectMove = true;
    fireEvent.click(screen.getByRole('button', { name: 'North to Glasswater Bridge' }));
    await screen.findByText('Exit is blocked.');
    expect(screen.getByRole('heading', { name: 'Mossgate Clearing' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'North to Glasswater Bridge' })).toBeEnabled();
  });

  it('recovers from an initial connection failure and restores a bookmarked screen', async () => {
    offline = true;
    window.history.replaceState(null, '', '/#/traveler');
    render(<App />);
    await screen.findByRole('alert');
    expect(screen.getByText('Traveler details are unavailable.')).toBeVisible();
    offline = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('heading', { name: 'Rowan' });
    expect(screen.getByRole('link', { name: 'Traveler' })).toHaveAttribute('aria-current', 'page');
  });

  it('restores and persists the theme in the real client', async () => {
    window.localStorage.setItem('mudd-theme', 'dark');
    render(<App />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    expect(screen.getByRole('main')).toHaveAttribute('data-theme', 'dark');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem('mudd-theme')).toBe('light');
  });
});
