import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  ClerkProvider,
  Show,
  SignIn,
  SignUp,
  useClerk,
  useUser,
} from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { Moon, Sun, UserRoundPlus, LogIn, Archive, Pencil, X, Check, RotateCcw } from 'lucide-react';
import { Button, ClassChoice, TextInput, type CharacterClassDefinition } from '@mudd/ui';
import { MuddHttpClient, type CharacterRosterSnapshot, type WorldSummary } from '@mudd/client-sdk';
import { WorldClient } from './App.js';
import './account.css';

const client = new MuddHttpClient({ worldInstanceId: 'mudd-demo-instance' });
type ClassCatalogSummary = { id: string; revision: number; classes: CharacterClassDefinition[] };
type CharacterClassView = { id: string; revision: number; label: string };
function getClassCatalog(world: WorldSummary | undefined): ClassCatalogSummary | undefined {
  return world?.classCatalog;
}
function getCharacterClass(character: unknown): CharacterClassView | undefined {
  return (character as { characterClass?: CharacterClassView } | undefined)?.characterClass;
}
const selectedWorldStorageKey = 'mudd-world-instance-id';
function selectWorld(worldInstanceId: string) {
  window.localStorage.setItem(selectedWorldStorageKey, worldInstanceId);
  client.setWorldInstanceId(worldInstanceId);
}
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL
  || (import.meta.env.PROD ? `${window.location.origin}${basePath}/api/__clerk` : undefined);

if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in the environment.');

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#496c55',
    colorForeground: '#28352e',
    colorMutedForeground: '#707b70',
    colorDanger: '#a34f43',
    colorBackground: '#fbfaf4',
    colorInput: '#fffef9',
    colorInputForeground: '#28352e',
    colorNeutral: '#d6d9c9',
    fontFamily: '"DM Sans", system-ui, sans-serif',
    borderRadius: '12px',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fbfaf4] rounded-2xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: { color: '#28352e', fontFamily: 'Literata, Georgia, serif' },
    headerSubtitle: { color: '#707b70' },
    socialButtonsBlockButtonText: { color: '#28352e' },
    formFieldLabel: { color: '#28352e' },
    footerActionLink: { color: '#365641' },
    footerActionText: { color: '#707b70' },
    dividerText: { color: '#707b70' },
    identityPreviewEditButton: { color: '#365641' },
    formFieldSuccessText: { color: '#365641' },
    alertText: { color: '#8a382e' },
    logoBox: 'flex justify-center',
    logoImage: 'h-12 w-12 rounded-xl',
    socialButtonsBlockButton: 'border border-[#d6d9c9] bg-[#fffef9] rounded-lg',
    formButtonPrimary: 'bg-[#496c55] hover:bg-[#365641] text-[#fbfaf4] rounded-lg',
    formFieldInput: 'border border-[#d6d9c9] bg-[#fffef9] text-[#28352e] rounded-lg',
    footerAction: 'text-[#707b70]',
    dividerLine: 'bg-[#d6d9c9]',
    alert: 'border border-[#e5c1b8] bg-[#fff5f2] rounded-lg',
    otpCodeFieldInput: 'border border-[#d6d9c9] bg-[#fffef9] text-[#28352e] rounded-lg',
    formFieldRow: 'gap-2',
    main: 'gap-4',
  },
};

function HomePage() {
  return (
    <main className="account-home">
      <div className="account-home__header">
        <div className="focused-brand"><span className="focused-brand-mark" aria-hidden="true" /> MUDD</div>
        <Show when="signed-in"><Redirect to="/characters" /></Show>
        <Show when="signed-out">
          <nav className="account-home__auth" aria-label="Account">
            <a className="account-link account-link--quiet" href={`${basePath}/sign-in`}><LogIn size={16} /> Sign in</a>
            <a className="account-link account-link--primary" href={`${basePath}/sign-up`}><UserRoundPlus size={16} /> Create account</a>
          </nav>
        </Show>
      </div>
      <section className="account-home__intro">
        <img src={`${basePath}/logo.svg`} alt="" width="72" height="72" />
        <p className="focused-kicker">THE WAYSTONE PATH</p>
        <h1>Your journey, saved.</h1>
        <p>Sign in to keep your characters and continue where you left off.</p>
        <Show when="signed-out">
          <div className="account-home__actions">
            <a className="account-link account-link--primary" href={`${basePath}/sign-up`}><UserRoundPlus size={17} /> Create account</a>
            <a className="account-link account-link--quiet" href={`${basePath}/sign-in`}>I have an account</a>
          </div>
          <GuestPlayButton />
        </Show>
      </section>
    </main>
  );
}

export function GuestPlayButton() {
  const [, setLocation] = useLocation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const beginGuestJourney = async () => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await client.createGuestSession();
      setLocation('/guest-world');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start a guest journey.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="guest-play">
      <Button type="button" variant="secondary" onClick={() => void beginGuestJourney()} disabled={pending}>
        {pending ? 'Starting…' : 'Play as guest'}
      </Button>
      <p>Your guest journey is saved in this browser. Create an account later to keep it across devices.</p>
      {error && <p className="account-message account-message--error" role="alert">{error}</p>}
    </div>
  );
}

function SignInPage() {
  return (
    <main className="account-auth">
      <a className="focused-brand account-auth__brand" href={basePath || '/'}><span className="focused-brand-mark" aria-hidden="true" /> MUDD</a>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </main>
  );
}

function SignUpPage() {
  return (
    <main className="account-auth">
      <a className="focused-brand account-auth__brand" href={basePath || '/'}><span className="focused-brand-mark" aria-hidden="true" /> MUDD</a>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </main>
  );
}

function ProtectedPage({ children }: { children: ReactNode }) {
  return (
    <>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}

function AccountHeader({
  displayName,
  theme,
  onToggleTheme,
  onSignOut,
}: {
  displayName: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onSignOut: () => void;
}) {
  return (
    <header className="focused-topbar account-topbar">
      <a className="focused-brand" href="/characters"><span className="focused-brand-mark" aria-hidden="true" /> MUDD</a>
      <div className="account-topbar__actions">
        <span className="account-topbar__name">{displayName}</span>
        <Button type="button" variant="quiet" className="focused-theme-toggle" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </Button>
        <Button type="button" variant="quiet" onClick={onSignOut}>Sign out</Button>
      </div>
    </header>
  );
}

export function CharacterRoster() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  const [roster, setRoster] = useState<CharacterRosterSnapshot | null>(null);
  const [worlds, setWorlds] = useState<WorldSummary[]>([]);
  const [selectedWorldId, setSelectedWorldId] = useState(
    () => window.localStorage.getItem(selectedWorldStorageKey) ?? 'mudd-demo-instance',
  );
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => window.localStorage.getItem('mudd-theme') === 'dark' ? 'dark' : 'light');
  const [name, setName] = useState('');
  const [classId, setClassId] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState('');

  const loadRoster = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [availableWorlds, playerRoster] = await Promise.all([client.getWorlds(), client.getCharacters()]);
      setWorlds(availableWorlds);
      setRoster(playerRoster);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your characters.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadRoster(); }, [loadRoster]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('mudd-theme', theme);
  }, [theme]);

  const refresh = async () => {
    await loadRoster();
  };

  const chooseWorld = (worldInstanceId: string) => {
    selectWorld(worldInstanceId);
    setSelectedWorldId(worldInstanceId);
    setClassId('');
    void loadRoster();
  };

  const createCharacter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError('');
    try {
      selectWorld(selectedWorldId);
      const catalog = getClassCatalog(selectedWorld);
      if (catalog && !classId) throw new Error('Choose a class before creating this character.');
      await client.createCharacter(trimmed, undefined, catalog ? classId : undefined);
      setName('');
      setClassId('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the character.');
    } finally {
      setPending(false);
    }
  };

  const joinWorld = async (characterId: string) => {
    const character = roster?.characters.find((candidate) => candidate.characterId === characterId);
    const worldInstanceId = character?.worldInstanceId ?? selectedWorldId;
    setPending(true);
    setError('');
    try {
      selectWorld(worldInstanceId);
      setSelectedWorldId(worldInstanceId);
      const session = await client.joinWorld(characterId, worldInstanceId);
      setRoster((current) => current ? {
        ...current,
        activeWorldSession: { id: session.sessionId, characterId: session.characterId },
      } : current);
      window.location.hash = '#/play';
      setLocation('/world');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not enter the world.');
      try { setRoster(await client.getCharacters()); } catch { /* Keep the original entry error visible. */ }
    } finally {
      setPending(false);
    }
  };

  const leaveWorld = async () => {
    setPending(true);
    setError('');
    try {
      await client.leaveWorld();
      await refresh();
      setLocation('/characters');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not leave the world.');
    } finally {
      setPending(false);
    }
  };

  const signOutUser = async () => {
    setPending(true);
    try {
      try { await client.leaveWorld(); } catch {
        setError('Could not close the current world session. You may resume or leave it after signing in again.');
      }
      await signOut({ redirectUrl: basePath || '/' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign out cleanly. Please try again.');
      setPending(false);
    }
  };

  const renameCharacter = async (event: FormEvent<HTMLFormElement>, characterId: string, revision: number) => {
    event.preventDefault();
    const nextName = renameValue.trim();
    if (!nextName || pending) return;
    setPending(true);
    setError('');
    try {
      const target = roster?.characters.find((character) => character.characterId === characterId);
      if (target) selectWorld(target.worldInstanceId);
      await client.renameCharacter(characterId, nextName, revision);
      setRenamingId(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not rename the character.');
    } finally {
      setPending(false);
    }
  };

  const archiveCharacter = async (characterId: string, revision: number) => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const target = roster?.characters.find((character) => character.characterId === characterId);
      if (target) selectWorld(target.worldInstanceId);
      await client.archiveCharacter(characterId, revision);
      setArchiveId(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not archive the character.');
    } finally {
      setPending(false);
    }
  };

  const restoreCharacter = async (characterId: string, revision: number) => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const target = roster?.characters.find((character) => character.characterId === characterId);
      if (target) selectWorld(target.worldInstanceId);
      await client.restoreCharacter(characterId, revision);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not restore the character.');
    } finally {
      setPending(false);
    }
  };

  const displayName = user?.fullName || user?.primaryEmailAddress?.emailAddress || roster?.player.displayName || 'Traveler';
  const selectedWorld = worlds.find((world) => world.worldInstanceId === selectedWorldId);
  const classCatalog = getClassCatalog(selectedWorld);
  const activeWorldSession = roster?.activeWorldSessions?.find((session) =>
    session.worldInstanceId === selectedWorldId,
  ) ?? (roster?.activeWorldSession ? {
    ...roster.activeWorldSession,
    worldInstanceId: selectedWorldId,
  } : undefined);
  const activeCharacter = roster?.characters.find((character) =>
    character.characterId === activeWorldSession?.characterId,
  );
  const activeCharacterIsDead = activeCharacter?.combat?.status === 'defeat' || activeCharacter?.health?.current === 0;
  const visibleCharacters = roster?.characters.filter((character) => character.archived === showArchived) ?? [];

  return (
    <main className="focused-client account-client" data-theme={theme}>
      <AccountHeader
        displayName={displayName}
        theme={theme}
        onToggleTheme={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}
        onSignOut={() => void signOutUser()}
      />
      <section className="account-content">
        <div className="account-content__heading">
          <div><div className="focused-kicker">ACCOUNT</div><h1 className="focused-screen-title">Your characters</h1></div>
          <div className="account-roster-switch" aria-label="Character lists">
            <Button type="button" variant={showArchived ? 'quiet' : 'secondary'} aria-pressed={!showArchived} onClick={() => setShowArchived(false)}>
              Characters ({roster?.characters.filter((character) => !character.archived).length ?? 0})
            </Button>
            <Button type="button" variant={showArchived ? 'secondary' : 'quiet'} aria-pressed={showArchived} onClick={() => setShowArchived(true)}>
              Archived ({roster?.characters.filter((character) => character.archived).length ?? 0})
            </Button>
          </div>
        </div>
        <label className="account-world-select">
          <span>Selected world</span>
          <select
            value={selectedWorldId}
            onChange={(event) => chooseWorld(event.target.value)}
            aria-label="Select a world"
          >
            {worlds.map((world) => <option key={world.worldInstanceId} value={world.worldInstanceId}>{world.name}</option>)}
          </select>
          {selectedWorld && <span className="account-world-select__summary">{selectedWorld.summary}</span>}
        </label>

        {error && <p className="account-message account-message--error" role="alert">{error}</p>}
        {loading ? (
          <section className="account-character-list" aria-label="Loading characters" aria-busy="true">
            <div className="account-character-skeleton" /><div className="account-character-skeleton" />
          </section>
        ) : (
          <>
            {activeCharacter && (
              <aside className="account-active-session" aria-label="Active world session">
                <div>
                  <span className="focused-kicker">{activeCharacterIsDead ? 'GAME OVER' : 'IN THE WORLD'}</span>
                  <p>{activeCharacterIsDead
                    ? <><strong>{activeCharacter.name}</strong> has died. Create a new character to begin again.</>
                    : <>Playing as <strong>{activeCharacter.name}</strong>. Only one character can enter this world at a time.</>}</p>
                </div>
                <div className="account-active-session__actions">
                  {!activeCharacterIsDead && <Button type="button" variant="secondary" onClick={() => void joinWorld(activeCharacter.characterId)} disabled={pending}>Return to world</Button>}
                  <Button type="button" variant="quiet" onClick={() => void leaveWorld()} disabled={pending}>
                    {activeCharacterIsDead ? 'Leave world to start over' : 'Leave world to switch'}
                  </Button>
                </div>
              </aside>
            )}

            <section className="account-character-list" aria-label="Character roster">
              {visibleCharacters.length ? visibleCharacters.map((character) => {
                const worldSession = roster?.activeWorldSessions?.find((session) =>
                  session.worldInstanceId === character.worldInstanceId,
                ) ?? (character.worldInstanceId === selectedWorldId ? activeWorldSession : undefined);
                const isActive = worldSession?.characterId === character.characterId;
                const anotherActive = Boolean(worldSession && !isActive);
                return (
                  <article className="account-character-card" key={character.characterId}>
                    <div className="account-character-card__identity">
                      <span className="focused-avatar" aria-hidden="true">{character.name.trim().charAt(0).toUpperCase()}</span>
                      <div>
                        {renamingId === character.characterId ? (
                          <form className="account-rename-form" onSubmit={(event) => void renameCharacter(event, character.characterId, character.revision)}>
                            <TextInput id={`rename-${character.characterId}`} label="Character name" value={renameValue} maxLength={48} onChange={(event) => setRenameValue(event.target.value)} autoComplete="off" />
                            <Button type="submit" variant="quiet" aria-label="Save name" disabled={!renameValue.trim() || pending}><Check size={17} /></Button>
                            <Button type="button" variant="quiet" aria-label="Cancel rename" onClick={() => setRenamingId(null)}><X size={17} /></Button>
                          </form>
                        ) : (
                          <>
                            <h2>{character.name}</h2>
                            <p>{getCharacterClass(character)?.label ? `${getCharacterClass(character)?.label} · ` : ''}{character.worldName ?? worlds.find((world) => world.worldInstanceId === character.worldInstanceId)?.name ?? 'Unknown world'} · {character.locationTitle} · {character.combat?.status === 'defeat' || character.health?.current === 0
                              ? 'Dead · Game over'
                              : character.archived ? 'Archived' : isActive ? 'In this world' : 'Ready'}</p>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="account-character-card__actions">
                      {showArchived ? (
                        <Button type="button" variant="quiet" aria-label={`Restore ${character.name}`} disabled={pending} onClick={() => void restoreCharacter(character.characterId, character.revision)}>
                          <RotateCcw size={16} /><span className="account-action-label">Restore</span>
                        </Button>
                      ) : (
                        <>
                          <Button type="button" onClick={() => isActive ? setLocation('/world') : void joinWorld(character.characterId)} disabled={pending || anotherActive || character.combat?.status === 'defeat' || character.health?.current === 0}>
                            {character.combat?.status === 'defeat' || character.health?.current === 0 ? 'Game over' : isActive ? 'Enter world' : anotherActive ? 'Leave world to switch' : 'Enter world'}
                          </Button>
                          {!isActive && (
                            <Button type="button" variant="quiet" aria-label={`Rename ${character.name}`} disabled={pending || anotherActive} onClick={() => { setRenamingId(character.characterId); setRenameValue(character.name); }}>
                              <Pencil size={16} /><span className="account-action-label">Rename</span>
                            </Button>
                          )}
                          {!isActive && (archiveId === character.characterId ? (
                            <div className="account-archive-confirm">
                              <span>Archive {character.name}?</span>
                              <Button type="button" variant="quiet" onClick={() => setArchiveId(null)}>Cancel</Button>
                              <Button type="button" variant="quiet" onClick={() => void archiveCharacter(character.characterId, character.revision)} disabled={pending}>Confirm</Button>
                            </div>
                          ) : (
                            <Button type="button" variant="quiet" aria-label={`Archive ${character.name}`} disabled={pending || anotherActive} onClick={() => setArchiveId(character.characterId)}>
                              <Archive size={16} /><span className="account-action-label">Archive</span>
                            </Button>
                          ))}
                        </>
                      )}
                    </div>
                  </article>
                );
              }) : (
                <p className="account-empty-state">{showArchived ? 'No archived characters.' : 'No characters yet. Create one to begin.'}</p>
              )}
            </section>

            {!showArchived && <section className="account-create">
              <div><div className="focused-kicker">NEW CHARACTER</div><h2>Create a character</h2></div>
              <form className="account-create__form" onSubmit={createCharacter}>
                <TextInput id="new-character-name" label="Character name" placeholder="Choose a name" maxLength={48} value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
                {classCatalog?.classes?.length ? (
                  <ClassChoice classes={classCatalog.classes} value={classId || undefined} onChange={setClassId} disabled={pending} />
                ) : null}
                <Button type="submit" disabled={!name.trim() || pending || Boolean(classCatalog?.classes.length && !classId)}>{pending ? 'Saving…' : 'Create character'}</Button>
              </form>
            </section>}
          </>
        )}
      </section>
    </main>
  );
}

function WorldPage() {
  const [, setLocation] = useLocation();
  const leaveWorld = async () => {
    await client.leaveWorld();
    window.location.hash = '';
    setLocation('/characters');
  };
  return (
    <ProtectedPage>
      <WorldClient
        worldInstanceId={window.localStorage.getItem(selectedWorldStorageKey) ?? 'mudd-demo-instance'}
        onLeaveWorld={leaveWorld}
      />
    </ProtectedPage>
  );
}

export function GuestWorldPage() {
  const [worlds, setWorlds] = useState<WorldSummary[]>([]);
  const [roster, setRoster] = useState<CharacterRosterSnapshot | null>(null);
  const [selectedWorldId, setSelectedWorldId] = useState(
    () => window.localStorage.getItem(selectedWorldStorageKey) ?? 'mudd-demo-instance',
  );
  const [name, setName] = useState('');
  const [classId, setClassId] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [inWorld, setInWorld] = useState(false);
  const [error, setError] = useState('');
  const [, setLocation] = useLocation();

  const refresh = useCallback(async () => {
    const [availableWorlds, playerRoster] = await Promise.all([client.getWorlds(), client.getCharacters()]);
    setWorlds(availableWorlds);
    setRoster(playerRoster);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        await client.createGuestSession();
        const [availableWorlds, playerRoster] = await Promise.all([client.getWorlds(), client.getCharacters()]);
        if (cancelled) return;
        setWorlds(availableWorlds);
        setRoster(playerRoster);
        if (!availableWorlds.some((world) => world.worldInstanceId === selectedWorldId)) {
          const firstWorld = availableWorlds[0];
          if (firstWorld) {
            setSelectedWorldId(firstWorld.worldInstanceId);
            selectWorld(firstWorld.worldInstanceId);
          }
        } else {
          selectWorld(selectedWorldId);
          const currentCharacter = playerRoster.characters.find((character) =>
            character.characterId === playerRoster.activeWorldSessions?.find(
              (session) => session.worldInstanceId === selectedWorldId,
            )?.characterId,
          );
          if (currentCharacter && currentCharacter.combat?.status !== 'defeat' && currentCharacter.health?.current !== 0) {
            setInWorld(true);
          }
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load available worlds.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void initialize();
    return () => { cancelled = true; };
  }, [selectedWorldId]);

  const selectedWorld = worlds.find((world) => world.worldInstanceId === selectedWorldId);
  const classCatalog = getClassCatalog(selectedWorld);
  const worldCharacters = roster?.characters.filter((character) =>
    character.worldInstanceId === selectedWorldId && !character.archived,
  ) ?? [];
  const worldSession = roster?.activeWorldSessions?.find((session) =>
    session.worldInstanceId === selectedWorldId,
  );
  const sessionCharacter = worldCharacters.find((character) =>
    character.characterId === worldSession?.characterId,
  );

  const chooseWorld = (worldInstanceId: string) => {
    setSelectedWorldId(worldInstanceId);
    selectWorld(worldInstanceId);
    setClassId('');
    setError('');
  };

  const join = async (characterId: string) => {
    if (pending) return;
    setPending(true);
    setError('');
    selectWorld(selectedWorldId);
    try {
      await client.joinWorld(characterId, selectedWorldId);
      setInWorld(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not enter this world.');
      await refresh().catch(() => undefined);
    } finally {
      setPending(false);
    }
  };

  const createCharacter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || pending) return;
    setPending(true);
    setError('');
    selectWorld(selectedWorldId);
    try {
      if (classCatalog && !classId) throw new Error('Choose a class before creating this character.');
      const created = await client.createCharacter(trimmedName, undefined, classCatalog ? classId : undefined);
      if (!created.streamId) throw new Error('The new character was created without an ID.');
      await client.joinWorld(created.streamId, selectedWorldId);
      setName('');
      setClassId('');
      setInWorld(true);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create this character.');
    } finally {
      setPending(false);
    }
  };

  const leave = async () => {
    setPending(true);
    try {
      await client.leaveWorld();
      setInWorld(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not leave this world.');
    } finally {
      setPending(false);
    }
  };

  if (inWorld) {
    return (
      <WorldClient
        worldInstanceId={selectedWorldId}
        onLeaveWorld={leave}
      />
    );
  }

  return (
    <main className="focused-client account-client" data-theme="dark">
      <header className="focused-topbar account-topbar">
        <a className="focused-brand" href="/"><span className="focused-brand-mark" aria-hidden="true" /> MUDD</a>
        <Button type="button" variant="quiet" onClick={() => setLocation('/')}>Back</Button>
      </header>
      <section className="account-content account-world-picker">
        <div className="account-content__heading">
          <div><div className="focused-kicker">GUEST JOURNEY</div><h1 className="focused-screen-title">Choose a world</h1></div>
        </div>
        {error && <p className="account-message account-message--error" role="alert">{error}</p>}
        {loading ? <p>Loading worlds…</p> : (
          <>
            <div className="account-world-list" aria-label="Available worlds">
              {worlds.map((world) => (
                <button
                  className="account-world-option"
                  type="button"
                  key={world.worldInstanceId}
                  aria-pressed={selectedWorldId === world.worldInstanceId}
                  onClick={() => chooseWorld(world.worldInstanceId)}
                >
                  <span className="account-world-option__title">{world.name}</span>
                  <span className="account-world-option__summary">{world.summary}</span>
                </button>
              ))}
            </div>
            {selectedWorld && (
              <section className="account-create">
                <div><div className="focused-kicker">{selectedWorld.name}</div><h2>Your characters</h2></div>
                {worldSession && sessionCharacter && (
                  <div className="account-active-session">
                    <p><strong>{sessionCharacter.name}</strong> is already in this world.</p>
                    <div className="account-active-session__actions">
                      <Button type="button" variant="secondary" onClick={() => void join(sessionCharacter.characterId)} disabled={pending}>Return to world</Button>
                      <Button type="button" variant="quiet" onClick={() => void leave()} disabled={pending}>Leave world</Button>
                    </div>
                  </div>
                )}
                {worldCharacters.filter((character) => character.characterId !== worldSession?.characterId).map((character) => (
                  <article className="account-character-card" key={character.characterId}>
                    <div><h2>{character.name}</h2><p>{getCharacterClass(character)?.label ? `${getCharacterClass(character)?.label} · ` : ''}{character.locationTitle}</p></div>
                    <Button
                      type="button"
                      onClick={() => void join(character.characterId)}
                      disabled={pending || Boolean(worldSession) || character.combat?.status === 'defeat' || character.health?.current === 0}
                    >
                      {worldSession ? 'Leave current character to switch' : 'Enter world'}
                    </Button>
                  </article>
                ))}
                <form className="account-create__form" onSubmit={(event) => void createCharacter(event)}>
                  <TextInput id="guest-new-character-name" label="New character name" placeholder="Choose a name" maxLength={48} value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
                  {classCatalog?.classes?.length ? (
                    <ClassChoice classes={classCatalog.classes} value={classId || undefined} onChange={setClassId} disabled={pending || Boolean(worldSession)} />
                  ) : null}
                  <Button type="submit" disabled={!name.trim() || pending || Boolean(worldSession) || Boolean(classCatalog?.classes.length && !classId)}>{pending ? 'Saving…' : 'Create and enter'}</Button>
                </form>
                {worldSession && <p className="account-world-note">Leave this world before entering with a different character. Characters in other worlds are unaffected.</p>}
              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function ClerkAppRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to access your characters' } },
        signUp: { start: { title: 'Create your account', subtitle: 'Your characters will be saved here' } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route path="/characters" component={() => <ProtectedPage><CharacterRoster /></ProtectedPage>} />
        <Route path="/world" component={WorldPage} />
        <Route path="/guest-world" component={GuestWorldPage} />
        <Route component={HomePage} />
      </Switch>
    </ClerkProvider>
  );
}

export default function AccountApp() {
  return (
    <WouterRouter base={basePath}>
      <ClerkAppRoutes />
    </WouterRouter>
  );
}
