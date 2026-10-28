import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterRosterSnapshot, WorldSummary } from '@mudd/client-sdk';
import { DEFAULT_CHARACTER_EQUIPMENT } from '@mudd/contracts';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), signOut: vi.fn(), signedIn: true,
}));
vi.stubGlobal('fetch', mocks.fetch);
vi.mock('@clerk/react', () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: mocks.signedIn }),
  useClerk: () => ({ signOut: mocks.signOut }),
  ClerkProvider: ({ children }: { children: ReactNode }) => children,
  SignIn: ({ forceRedirectUrl }: { forceRedirectUrl: string }) => <div>Sign in return: {forceRedirectUrl}</div>,
  SignUp: ({ forceRedirectUrl }: { forceRedirectUrl: string }) => <div>Sign up return: {forceRedirectUrl}</div>,
}));
vi.mock('@clerk/react/internal', () => ({ publishableKeyFromHost: () => 'pk_test_example' }));
vi.mock('@clerk/themes', () => ({ shadcn: {} }));
vi.mock('./App.js', () => ({
  WorldClient: ({ worldInstanceId, onLeaveWorld }: { worldInstanceId: string; onLeaveWorld: () => void }) =>
    <div>World play: {worldInstanceId}<button onClick={onLeaveWorld}>Leave world</button></div>,
}));
vi.mock('./codex/CodexScreen.js', () => ({ default: () => <h1>Orraveth Codex</h1> }));
import AccountApp from './AccountApp.js';

const demo = 'mudd-demo-instance';
const orra = 'orraveth-bellwold-instance';
const one = '11111111-1111-4111-8111-111111111111';
const two = '22222222-2222-4222-8222-222222222222';
const three = '33333333-3333-4333-8333-333333333333';
const sessionId = '44444444-4444-4444-8444-444444444444';
const playerId = '55555555-5555-4555-8555-555555555555';
let holdRoster: boolean;
let releaseRoster: (() => void) | undefined;
const worlds: WorldSummary[] = [
  { worldInstanceId: demo, packId: 'demo', name: 'The Waystone Path', summary: 'An old bell tower.' },
  { worldInstanceId: orra, packId: 'orraveth', name: 'Orraveth: Bellwold', summary: 'A frontier village.',
    classCatalog: { id: 'classes', revision: 1, classes: [{
      id: 'warden', revision: 1, label: 'Warden', description: 'A measured protector.',
      primaryAttribute: 'strength', attributes: { strength: 14, intelligence: 8, constitution: 13, dexterity: 10 },
      coreAction: { id: 'shield-break', revision: 1, label: 'Shield break', description: 'A deliberate strike.',
        cost: { resource: 'stamina', amount: 3 }, baseDamage: 6, scalingAttribute: 'strength', weaponBonus: true },
    }] } },
];
const fixture: CharacterRosterSnapshot['characters'][number] = {
  worldInstanceId: demo, characterId: one, name: 'Rowan', worldName: 'The Waystone Path',
  locationId: 'mossgate-clearing', locationTitle: 'Mossgate Clearing', visitedLocationIds: ['mossgate-clearing'],
  revision: 1, inventory: [], equipment: DEFAULT_CHARACTER_EQUIPMENT, availableClassActions: [],
  dailyJobs: [], supplyCollections: [],
  attributes: { strength: 10, intelligence: 10, constitution: 10, dexterity: 10 }, honors: { glory: 0, medals: 0 },
  resources: { stamina: { current: 100, maximum: 100 }, mana: { current: 100, maximum: 100 } },
  staminaRecovery: {
    posture: 'standing',
    lastSettledAt: null,
    fractionalCarry: 0,
    healthFractionalCarry: 0,
    manaFractionalCarry: 0,
  },
  purchasedMerchantListingIds: [], itemLocations: [], claimedContainerItemIds: [], claimedCorpseGoldIds: [],
  npcProgress: [], readableObservations: [], itemUseObservations: [], questProgress: [], questRewardedIds: [],
  archived: false, lastPlayedAt: null,
};
let characters: CharacterRosterSnapshot['characters'];
let sessions: NonNullable<CharacterRosterSnapshot['activeWorldSessions']>;
let guest: boolean;
let entryFailure: boolean;
let rosterFailure: boolean;
const commands: Array<Record<string, unknown>> = [];
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }); }
function roster() { return { player: { id: playerId, displayName: 'Rowan' }, characters, activeWorldSession: null, activeWorldSessions: sessions }; }
function visit(path: string) {
  act(() => { history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')); });
}
function open(path = '/') { history.replaceState(null, '', path); return render(<AccountApp />); }
function calls(method: string, path: string) {
  return mocks.fetch.mock.calls.filter(([url, init]) => url === path && (init?.method ?? 'GET') === method);
}
async function fillName(value = 'Aster') {
  fireEvent.click(await screen.findByRole('button', { name: 'Create new character' }));
  fireEvent.change(await screen.findByLabelText('Character name'), { target: { value } });
}

beforeEach(() => {
  mocks.fetch.mockReset(); mocks.signOut.mockReset(); mocks.signedIn = true;
  characters = [{ ...fixture }, { ...fixture, characterId: two, worldInstanceId: orra, name: 'Moss', worldName: 'Orraveth: Bellwold', lastPlayedAt: '2026-10-23T10:00:00.000Z' }];
  characters[0].health = { current: 8, maximum: 12 };
  characters[0].wallet = { currencyId: 'silver', balance: 27 };
  characters[0].advancement = { level: 4, experience: 83 };
  characters[0].inventory = [{ id: 'healing-herb', label: 'Dried yarrow', description: 'A bundle of dried yarrow.', stackable: true, quantity: 3 }];
  sessions = []; guest = false; entryFailure = false; rosterFailure = false; holdRoster = false; releaseRoster = undefined; commands.length = 0;
  localStorage.clear(); sessionStorage.clear(); window.location.hash = '';
  mocks.fetch.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const world = (init.headers as Record<string, string>)?.['x-mudd-world-instance'] ?? demo;
    if (url === '/api/worlds') return json(worlds);
    if (url === '/api/characters') {
      if (holdRoster) await new Promise<void>((resolve) => { releaseRoster = resolve; });
      if (rosterFailure) return json({ message: 'Roster unavailable' }, 503);
      if (!mocks.signedIn && !guest) return json({ message: 'Start a guest session or sign in' }, 401);
      return json(roster());
    }
    if (url === '/api/guest-session') { guest = true; characters = []; return json({ player: { id: playerId, displayName: 'Guest' } }); }
    if (url === '/api/world-session' && method === 'POST') {
      const body = JSON.parse(String(init.body));
      if (entryFailure) return json({ message: 'Entry temporarily unavailable' }, 503);
      const occupied = sessions.find((item) => item.worldInstanceId === world);
      if (occupied && occupied.characterId !== body.characterId) return json({ message: 'Leave the current session first' }, 409);
      if (!occupied) sessions.push({ id: sessionId, characterId: body.characterId, worldInstanceId: world });
      return json({ sessionId, characterId: body.characterId });
    }
    if (url === '/api/world-session' && method === 'DELETE') { sessions = sessions.filter((item) => item.worldInstanceId !== world); return new Response(null, { status: 204 }); }
    if (url === '/api/commands') {
      const body = JSON.parse(String(init.body)); commands.push(body);
      if (body.type === 'character.create') characters.unshift({ ...fixture, characterId: three, name: body.payload.name, worldInstanceId: world, worldName: worlds.find((item) => item.worldInstanceId === world)!.name,
        ...(body.payload.classId ? { characterClass: { ...worlds[1].classCatalog!.classes[0], catalogId: 'classes', catalogRevision: 1 } } : {}) });
      else {
        const character = characters.find((item) => item.characterId === body.characterId)!;
        if (body.type === 'character.rename') character.name = body.payload.name;
        if (body.type === 'character.archive') character.archived = true;
        if (body.type === 'character.restore') character.archived = false;
        character.revision++;
      }
      return json({ receipt: { ok: true, commandId: body.commandId, eventIds: [], newAggregateVersion: 1 }, streamId: three });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
});

describe('world lobby and explicit character entry', () => {
  it('keeps account navigation in a collapsible header menu', async () => {
    const { container } = open();
    const toggle = container.querySelector<HTMLButtonElement>('.lobby-mobile-menu-toggle');
    const navigation = container.querySelector<HTMLElement>('#account-navigation');
    expect(toggle).not.toBeNull();
    expect(navigation).not.toBeNull();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle!);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(navigation).toHaveClass('is-open');
    expect(within(navigation!).getByRole('link', { name: 'Worlds' })).toBeInTheDocument();
    expect(within(navigation!).getByRole('link', { name: 'Codex' })).toBeInTheDocument();
    expect(within(navigation!).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(navigation).not.toHaveClass('is-open');
  });

  it('orders real recent history ahead of legacy nulls without auto-entering an active session', async () => {
    sessions = [{ id: sessionId, characterId: one, worldInstanceId: demo }];
    open();
    await screen.findByRole('heading', { name: 'Recent characters' });
    const recent = screen.getByRole('region', { name: 'Recent characters' });
    expect(within(recent).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Moss', 'Rowan']);
    expect(screen.getByRole('button', { name: 'Continue as Rowan' })).toBeEnabled();
    expect(calls('POST', '/api/world-session')).toHaveLength(0);
    expect(screen.getByRole('link', { name: /Orraveth: Bellwold/ })).toHaveAttribute('href', `/worlds/${orra}`);
  });
  it('limits the home recent-character section to the four most recently played characters', async () => {
    characters = Array.from({ length: 6 }, (_, index) => ({
      ...fixture,
      characterId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      name: `Traveler ${index + 1}`,
      lastPlayedAt: `2026-10-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
    }));
    open();
    await screen.findByRole('heading', { name: 'Recent characters' });
    const recent = screen.getByRole('region', { name: 'Recent characters' });
    expect(within(recent).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Traveler 6', 'Traveler 5', 'Traveler 4', 'Traveler 3',
    ]);
    expect(within(recent).getAllByRole('heading', { level: 3 })).toHaveLength(4);
  });
  it('browses anonymously without creating a guest and resolves direct world detail URLs', async () => {
    mocks.signedIn = false;
    open(`/worlds/${orra}`);
    await screen.findByRole('heading', { level: 1, name: 'Orraveth: Bellwold' });
    expect(calls('POST', '/api/guest-session')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Create new character' }));
    fireEvent.click(screen.getByRole('button', { name: 'Play as guest' }));
    await screen.findByLabelText('Character name');
    expect(calls('POST', '/api/guest-session')).toHaveLength(1);
  });
  it('filters characters by immutable world binding and enters the card’s world despite stale local selection', async () => {
    localStorage.setItem('mudd-world-instance-id', demo);
    open(`/worlds/${orra}`);
    await screen.findByRole('button', { name: 'Play as Moss' });
    expect(screen.queryByRole('button', { name: 'Play as Rowan' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Play as Moss' }));
    await screen.findByText(`World play: ${orra}`);
    expect(JSON.parse(calls('POST', '/api/world-session')[0][1].body).worldInstanceId).toBe(orra);
  });
  it('creates a classless character and enters it with one explicit action', async () => {
    open(`/worlds/${demo}`); await fillName();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create & play' }));
    await screen.findByText(`World play: ${demo}`);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ worldInstanceId: demo, payload: { name: 'Aster' } });
  });
  it('requires a class only for a world with a class catalog; guests use the same flow', async () => {
    mocks.signedIn = false; guest = true; characters = [];
    open(`/worlds/${orra}`); await fillName();
    expect(screen.getByRole('button', { name: 'Create & play' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Warden/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create & play' }));
    await screen.findByText(`World play: ${orra}`);
    expect(commands[0]).toMatchObject({ worldInstanceId: orra, payload: { classId: 'warden' } });
  });
  it('retains a successfully created character when joining fails and retries entry, never creation', async () => {
    entryFailure = true; open(`/worlds/${demo}`); await fillName();
    fireEvent.click(screen.getByRole('button', { name: 'Create & play' }));
    await screen.findByRole('button', { name: 'Retry entering world' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Entry temporarily unavailable');
    entryFailure = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry entering world' }));
    await screen.findByText(`World play: ${demo}`);
    expect(commands).toHaveLength(1);
  });
  it('requires explicit leave-and-switch and preserves sessions in unrelated worlds', async () => {
    characters.push({ ...fixture, characterId: three, name: 'Aster' });
    sessions = [{ id: sessionId, characterId: one, worldInstanceId: demo }, { id: sessionId, characterId: two, worldInstanceId: orra }];
    open(`/worlds/${demo}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Play as Aster' }));
    await screen.findByRole('region', { name: 'Switch characters' });
    expect(calls('DELETE', '/api/world-session')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Leave and play as Aster' }));
    await screen.findByText(`World play: ${demo}`);
    expect(sessions.find((item) => item.worldInstanceId === orra)?.characterId).toBe(two);
    expect(sessions.find((item) => item.worldInstanceId === demo)?.characterId).toBe(three);
  });
  it('offers return to the active character without ending the session', async () => {
    characters.push({ ...fixture, characterId: three, name: 'Aster' });
    sessions = [{ id: sessionId, characterId: one, worldInstanceId: demo }];
    open(`/worlds/${demo}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Play as Aster' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Return to active character' }));
    await screen.findByText(`World play: ${demo}`);
    expect(calls('DELETE', '/api/world-session')).toHaveLength(0);
  });
  it('leaves gameplay back to that world detail and handles refresh of direct play URLs', async () => {
    sessions = [{ id: sessionId, characterId: two, worldInstanceId: orra }];
    open(`/worlds/${orra}/play`);
    fireEvent.click(await screen.findByRole('button', { name: 'Leave world' }));
    await screen.findByRole('heading', { level: 1, name: 'Orraveth: Bellwold' });
    expect(location.pathname).toBe(`/worlds/${orra}`);
  });
  it('handles legacy routes and browser back/forward without automatically joining', async () => {
    open('/characters');
    await screen.findByRole('heading', { name: 'Recent characters' });
    visit(`/worlds/${orra}`);
    await screen.findByRole('heading', { level: 1, name: 'Orraveth: Bellwold' });
    visit('/');
    await screen.findByRole('heading', { name: 'Recent characters' });
    visit('/guest-world');
    await screen.findByRole('heading', { name: 'Recent characters' });
    expect(calls('POST', '/api/world-session')).toHaveLength(0);
  });
  it('shows a useful unknown world or missing-session screen, not gameplay', async () => {
    open('/worlds/missing');
    await screen.findByRole('heading', { name: 'World not found' });
    visit(`/worlds/${demo}/play`);
    await screen.findByRole('heading', { name: 'Choose a character to enter' });
    expect(calls('POST', '/api/world-session')).toHaveLength(0);
  });
  it('preserves world/creation intent across authentication', async () => {
    mocks.signedIn = false; open(`/worlds/${orra}?create=1`);
    fireEvent.click(await screen.findByRole('link', { name: 'Create account' }));
    expect(sessionStorage.getItem('mudd-entry-intent')).toBe(`/worlds/${orra}?create=1`);
    visit('/sign-up');
    await screen.findByText(`Sign up return: /worlds/${orra}?create=1`);
  });
  it('does not disguise a roster server failure as an anonymous guest session', async () => {
    rosterFailure = true; open(`/worlds/${demo}`);
    await screen.findByText('Roster unavailable');
    expect(screen.queryByRole('button', { name: 'Play as guest' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create new character' })).toBeDisabled();
    rosterFailure = false; fireEvent.click(screen.getByRole('button', { name: 'Retry characters' }));
    await screen.findByRole('button', { name: 'Play as Rowan' });
  });
  it('keeps rename/archive/restore as secondary actions and preserves death eligibility', async () => {
    characters[0].health = { current: 0, maximum: 10 };
    open(`/worlds/${demo}`);
    expect(await screen.findByRole('button', { name: 'Play as Rowan' })).toBeDisabled();
    fireEvent.click(screen.getByText('Manage'));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm archive' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Play as Rowan' })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Show archived' }));
    fireEvent.click(await screen.findByText('Manage'));
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(commands.some((body) => body.type === 'character.restore')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Show current characters' }));
    fireEvent.click(await screen.findByText('Manage'));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Character name'), { target: { value: 'Rowan II' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await screen.findByRole('button', { name: 'Play as Rowan II' });
  });

  it('loads a character detail route from the roster and shows only projected facts', async () => {
    open(`/character/${one}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Rowan' })).toBeInTheDocument();
    expect(screen.getAllByText('The Waystone Path')).toHaveLength(1);
    expect(screen.getByText('Mossgate Clearing')).toBeInTheDocument();
    expect(screen.getByText('8 / 12')).toBeInTheDocument();
    expect(screen.getByText('27 silver')).toBeInTheDocument();
    expect(screen.getByText('3 items')).toBeInTheDocument();
    expect(screen.getByText('Dried yarrow × 3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to world' })).toHaveAttribute('href', `/worlds/${demo}`);
    expect(screen.getByRole('button', { name: 'Play as Rowan' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Play as Rowan' }));
    await screen.findByText(`World play: ${demo}`);
    expect(calls('POST', '/api/world-session')).toHaveLength(1);
  });

  it('shows a composed loading state while the roster is pending', async () => {
    holdRoster = true;
    open(`/character/${one}`);
    expect(screen.getByRole('status')).toHaveTextContent('Loading character record');
    await waitFor(() => expect(releaseRoster).toBeDefined());
    releaseRoster?.();
    await screen.findByRole('heading', { name: 'Rowan' });
  });

  it('handles missing characters and anonymous no-roster state without creating guest sessions', async () => {
    open('/character/missing-character');
    expect(await screen.findByRole('heading', { name: 'Character not found' })).toBeInTheDocument();
    mocks.signedIn = false;
    visit(`/character/${one}`);
    expect(await screen.findByRole('heading', { name: 'Your roster is not available' })).toBeInTheDocument();
    expect(calls('POST', '/api/guest-session')).toHaveLength(0);
  });

  it('links compact character cards to details while keeping play and management actions', async () => {
    open(`/worlds/${demo}`);
    await screen.findByRole('button', { name: 'Play as Rowan' });
    expect(screen.getByRole('link', { name: 'Rowan' })).toHaveAttribute('href', `/character/${one}`);
    expect(screen.queryByText('Last known')).not.toBeInTheDocument();
    expect(screen.queryByText(/Last played/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play as Rowan' })).toBeEnabled();
    fireEvent.click(screen.getByText('Manage'));
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });
});
