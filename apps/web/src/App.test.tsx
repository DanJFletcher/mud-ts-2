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
let revision: number;
let moveError: string | null;

function currentLocation() {
  return {
    worldInstanceId: 'mudd-demo-instance',
    locationId: room === 'clearing' ? 'mossgate-clearing' : 'glasswater-bridge',
    title: room === 'clearing' ? 'Mossgate Clearing' : 'Glasswater Bridge',
    description: room === 'clearing' ? 'Pale stones break through the moss.' : 'A stone bridge crosses clear water.',
    revision,
    exits: [{
      id: room === 'clearing' ? 'clearing-to-bridge' : 'bridge-to-clearing',
      label: room === 'clearing' ? 'North to Glasswater Bridge' : 'South to Mossgate Clearing',
      direction: room === 'clearing' ? 'north' : 'south',
      available: true,
    }],
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  room = 'clearing';
  revision = 1;
  moveError = null;
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/api/game') {
      return json({
        player: { id: 'account-1', displayName: 'Traveler' },
        character: { characterId, worldInstanceId: 'mudd-demo-instance', name: 'Rowan', locationId: currentLocation().locationId, revision },
        location: currentLocation(),
      });
    }
    if (path === '/api/queries') return json({ ok: true, value: currentLocation() });
    if (path === '/api/commands') {
      if (moveError) return json({ message: moveError }, 409);
      room = room === 'clearing' ? 'bridge' : 'clearing';
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
    await screen.findByText('Pale stones break through the moss.');
    expect(screen.getAllByText('Pale stones break through the moss.')).toHaveLength(1);
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
    expect(screen.getByText('Pale stones break through the moss.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Characters/ }));
    expect(onLeaveWorld).toHaveBeenCalledOnce();
  });

  it('uses real character-bound commands and retains the action history on Field notes', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });
    expect(history).toHaveClass('focused-terminal-history');
    expect(screen.getByRole('region', { name: 'Text command' })).toBeInTheDocument();
    expect(screen.getByText('Available paths')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'North to Glasswater Bridge' }));
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
    const history = screen.getByRole('region', { name: 'Terminal output' });
    const commandInput = screen.getByRole('textbox', { name: 'Enter a command' });
    fireEvent.change(commandInput, { target: { value: 'look' } });
    fireEvent.submit(commandInput.closest('form')!);

    await waitFor(() => {
      expect(screen.getAllByText('> look')).toHaveLength(2);
      expect(screen.getAllByText('Pale stones break through the moss.')).toHaveLength(2);
    });
    expect(apiFetch.mock.calls.some(([path]) => path === '/api/queries')).toBe(true);
    expect(history).toHaveTextContent('> look');
    expect(screen.getByRole('region', { name: 'Available exits' })).toContainElement(
      screen.getByRole('button', { name: 'North to Glasswater Bridge' }),
    );
  });

  it('surfaces rejected movement without changing rooms or leaving controls disabled', async () => {
    moveError = 'Exit is blocked.';
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    fireEvent.click(screen.getByRole('button', { name: 'North to Glasswater Bridge' }));
    await screen.findByText('Exit is blocked.');
    expect(screen.getByRole('heading', { name: 'Mossgate Clearing' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'North to Glasswater Bridge' })).toBeEnabled();
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
