import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterRosterSnapshot, WorldSummary } from '@mudd/client-sdk';
import { DEFAULT_CHARACTER_EQUIPMENT } from '@mudd/contracts';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), signOut: vi.fn(), signedIn: true, routerPush: vi.fn(), routerReplace: vi.fn(),
}));
vi.stubGlobal('fetch', mocks.fetch);
vi.mock('@clerk/react', () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: mocks.signedIn }),
  useClerk: () => ({ signOut: mocks.signOut }),
  ClerkProvider: ({ children, routerPush, routerReplace }: {
    children: ReactNode;
    routerPush: (to: string) => void;
    routerReplace: (to: string) => void;
  }) => {
    mocks.routerPush.mockImplementation(routerPush);
    mocks.routerReplace.mockImplementation(routerReplace);
    return children;
  },
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
let holdCatalog: boolean;
let releaseCatalog: (() => void) | undefined;
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
let catalogFailure: boolean;
let leaveFailure: boolean;
let holdLeave: boolean;
let releaseLeave: (() => void) | undefined;
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
  mocks.fetch.mockReset(); mocks.signOut.mockReset(); mocks.routerPush.mockReset(); mocks.routerReplace.mockReset(); mocks.signedIn = true;
  characters = [{ ...fixture }, { ...fixture, characterId: two, worldInstanceId: orra, name: 'Moss', worldName: 'Orraveth: Bellwold', lastPlayedAt: '2026-10-23T10:00:00.000Z' }];
  characters[0].health = { current: 8, maximum: 12 };
  characters[0].wallet = { currencyId: 'silver', balance: 27 };
  characters[0].advancement = { level: 4, experience: 83 };
  characters[0].inventory = [{ id: 'healing-herb', label: 'Dried yarrow', description: 'A bundle of dried yarrow.', stackable: true, quantity: 3 }];
  sessions = []; guest = false; entryFailure = false; rosterFailure = false; catalogFailure = false;
  leaveFailure = false; holdLeave = false; releaseLeave = undefined;
  holdRoster = false; releaseRoster = undefined;
  holdCatalog = false; releaseCatalog = undefined; commands.length = 0;
  localStorage.clear(); sessionStorage.clear(); window.location.hash = '';
  mocks.fetch.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const world = (init.headers as Record<string, string>)?.['x-mudd-world-instance'] ?? demo;
    if (url === '/api/worlds') {
      if (holdCatalog) await new Promise<void>((resolve) => { releaseCatalog = resolve; });
      if (catalogFailure) return json({ message: 'World catalog unavailable' }, 503);
      return json(worlds);
    }
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
    if (url === '/api/world-session' && method === 'DELETE') {
      if (holdLeave) await new Promise<void>((resolve) => { releaseLeave = resolve; });
      if (leaveFailure) return json({ message: 'Leaving the world failed' }, 503);
      sessions = sessions.filter((item) => item.worldInstanceId !== world);
      return new Response(null, { status: 204 });
    }
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
    const primary = container.querySelector<HTMLElement>('[aria-label="Primary navigation"]');
    expect(primary).not.toBeNull();
    expect(within(primary!).getByRole('link', { name: 'Worlds' })).toHaveAttribute('href', '/worlds');
    expect(within(primary!).getByRole('link', { name: 'Characters' })).toHaveAttribute('href', '/characters');
    expect(within(primary!).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(within(navigation!).getByRole('link', { name: 'Worlds' })).toHaveClass('lobby-desktop-nav-item');
    expect(within(navigation!).getByRole('link', { name: 'Characters' })).toHaveClass('lobby-desktop-nav-item');
    expect(within(navigation!).getByRole('button', { name: 'Sign out' })).toHaveClass('lobby-desktop-nav-item');
    expect(within(navigation!).getByRole('link', { name: 'Codex' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(navigation).not.toHaveClass('is-open');
  });
  it('keeps sign-in outside the mobile menu when signed out', async () => {
    mocks.signedIn = false;
    const { container } = open();
    expect(screen.getByRole('link', { name: 'Continue your journey' })).toHaveAttribute('href', '/sign-in');
    const primary = container.querySelector<HTMLElement>('[aria-label="Primary navigation"]');
    const navigation = container.querySelector<HTMLElement>('#account-navigation');
    expect(primary).not.toBeNull();
    expect(within(primary!).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
    fireEvent.click(container.querySelector<HTMLButtonElement>('.lobby-mobile-menu-toggle')!);
    expect(within(navigation!).getByRole('link', { name: 'Sign in' })).toHaveClass('lobby-desktop-nav-item');
  });

  it('routes Clerk navigation through the client router for push and replace', async () => {
    open('/');
    act(() => mocks.routerPush('/worlds'));
    expect(await screen.findByRole('heading', { name: 'Explore worlds' })).toBeInTheDocument();
    expect(location.pathname).toBe('/worlds');

    act(() => mocks.routerReplace('/codex'));
    expect(await screen.findByRole('heading', { name: 'Orraveth Codex' })).toBeInTheDocument();
    expect(location.pathname).toBe('/codex');
  });

  it('remembers the current destination when signing in from the header', async () => {
    mocks.signedIn = false;
    const { container } = open(`/worlds/${demo}`);
    const navigation = container.querySelector<HTMLElement>('#account-navigation')!;

    fireEvent.click(within(navigation).getByRole('link', { name: 'Sign in' }));

    expect(sessionStorage.getItem('mudd-entry-intent')).toBe(`/worlds/${demo}`);
    expect(await screen.findByText(`Sign in return: /worlds/${demo}`)).toBeInTheDocument();
  });

  it('remembers the current destination when signing in from the mobile navigation', async () => {
    mocks.signedIn = false;
    const { container } = open(`/worlds/${demo}`);
    const primary = container.querySelector<HTMLElement>('[aria-label="Primary navigation"]')!;

    fireEvent.click(within(primary).getByRole('link', { name: 'Sign in' }));

    expect(sessionStorage.getItem('mudd-entry-intent')).toBe(`/worlds/${demo}`);
    expect(await screen.findByText(`Sign in return: /worlds/${demo}`)).toBeInTheDocument();
  });

  it('signs out from both the mobile and desktop navigation actions', () => {
    const { container } = open();
    const primary = container.querySelector<HTMLElement>('[aria-label="Primary navigation"]')!;
    const navigation = container.querySelector<HTMLElement>('#account-navigation')!;

    fireEvent.click(within(primary).getByRole('button', { name: 'Sign out' }));
    fireEvent.click(within(navigation).getByRole('button', { name: 'Sign out' }));

    expect(mocks.signOut).toHaveBeenNthCalledWith(1, { redirectUrl: '/' });
    expect(mocks.signOut).toHaveBeenNthCalledWith(2, { redirectUrl: '/' });
  });

  it('toggles and persists the theme from the navigation', () => {
    const { container } = open();
    const toggle = container.querySelector<HTMLButtonElement>('.lobby-mobile-menu-toggle')!;
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(container.querySelector('.lobby-shell')).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem('mudd-theme')).toBe('dark');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(container.querySelector('.lobby-shell')).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem('mudd-theme')).toBe('light');
  });

  it('renders world discovery before the character roster request finishes', async () => {
    holdRoster = true;
    const { container } = open('/worlds');
    expect(await screen.findByRole('heading', { name: 'Explore worlds' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /The Waystone Path/ })).toHaveAttribute('href', `/worlds/${demo}`);
    expect(container.querySelectorAll('.mudd-character-entry--skeleton')).toHaveLength(2);
    await waitFor(() => expect(releaseRoster).toBeDefined());
    act(() => releaseRoster?.());
    expect(await screen.findByRole('button', { name: 'Play as Rowan' })).toBeInTheDocument();
    expect(container.querySelectorAll('.mudd-character-entry--skeleton')).toHaveLength(0);
  });

  it('renders world and character card placeholders while lobby data is pending', async () => {
    holdCatalog = true;
    holdRoster = true;
    const { container } = open('/worlds');
    expect(screen.getByRole('heading', { name: 'Where will you go next?' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading worlds' })).toBeInTheDocument();
    expect(container.querySelectorAll('.mudd-world-card--skeleton')).toHaveLength(2);
    expect(container.querySelectorAll('.mudd-character-entry--skeleton')).toHaveLength(2);
    await waitFor(() => {
      expect(releaseCatalog).toBeDefined();
      expect(releaseRoster).toBeDefined();
    });
    act(() => { releaseCatalog?.(); releaseRoster?.(); });
    expect(await screen.findByRole('link', { name: /The Waystone Path/ })).toHaveAttribute('href', `/worlds/${demo}`);
    expect(await screen.findByRole('button', { name: 'Play as Rowan' })).toBeInTheDocument();
    expect(container.querySelectorAll('.mudd-world-card--skeleton, .mudd-character-entry--skeleton')).toHaveLength(0);
  });

  it('shows the public home and enters the Worlds lobby through its main action', async () => {
    open('/');
    expect(await screen.findByRole('heading', { level: 1, name: /The road begins.*where the map ends/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue your journey' })).toHaveAttribute('href', '/worlds');
    fireEvent.click(screen.getByRole('link', { name: /Find your world/ }));
    await screen.findByRole('heading', { name: 'Explore worlds' });
    expect(window.location.pathname).toBe('/worlds');
    expect(calls('POST', '/api/world-session')).toHaveLength(0);
  });

  it('shows a catalog failure and recovers when worlds are retried', async () => {
    catalogFailure = true;
    open('/worlds');
    expect(await screen.findByRole('heading', { name: 'Worlds unavailable' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('World catalog unavailable');

    catalogFailure = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry worlds' }));
    expect(await screen.findByRole('heading', { name: 'Explore worlds' })).toBeInTheDocument();
  });

  it('shows a not-found state for a world missing from the catalog', async () => {
    open('/worlds/missing-world');

    expect(await screen.findByRole('heading', { name: 'World not found' })).toBeInTheDocument();
    expect(screen.getByText('This world is not available in the current catalog.')).toBeInTheDocument();
  });

  it('navigates to a world through the lobby without a document reload', async () => {
    open('/worlds');
    fireEvent.click(await screen.findByRole('link', { name: /The Waystone Path/ }));
    expect(await screen.findByRole('heading', { name: 'The Waystone Path' })).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/worlds/${demo}`);
  });

  it('navigates to all characters through the lobby without a document reload', async () => {
    open('/worlds');
    fireEvent.click(await screen.findByRole('link', { name: 'All characters' }));
    expect(await screen.findByRole('heading', { name: 'All characters' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/characters');
  });

  it('offers sign-in from the unavailable anonymous character directory', async () => {
    mocks.signedIn = false;
    open('/characters');
    expect(await screen.findByRole('heading', { name: 'Characters are not available' })).toBeInTheDocument();
    const emptyState = screen.getByText(
      'Sign in or start a guest session from a world to see your characters here.',
    ).closest('.lobby-empty')! as HTMLElement;

    fireEvent.click(within(emptyState).getByRole('link', { name: 'Sign in' }));

    expect(sessionStorage.getItem('mudd-entry-intent')).toBe('/worlds');
    expect(await screen.findByText('Sign in return: /worlds')).toBeInTheDocument();
  });

  it('scrolls the page to the top after client-side navigation', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo');
    open('/codex');
    expect(await screen.findByRole('heading', { name: 'Orraveth Codex' })).toBeInTheDocument();
    scrollTo.mockClear();

    visit('/worlds');

    expect(await screen.findByRole('heading', { name: 'Explore worlds' })).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    scrollTo.mockRestore();
  });

  it('shows world-detail placeholders while the catalog is pending', async () => {
    holdCatalog = true;
    const { container } = open(`/worlds/${demo}`);
    expect(screen.getByRole('status', { name: 'Loading world details' })).toBeInTheDocument();
    expect(container.querySelector('.mudd-world-hero')).toHaveClass('mudd-world-hero');
    await waitFor(() => expect(releaseCatalog).toBeDefined());
    act(() => releaseCatalog?.());
    expect(await screen.findByRole('heading', { level: 1, name: 'The Waystone Path' })).toBeInTheDocument();
  });

  it('loads the character list without waiting for an unused world catalog', async () => {
    holdRoster = true;
    const { container } = open('/characters');
    expect(await screen.findByRole('heading', { name: 'All characters' })).toBeInTheDocument();
    expect(container.querySelectorAll('.mudd-character-entry--skeleton')).toHaveLength(4);
    expect(calls('GET', '/api/worlds')).toHaveLength(0);
    await waitFor(() => expect(releaseRoster).toBeDefined());
    act(() => releaseRoster?.());
    expect(await screen.findByRole('button', { name: 'Play as Rowan' })).toBeInTheDocument();
    expect(container.querySelectorAll('.mudd-character-entry--skeleton')).toHaveLength(0);
  });

  it('shows the world hero and compact character placeholders before its roster arrives', async () => {
    holdRoster = true;
    const { container } = open(`/worlds/${demo}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'The Waystone Path' })).toBeInTheDocument();
    const placeholders = container.querySelectorAll('.mudd-character-entry--skeleton');
    expect(placeholders).toHaveLength(2);
    expect(placeholders[0].querySelector('.mudd-character-entry__skeleton-world')).toBeNull();
    await waitFor(() => expect(releaseRoster).toBeDefined());
    act(() => releaseRoster?.());
    expect(await screen.findByRole('button', { name: 'Play as Rowan' })).toBeInTheDocument();
  });

  it('orders real recent history ahead of legacy nulls without auto-entering an active session', async () => {
    sessions = [{ id: sessionId, characterId: one, worldInstanceId: demo }];
    open('/worlds');
    await screen.findByRole('heading', { name: 'Recent characters' });
    const recent = screen.getByRole('region', { name: 'Recent characters' });
    expect(within(recent).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Moss', 'Rowan']);
    expect(screen.getByRole('button', { name: 'Continue as Rowan' })).toBeEnabled();
    expect(calls('POST', '/api/world-session')).toHaveLength(0);
    expect(screen.getByRole('link', { name: /Orraveth: Bellwold/ })).toHaveAttribute('href', `/worlds/${orra}`);
    expect(within(recent).getByRole('link', { name: 'All characters' })).toHaveAttribute('href', '/characters');
  });
  it('limits the Worlds lobby recent-character section to four characters', async () => {
    characters = Array.from({ length: 6 }, (_, index) => ({
      ...fixture,
      characterId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      name: `Traveler ${index + 1}`,
      lastPlayedAt: `2026-10-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
    }));
    open('/worlds');
    await screen.findByRole('heading', { name: 'Recent characters' });
    const recent = screen.getByRole('region', { name: 'Recent characters' });
    expect(within(recent).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Traveler 6', 'Traveler 5', 'Traveler 4', 'Traveler 3',
    ]);
    expect(within(recent).getAllByRole('heading', { level: 3 })).toHaveLength(4);
  });
  it('hides the recent-character section on Worlds when the roster is empty', async () => {
    characters = [];
    open('/worlds');
    expect(await screen.findByRole('heading', { name: 'Explore worlds' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Recent characters' })).not.toBeInTheDocument());
  });
  it('shows every character, including archived ones, on the single-column roster page', async () => {
    characters = Array.from({ length: 6 }, (_, index) => ({
      ...fixture,
      characterId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      name: `Traveler ${index + 1}`,
      archived: index === 0,
      lastPlayedAt: `2026-10-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
    }));
    open('/characters');
    await screen.findByRole('heading', { level: 1, name: 'All characters' });
    const section = screen.getByRole('region', { name: 'Characters' });
    expect(section.querySelector('.lobby-character-list--all')).toBeInTheDocument();
    expect(within(section).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Traveler 6', 'Traveler 5', 'Traveler 4', 'Traveler 3', 'Traveler 2', 'Traveler 1',
    ]);
    expect(within(section).getByText('Archived')).toBeInTheDocument();
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(breadcrumb).getByRole('link', { name: 'Worlds' })).toHaveAttribute('href', '/worlds');
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
  it('can cancel a lobby character-switch prompt without leaving the active session', async () => {
    characters.push({ ...fixture, characterId: three, name: 'Aster' });
    sessions = [{ id: sessionId, characterId: one, worldInstanceId: demo }];
    open(`/worlds/${demo}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Play as Aster' }));
    expect(await screen.findByRole('region', { name: 'Switch characters' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('region', { name: 'Switch characters' })).not.toBeInTheDocument();
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
    open('/lobby');
    await screen.findByRole('heading', { name: 'Recent characters' });
    visit(`/worlds/${orra}`);
    await screen.findByRole('heading', { level: 1, name: 'Orraveth: Bellwold' });
    visit('/');
    await screen.findByRole('heading', { level: 1, name: /The road begins.*where the map ends/i });
    visit('/guest-world');
    await screen.findByRole('heading', { level: 1, name: /The road begins.*where the map ends/i });
    expect(calls('POST', '/api/world-session')).toHaveLength(0);
  });

  it('redirects the legacy world route to the last selected world without joining', async () => {
    localStorage.setItem('mudd-world-instance-id', orra);
    open('/world');

    expect(await screen.findByRole('heading', { level: 1, name: 'Choose a character to enter' })).toBeInTheDocument();
    expect(location.pathname).toBe(`/worlds/${orra}/play`);
    expect(screen.getByRole('link', { name: 'Visit Orraveth: Bellwold' })).toHaveAttribute('href', `/worlds/${orra}`);
    expect(calls('POST', '/api/world-session')).toHaveLength(0);
  });

  it('shows a useful unknown world or missing-session screen, not gameplay', async () => {
    open('/worlds/missing');
    await screen.findByRole('heading', { name: 'World not found' });
    visit('/worlds/missing/play');
    expect(await screen.findByRole('heading', { name: 'World not found' })).toBeInTheDocument();
    visit(`/worlds/${demo}/play`);
    await screen.findByRole('heading', { name: 'Choose a character to enter' });
    expect(calls('POST', '/api/world-session')).toHaveLength(0);
  });

  it('retries a play page when catalog loading fails', async () => {
    sessions = [{ id: sessionId, characterId: one, worldInstanceId: demo }];
    catalogFailure = true;
    open(`/worlds/${demo}/play`);
    expect(await screen.findByRole('alert')).toHaveTextContent('World catalog unavailable');

    catalogFailure = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText(`World play: ${demo}`)).toBeInTheDocument();
  });

  it('shows a recoverable error when leaving gameplay fails', async () => {
    sessions = [{ id: sessionId, characterId: one, worldInstanceId: demo }];
    leaveFailure = true;
    open(`/worlds/${demo}/play`);
    fireEvent.click(await screen.findByRole('button', { name: 'Leave world' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Leaving the world failed');
    expect(location.pathname).toBe(`/worlds/${demo}/play`);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ignores a duplicate leave action while the first request is pending', async () => {
    sessions = [{ id: sessionId, characterId: one, worldInstanceId: demo }];
    holdLeave = true;
    open(`/worlds/${demo}/play`);
    const leave = await screen.findByRole('button', { name: 'Leave world' });
    fireEvent.click(leave);
    await waitFor(() => expect(releaseLeave).toBeDefined());
    fireEvent.click(leave);
    expect(calls('DELETE', '/api/world-session')).toHaveLength(1);

    act(() => releaseLeave?.());
    expect(await screen.findByRole('heading', { level: 1, name: 'The Waystone Path' })).toBeInTheDocument();
  });
  it('preserves world/creation intent across authentication', async () => {
    mocks.signedIn = false; open(`/worlds/${orra}?create=1`);
    fireEvent.click(await screen.findByRole('link', { name: 'Create account' }));
    expect(sessionStorage.getItem('mudd-entry-intent')).toBe(`/worlds/${orra}?create=1`);
    visit('/sign-up');
    await screen.findByText(`Sign up return: /worlds/${orra}?create=1`);
  });
  it('closes the create-character form without creating or entering a character', async () => {
    open(`/worlds/${demo}?create=1`);
    expect(await screen.findByLabelText('Character name')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(await screen.findByRole('button', { name: 'Create new character' })).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/worlds/${demo}`);
    expect(calls('POST', '/api/commands')).toHaveLength(0);
    expect(calls('POST', '/api/world-session')).toHaveLength(0);
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

  it('cancels rename and archive prompts without issuing commands', async () => {
    open(`/worlds/${demo}`);
    await screen.findByRole('button', { name: 'Play as Rowan' });
    fireEvent.click(screen.getByText('Manage'));

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Character name'), { target: { value: 'R' } });
    expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Character name')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(screen.getByText(/Archive Rowan\\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/Archive Rowan\\?/)).not.toBeInTheDocument();
    expect(commands.some((body) => ['character.rename', 'character.archive'].includes(String(body.type))))
      .toBe(false);
  });

  it('loads a character detail route from the roster and shows only projected facts', async () => {
    open(`/worlds/${demo}/characters/${one}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Rowan' })).toBeInTheDocument();
    expect(screen.getByText('Mossgate Clearing')).toBeInTheDocument();
    expect(screen.getByText('8 / 12')).toBeInTheDocument();
    expect(screen.getByText('27 silver')).toBeInTheDocument();
    expect(screen.getByText('3 items')).toBeInTheDocument();
    expect(screen.getByText('Dried yarrow × 3')).toBeInTheDocument();
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByRole('link', { name: 'Worlds' })).toHaveAttribute('href', '/worlds');
    expect(within(trail).getByRole('link', { name: 'The Waystone Path' })).toHaveAttribute('href', `/worlds/${demo}`);
    expect(within(trail).getByRole('link', { name: 'Characters' })).toHaveAttribute('href', `/worlds/${demo}/characters`);
    expect(within(trail).getByText('Rowan')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Play as Rowan' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Play as Rowan' }));
    await screen.findByText(`World play: ${demo}`);
    expect(calls('POST', '/api/world-session')).toHaveLength(1);
  });

  it('retries character entry after a detail-page request fails', async () => {
    entryFailure = true;
    open(`/character/${one}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Play as Rowan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Entry temporarily unavailable');

    entryFailure = false;
    fireEvent.click(screen.getByRole('button', { name: 'Play as Rowan' }));

    expect(await screen.findByText(`World play: ${demo}`)).toBeInTheDocument();
  });

  it('uses the Characters breadcrumb to return to this world roster', async () => {
    open(`/worlds/${demo}/characters/${one}`);
    await screen.findByRole('heading', { name: 'Rowan' });
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    fireEvent.click(within(trail).getByRole('link', { name: 'Characters' }));
    await screen.findByRole('heading', { name: 'Your characters' });
    expect(window.location.pathname).toBe(`/worlds/${demo}/characters`);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Worlds');
  });

  it('can cancel a character switch from the detail page without leaving the active session', async () => {
    characters.push({ ...fixture, characterId: three, name: 'Aster' });
    sessions = [{ id: sessionId, characterId: one, worldInstanceId: demo }];
    open(`/worlds/${demo}/characters/${three}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Play as Aster' }));
    expect(await screen.findByRole('region', { name: 'Switch characters' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('region', { name: 'Switch characters' })).not.toBeInTheDocument();
    expect(calls('DELETE', '/api/world-session')).toHaveLength(0);
  });

  it('returns to the active character from a character detail switch prompt', async () => {
    characters.push({ ...fixture, characterId: three, name: 'Aster' });
    sessions = [{ id: sessionId, characterId: one, worldInstanceId: demo }];
    open(`/worlds/${demo}/characters/${three}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Play as Aster' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Return to active character' }));

    expect(await screen.findByText(`World play: ${demo}`)).toBeInTheDocument();
    expect(calls('DELETE', '/api/world-session')).toHaveLength(0);
    expect(sessions.find((item) => item.worldInstanceId === demo)?.characterId).toBe(one);
  });

  it('leaves the active session before switching from a character detail page', async () => {
    characters.push({ ...fixture, characterId: three, name: 'Aster' });
    sessions = [{ id: sessionId, characterId: one, worldInstanceId: demo }];
    open(`/worlds/${demo}/characters/${three}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Play as Aster' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Leave and continue as Aster' }));

    expect(await screen.findByText(`World play: ${demo}`)).toBeInTheDocument();
    expect(calls('DELETE', '/api/world-session')).toHaveLength(1);
    expect(sessions.find((item) => item.worldInstanceId === demo)?.characterId).toBe(three);
  });

  it('shows a composed loading state while the roster is pending', async () => {
    holdRoster = true;
    open(`/character/${one}`);
    expect(screen.getByRole('status')).toHaveTextContent('Loading character record');
    await waitFor(() => expect(releaseRoster).toBeDefined());
    releaseRoster?.();
    await screen.findByRole('heading', { name: 'Rowan' });
  });

  it('retries loading a character detail roster after a server error', async () => {
    rosterFailure = true;
    open(`/character/${one}`);
    expect(await screen.findByRole('heading', { name: 'Character record unavailable' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Roster unavailable');

    rosterFailure = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry characters' }));

    expect(await screen.findByRole('heading', { name: 'Rowan' })).toBeInTheDocument();
  });

  it('handles missing characters and anonymous no-roster state without creating guest sessions', async () => {
    open('/character/missing-character');
    expect(await screen.findByRole('heading', { name: 'Character not found' })).toBeInTheDocument();
    mocks.signedIn = false;
    visit(`/character/${one}`);
    expect(await screen.findByRole('heading', { name: 'Your roster is not available' })).toBeInTheDocument();
    expect(calls('POST', '/api/guest-session')).toHaveLength(0);
  });

  it('shows an explicit empty-roster state instead of a missing-character error', async () => {
    characters = [];
    open(`/character/${one}`);

    expect(await screen.findByRole('heading', { name: 'No characters in this roster' })).toBeVisible();
  });

  it('resolves the world label from the roster when a character has no saved world name', async () => {
    characters = [{ ...fixture, worldName: undefined }];
    open(`/character/${one}`);

    expect(await screen.findByRole('heading', { name: 'Rowan' })).toBeVisible();
    expect(screen.getByText('The Waystone Path')).toBeVisible();
  });

  it('keeps character details in the management menu alongside play actions', async () => {
    open(`/worlds/${demo}`);
    await screen.findByRole('button', { name: 'Play as Rowan' });
    expect(screen.getByRole('heading', { name: 'Rowan' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Rowan' })).not.toBeInTheDocument();
    expect(screen.queryByText('Last known')).not.toBeInTheDocument();
    expect(screen.queryByText(/Last played/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play as Rowan' })).toBeEnabled();
    fireEvent.click(screen.getByText('Manage'));
    expect(screen.getByText('Manage').closest('details')).toHaveAttribute('open');
    expect(screen.getByRole('link', { name: 'Details' })).toHaveAttribute('href', `/worlds/${demo}/characters/${one}`);
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });
});
