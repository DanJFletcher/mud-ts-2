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
let itemTaken: boolean;

function currentLocation() {
  return {
    worldInstanceId: 'mudd-demo-instance',
    locationId: room === 'clearing' ? 'mossgate-clearing' : 'glasswater-bridge',
    title: room === 'clearing' ? 'Mossgate Clearing' : 'Glasswater Bridge',
    description: room === 'clearing' ? 'Pale stones break through the moss. One loose stone bears a pale stripe.' : 'A stone bridge crosses clear water.',
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
    ] : [],
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
  itemTaken = false;
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/game') {
      return json({
        player: { id: 'account-1', displayName: 'Traveler' },
        character: {
          characterId,
          worldInstanceId: 'mudd-demo-instance',
          name: 'Rowan',
          locationId: currentLocation().locationId,
          revision,
          inventory: itemTaken ? [{
            id: 'mossgate-loose-stone',
            label: 'Loose stone',
            description: 'A smooth, palm-sized stone with a pale stripe running through it.',
          }] : [],
        },
        location: currentLocation(),
      });
    }
    if (path === '/api/queries') {
      const query = JSON.parse(String(init?.body ?? '{}')) as { type?: string; payload?: { objectId?: string } };
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
      const command = JSON.parse(String(init?.body ?? '{}')) as { type?: string };
      if (command.type === 'character.take') {
        itemTaken = true;
        revision += 1;
        return json({ receipt: { ok: true, newAggregateVersion: revision }, streamId: characterId });
      }
      if (command.type === 'character.drop') {
        itemTaken = false;
        revision += 1;
        return json({ receipt: { ok: true, newAggregateVersion: revision }, streamId: characterId });
      }
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
    await screen.findByText('Pale stones break through the moss. One loose stone bears a pale stripe.');
    expect(screen.getAllByText('Pale stones break through the moss. One loose stone bears a pale stripe.')).toHaveLength(1);
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
    expect(screen.getByText('Pale stones break through the moss. One loose stone bears a pale stripe.')).toBeVisible();
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
      expect(screen.getAllByText('Pale stones break through the moss. One loose stone bears a pale stripe.')).toHaveLength(2);
    });
    expect(apiFetch.mock.calls.some(([path]) => path === '/api/queries')).toBe(true);
    expect(history).toHaveTextContent('> look');
    expect(screen.getByRole('region', { name: 'Available exits' })).toContainElement(
      screen.getByRole('button', { name: 'North to Glasswater Bridge' }),
    );
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

    fireEvent.click(screen.getByRole('button', { name: 'North to Glasswater Bridge' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'North to Glasswater Bridge' }));
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

  it('switches quick commands from look to available walking directions', async () => {
    render(<WorldClient onLeaveWorld={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByRole('heading', { name: 'Mossgate Clearing' });
    const history = screen.getByRole('region', { name: 'Terminal output' });

    fireEvent.click(screen.getByRole('button', { name: 'Quick look' }));
    await waitFor(() => expect(screen.getAllByText('> look')).toHaveLength(2));
    expect(apiFetch.mock.calls.some(([path]) => path === '/api/queries')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Show walking directions' }));
    expect(screen.queryByRole('button', { name: 'Quick look' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Walking directions' })).toContainElement(
      screen.getByRole('button', { name: 'Go north' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Go north' }));
    await screen.findByRole('heading', { name: 'Glasswater Bridge' });
    expect(history).toHaveTextContent('> go north');
    expect(history).toHaveTextContent('You travel north.');
    expect(screen.getByRole('button', { name: 'Go south' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Quick look' })).not.toBeInTheDocument();

    const moveCommand = JSON.parse(
      apiFetch.mock.calls.find(([path]) => path === '/api/commands')?.[1].body as string,
    );
    expect(moveCommand).toMatchObject({
      type: 'character.move',
      characterId,
      expectedVersion: 1,
      payload: { exitId: 'clearing-to-bridge' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Return to quick commands' }));
    expect(screen.getByRole('button', { name: 'Quick look' })).toBeVisible();
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
