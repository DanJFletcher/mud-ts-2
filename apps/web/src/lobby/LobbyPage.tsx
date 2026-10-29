import { useRef, useState, type FormEvent } from 'react';
import { useLocation, useSearch } from 'wouter';
import { Button, CharacterEntryCardSkeleton, ClassChoice, Skeleton, TextInput, WorldCard, WorldCardSkeleton, WorldHero } from '@mudd/ui';
import { AccountShell } from './AccountShell.js';
import { CharacterCard } from './CharacterCard.js';
import { appHref, rememberEntryIntent, worldPath } from './navigation.js';
import { recentCharacters, sortCharactersByActivity, useLobby, worldClient, enterCharacter, type LobbyCharacter } from './useLobby.js';

export function LobbyPage({ worldId, showAllCharacters = false }: { worldId?: string; showAllCharacters?: boolean }) {
  const state = useLobby({ skipCatalog: showAllCharacters });
  const [, navigate] = useLocation();
  const search = useSearch();
  const [showArchived, setShowArchived] = useState(false);
  const [name, setName] = useState('');
  const [classId, setClassId] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const commandId = useRef(crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState('');
  const [switchTarget, setSwitchTarget] = useState<LobbyCharacter | null>(null);
  const world = state.worlds.find((item) => item.worldInstanceId === worldId);
  const creating = new URLSearchParams(search).get('create') === '1';
  const sessions = state.roster?.activeWorldSessions ?? [];
  const activeId = (id: string) => sessions.find((session) => session.worldInstanceId === id)?.characterId;

  async function run(action: () => Promise<void>) {
    if (locked.current) return false;
    locked.current = true; setPending(true); setError('');
    try { await action(); return true; }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Something went wrong. Try again.'); return false; }
    finally { locked.current = false; setPending(false); }
  }
  async function enter(characterId: string, characterWorld: string) {
    await enterCharacter(characterId, characterWorld, state.refreshRoster, setSwitchTarget, navigate);
  }
  function play(character: LobbyCharacter) {
    void run(() => enter(character.characterId, character.worldInstanceId));
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (!world) return;
    await run(async () => {
      if (createdId) { await enter(createdId, world.worldInstanceId); return; }
      const result = await worldClient(world.worldInstanceId).createCharacter(name.trim(), commandId.current, classId || undefined);
      if (!result.streamId) throw new Error('Creation could not be confirmed. Refresh your characters before trying again.');
      // Retain success even when entering fails; retries must never create a duplicate.
      setCreatedId(result.streamId);
      await state.refreshRoster();
      await enter(result.streamId, world.worldInstanceId);
    });
  }
  function manage(action: 'rename' | 'archive' | 'restore', character: LobbyCharacter, newName?: string) {
    return run(async () => {
      const client = worldClient(character.worldInstanceId);
      if (action === 'rename') await client.renameCharacter(character.characterId, newName!, character.revision);
      else if (action === 'archive') await client.archiveCharacter(character.characterId, character.revision);
      else await client.restoreCharacter(character.characterId, character.revision);
      await state.refreshRoster();
    });
  }
  function authLink() { rememberEntryIntent(worldId ? `${worldPath(worldId)}?create=1` : '/'); }
  const characters = worldId
    ? (state.roster?.characters ?? []).filter((character) => character.worldInstanceId === worldId && Boolean(character.archived) === showArchived)
    : showAllCharacters
      ? sortCharactersByActivity(state.roster?.characters ?? [])
      : recentCharacters(state.roster?.characters ?? []).slice(0, 4);
  const characterListClassName = `lobby-character-list${worldId ? '' : showAllCharacters ? ' lobby-character-list--all' : ' lobby-character-list--recent'}`;
  const characterList = <div className={characterListClassName}>{characters.map((character) =>
    <CharacterCard key={character.characterId} character={character} active={activeId(character.worldInstanceId) === character.characterId}
      pending={pending} compact showWorldName={!worldId} onPlay={() => play(character)} onManage={manage} />,
  )}</div>;
  const characterLoading = <div className={characterListClassName} role="status" aria-label="Loading characters">
    <span className="mudd-visually-hidden">Loading characters…</span>
    {Array.from({ length: showAllCharacters ? 4 : 2 }, (_, index) =>
      <CharacterEntryCardSkeleton key={index} compact showWorldName={!worldId} />,
    )}
  </div>;
  const errors = <>
    {error && <div className="lobby-error" role="alert">{error}</div>}
    {state.rosterError && <div className="lobby-error" role="alert"><p>{state.rosterError}</p><Button onClick={() => void state.reload()}>Retry characters</Button></div>}
  </>;
  const switchPrompt = switchTarget && <section className="lobby-switch" aria-label="Switch characters">
    <h2>This world already has an active character</h2>
    <p>Leave your current session in {switchTarget.worldName} to play as {switchTarget.name}. Sessions in other worlds will stay open.</p>
    <div className="lobby-buttons">
      <Button disabled={pending} onClick={() => {
        const current = state.roster?.characters.find((character) => character.characterId === activeId(switchTarget.worldInstanceId));
        if (current) play(current);
      }}>Return to active character</Button>
      <Button disabled={pending} onClick={() => void run(async () => {
        const client = worldClient(switchTarget.worldInstanceId);
        await client.leaveWorld();
        await enter(switchTarget.characterId, switchTarget.worldInstanceId);
        setSwitchTarget(null);
      })}>Leave and play as {switchTarget.name}</Button>
      <Button disabled={pending} variant="quiet" onClick={() => setSwitchTarget(null)}>Cancel</Button>
    </div>
  </section>;
  const createSection = world && <section className="lobby-create" aria-labelledby="create-heading">
    <h2 id="create-heading">A new story in {world.name}</h2>
    <p>Each character belongs to one world. Your other travelers and their progress stay where they are.</p>
    {!creating ? <Button disabled={pending || state.rosterLoading || Boolean(state.rosterError)} onClick={() => navigate(`${worldPath(world.worldInstanceId)}?create=1`)}>Create new character</Button>
      : state.rosterLoading ? <p role="status">Checking your characters…</p>
      : !state.roster ? state.anonymous ? <div className="lobby-guest-choice">
        <p>Play as a guest, or sign in to keep your characters with an account. Guest characters are saved in this browser.</p>
        <div className="lobby-buttons">
          <Button disabled={pending} onClick={() => void run(async () => {
            await worldClient().createGuestSession(); await state.refreshRoster();
          })}>Play as guest</Button>
          <a href={appHref('/sign-in')} onClick={authLink}>Sign in</a>
          <a href={appHref('/sign-up')} onClick={authLink}>Create account</a>
        </div>
      </div> : <p>Load your characters before creating a new one.</p>
      : <form className="lobby-form" onSubmit={(event) => void create(event)}>
        {!state.isSignedIn && <p className="lobby-small">Guest traveler · saved in this browser. <a href={appHref('/sign-up')} onClick={authLink}>Create an account</a> to keep your journeys.</p>}
        {createdId ? <p role="status">Your character was created. You can retry entry below or use their character card. No new character will be created.</p> : <>
          <TextInput label="Character name" id="new-character-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus required minLength={2} maxLength={32} disabled={pending} autoComplete="off" />
          {world.classCatalog && <ClassChoice classes={world.classCatalog.classes} value={classId} onChange={setClassId} disabled={pending} name={`class-${world.worldInstanceId}`} />}
        </>}
        <div className="lobby-buttons"><Button type="submit" disabled={pending || (!createdId && (name.trim().length < 2 || Boolean(world.classCatalog && !classId)))}>
          {pending ? 'Opening your story…' : createdId ? 'Retry entering world' : 'Create & play'}
        </Button><Button type="button" variant="quiet" disabled={pending} onClick={() => {
          navigate(worldPath(world.worldInstanceId), { replace: true });
        }}>Close</Button></div>
      </form>}
  </section>;

  if (state.catalogLoading && worldId) return <AccountShell>
    <a className="lobby-back" href={appHref('/')}>Back to worlds</a>
    <div className="mudd-world-hero" role="status" aria-label="Loading world details" aria-busy="true">
      <div className="mudd-world-hero__content lobby-world-hero-skeleton">
        <Skeleton variant="text" width="8rem" height=".6rem" />
        <Skeleton variant="block" width="72%" height="3rem" />
        <Skeleton variant="text" width="84%" height="1rem" />
        <Skeleton variant="text" width="68%" height="1rem" />
      </div>
    </div>
    {errors}
    <section className="lobby-world-characters" aria-labelledby="world-characters-heading">
      <div className="lobby-section-heading"><h2 id="world-characters-heading">Your characters</h2></div>
      {state.rosterLoading ? characterLoading : characterList}
    </section>
  </AccountShell>;
  if (state.catalogError) return <AccountShell><h1>Worlds unavailable</h1><p role="alert">{state.catalogError}</p><Button onClick={() => void state.reload()}>Retry worlds</Button></AccountShell>;
  if (worldId && !world) return <AccountShell><h1>World not found</h1><p>This world is not available in the current catalog.</p><a href={appHref('/')}>Back to worlds</a></AccountShell>;

  if (showAllCharacters) return <AccountShell>
    <a className="lobby-back" href={appHref('/')}>Back to worlds</a>
    <div className="lobby-intro lobby-all-characters__intro">
      <p className="lobby-eyebrow">MUDD · Your roster</p>
      <h1>All characters</h1>
      <p>Browse every character across your worlds.</p>
    </div>
    {errors}{switchPrompt}
    {state.roster && !state.isSignedIn && <p className="lobby-small">Guest characters · saved in this browser</p>}
    <section className="lobby-all-characters" aria-labelledby="all-characters-heading">
      <h2 id="all-characters-heading">Characters</h2>
      {state.rosterLoading ? characterLoading : characterList}
      {!state.rosterLoading && !characters.length && !state.rosterError && <div className="lobby-empty">
        <h3>{state.roster ? 'No characters yet' : 'Characters are not available'}</h3>
        <p>{state.roster ? 'Explore a world to create your first character.' : 'Sign in or start a guest session from a world to see your characters here.'}</p>
        <div className="lobby-buttons">
          <a href={appHref('/')}>Browse worlds</a>
          {state.anonymous && <a href={appHref('/sign-in')} onClick={() => rememberEntryIntent('/')}>Sign in</a>}
        </div>
      </div>}
    </section>
  </AccountShell>;

  return <AccountShell>
    {world ? <>
      <a className="lobby-back" href={appHref('/')}>Back to worlds</a>
      <WorldHero name={world.name} summary={world.summary} introduction={world.introduction} imageSrc={world.coverImage ? appHref(world.coverImage) : undefined} />
      {errors}{switchPrompt}
      <section className="lobby-world-characters" aria-labelledby="world-characters-heading">
        <div className="lobby-section-heading"><h2 id="world-characters-heading">Your characters</h2>
          {state.roster && <Button variant="quiet" onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Show current characters' : 'Show archived'}</Button>}
        </div>
         {state.rosterLoading ? characterLoading : characterList}
         {!state.rosterLoading && !characters.length && !state.rosterError && <p className="lobby-empty">{showArchived ? 'No archived characters in this world.' : 'Your first story in this world starts here. Create a character below.'}</p>}
      </section>
      {createSection}
    </> : <>
      <div className="lobby-intro"><p className="lobby-eyebrow">MUDD · Shared worlds, individual stories</p><h1>Where will you go next?</h1><p>Return to a familiar journey or step into a different world.</p></div>
      {errors}{switchPrompt}
      <div className="lobby-grid">
        <section className="lobby-worlds" aria-labelledby="worlds-heading"><h2 id="worlds-heading">Explore worlds</h2>
          {state.catalogLoading
            ? <div className="lobby-world-list" role="status" aria-label="Loading worlds">
              <span className="mudd-visually-hidden">Loading worlds…</span>
              <WorldCardSkeleton />
              <WorldCardSkeleton />
            </div>
            : <div className="lobby-world-list">{state.worlds.map((item) => <WorldCard key={item.worldInstanceId} name={item.name} summary={item.summary}
              href={appHref(worldPath(item.worldInstanceId))} imageSrc={item.coverImage ? appHref(item.coverImage) : undefined} />)}</div>}
          {!state.catalogLoading && !state.worlds.length && <p>No worlds are available yet.</p>}
        </section>
        <section className="lobby-recent" aria-labelledby="recent-heading">
          <div className="lobby-section-heading">
            <h2 id="recent-heading">Recent characters</h2>
            <a className="lobby-all-characters-link" href={appHref('/characters')}>All characters</a>
          </div>
          {state.roster && !state.isSignedIn && <p className="lobby-small">Guest characters · saved in this browser</p>}
           {state.rosterLoading ? characterLoading : characterList}
           {!state.rosterLoading && !characters.length && !state.rosterError && <div className="lobby-empty"><h3>Your next traveler awaits</h3>
            <p>Choose a world to create a character. You can play as a guest or sign in.</p>
            {state.anonymous && <a href={appHref('/sign-in')} onClick={() => rememberEntryIntent('/')}>Sign in for your saved characters</a>}
          </div>}
        </section>
      </div>
    </>}
  </AccountShell>;
}
