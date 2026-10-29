import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Button, Skeleton } from '@mudd/ui';
import { AccountShell } from './AccountShell.js';
import { LobbyBreadcrumbs } from './LobbyBreadcrumbs.js';
import { worldCharactersPath, worldPath } from './navigation.js';
import { enterCharacter, entryDisabled, useLobby, worldClient, type LobbyCharacter } from './useLobby.js';

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="character-detail__row"><dt>{label}</dt><dd>{children}</dd></div>;
}

function CharacterTrail({ worldId, worldName, current }: { worldId?: string; worldName?: string; current: string }) {
  return <LobbyBreadcrumbs items={worldId
    ? [
      { label: 'Worlds', href: '/worlds' },
      { label: worldName || 'World', href: worldPath(worldId) },
      { label: 'Characters', href: worldCharactersPath(worldId) },
      { label: current },
    ]
    : [{ label: 'Worlds', href: '/worlds' }, { label: current }]} />;
}

export function CharacterDetailPage({ characterId, worldId }: { characterId: string; worldId?: string }) {
  const state = useLobby();
  const [, navigate] = useLocation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [switchTarget, setSwitchTarget] = useState<LobbyCharacter | null>(null);
  const routeWorldName = worldId ? state.worlds.find((world) => world.worldInstanceId === worldId)?.name : undefined;
  const rosterCharacter = state.roster?.characters.find((item) => item.characterId === characterId);
  const character = rosterCharacter && (!worldId || rosterCharacter.worldInstanceId === worldId) ? rosterCharacter : undefined;
  const activeId = character && state.roster?.activeWorldSessions?.find(
    (session) => session.worldInstanceId === character.worldInstanceId,
  )?.characterId;
  const isActive = activeId === character?.characterId;

  async function run(action: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError('');
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not open this story. Try again.'); }
    finally { setPending(false); }
  }
  function enter() {
    if (!character) return;
    void run(() => enterCharacter(character.characterId, character.worldInstanceId, state.refreshRoster, setSwitchTarget, navigate));
  }

  if (state.loading) return <AccountShell><CharacterTrail worldId={worldId} worldName={routeWorldName} current="Character" />
    <div className="character-detail-state character-detail-state--loading" role="status" aria-busy="true">
    <div className="character-detail__skeleton" aria-hidden="true">
      <Skeleton variant="text" width="78%" height="1.2rem" className="character-detail__skeleton-title" />
      <Skeleton variant="text" width="86%" height=".8rem" className="character-detail__skeleton-line" />
      <Skeleton variant="text" width="54%" height=".8rem" className="character-detail__skeleton-line character-detail__skeleton-line--short" />
    </div>
    <p>Loading character record…</p>
  </div></AccountShell>;
  if (state.rosterError) return <AccountShell><CharacterTrail worldId={worldId} worldName={routeWorldName} current="Character record" />
    <section className="character-detail-state">
    <h1>Character record unavailable</h1><p role="alert">{state.rosterError}</p>
    <Button onClick={() => void state.reload()}>Retry characters</Button>
  </section></AccountShell>;
  if (!state.roster) return <AccountShell><CharacterTrail worldId={worldId} worldName={routeWorldName} current="Character record" />
    <section className="character-detail-state">
    <p className="lobby-eyebrow">MUDD · Character record</p><h1>Your roster is not available</h1>
    <p>Sign in or open the lobby to start an explicit guest session. No character or guest account was created.</p>
    <div className="lobby-buttons"><Link href="/sign-in">Sign in</Link></div>
  </section></AccountShell>;
  if (state.roster.characters.length === 0) return <AccountShell><CharacterTrail worldId={worldId} worldName={routeWorldName} current="Characters" />
    <section className="character-detail-state">
    <p className="lobby-eyebrow">MUDD · Character record</p><h1>No characters in this roster</h1>
    <p>This roster has no travelers yet. Choose a world from the lobby to create one when you are ready.</p>
  </section></AccountShell>;
  if (!character) return <AccountShell><CharacterTrail worldId={worldId} worldName={routeWorldName} current="Character not found" />
    <section className="character-detail-state">
    <p className="lobby-eyebrow">MUDD · Character record</p><h1>Character not found</h1>
    <p>This character is not in your current roster. It may have been removed or belong to another account.</p>
  </section></AccountShell>;

  const dead = character.combat?.status === 'defeat' || character.health?.current === 0;
  const stateLabel = character.archived ? 'Archived' : dead ? 'Defeated' : isActive ? 'Current session' : 'Ready to play';
  const boundWorld = character.worldName || state.worlds.find((world) => world.worldInstanceId === character.worldInstanceId)?.name;
  const inventory = character.inventory;
  const lastPlayed = character.lastPlayedAt;
  const characterWorldName = character.worldName || routeWorldName;
  const itemCounts = inventory.reduce<Map<string, number>>((counts, item) => {
    counts.set(item.label, (counts.get(item.label) ?? 0) + (item.quantity ?? 1));
    return counts;
  }, new Map());
  const inventoryUnits = inventory.reduce((total, item) => total + (item.quantity ?? 1), 0);

  return <AccountShell>
    <div className="character-detail">
      <CharacterTrail worldId={character.worldInstanceId} worldName={characterWorldName} current={character.name} />
      <header className="character-detail__header">
        <p className="lobby-eyebrow">{boundWorld || 'Traveler record'}</p>
        <h1>{character.name}</h1>
        <p className="character-detail__status">{stateLabel}</p>
      </header>
      {error && <div className="lobby-error" role="alert">{error}</div>}
      <section className="character-detail__panel" aria-label={`${character.name} details`}>
        <dl className="character-detail__facts">
          {character.locationTitle && <DetailRow label="Last known room">{character.locationTitle}</DetailRow>}
          {character.characterClass?.label && <DetailRow label="Class">{character.characterClass.label}</DetailRow>}
          {typeof character.advancement?.level === 'number' && <DetailRow label="Level">{character.advancement.level}</DetailRow>}
          {typeof character.advancement?.experience === 'number' && <DetailRow label="Experience">{character.advancement.experience}</DetailRow>}
          {character.health && <DetailRow label="Health">{character.health.current} / {character.health.maximum}</DetailRow>}
          {character.resources?.stamina && <DetailRow label="Stamina">{character.resources.stamina.current} / {character.resources.stamina.maximum}</DetailRow>}
          {character.resources?.mana && <DetailRow label="Mana">{character.resources.mana.current} / {character.resources.mana.maximum}</DetailRow>}
          {character.wallet && <DetailRow label="Wallet">{character.wallet.balance} {character.wallet.currencyId}</DetailRow>}
          <DetailRow label="Inventory">{inventoryUnits === 0 ? 'No carried items' : `${inventoryUnits} ${inventoryUnits === 1 ? 'item' : 'items'}`}
            {inventory.length > 0 && <ul className="character-detail__inventory">{Array.from(itemCounts, ([label, count]) =>
              <li key={label}>{label}{count > 1 ? ` × ${count}` : ''}</li>)}</ul>}
          </DetailRow>
          {lastPlayed && <DetailRow label="Last played"><time dateTime={lastPlayed}>{new Date(lastPlayed).toLocaleDateString()}</time></DetailRow>}
        </dl>
      </section>
      {switchTarget && <section className="lobby-switch" aria-label="Switch characters">
        <h2>This world already has an active character</h2>
        <p>Leave the current session in {switchTarget.worldName} before continuing as {switchTarget.name}.</p>
        <div className="lobby-buttons">
          <Button disabled={pending} onClick={() => {
            const active = state.roster?.characters.find((item) => item.characterId === activeId);
            if (active) void run(() => enterCharacter(active.characterId, active.worldInstanceId, state.refreshRoster, setSwitchTarget, navigate));
          }}>Return to active character</Button>
          <Button disabled={pending} onClick={() => void run(async () => {
            await worldClient(switchTarget.worldInstanceId).leaveWorld();
            await enterCharacter(switchTarget.characterId, switchTarget.worldInstanceId, state.refreshRoster, setSwitchTarget, navigate);
            setSwitchTarget(null);
          })}>Leave and continue as {switchTarget.name}</Button>
          <Button variant="quiet" onClick={() => setSwitchTarget(null)}>Cancel</Button>
        </div>
      </section>}
      <div className="character-detail__actions">
        <Button disabled={pending || entryDisabled(character)} onClick={enter}>
          {pending ? 'Opening story…' : isActive ? `Continue as ${character.name}` : `Play as ${character.name}`}
        </Button>
        {entryDisabled(character) && <p className="lobby-small">{character.archived ? 'Restore this character from the world roster before playing.' : 'This character cannot currently enter a session.'}</p>}
      </div>
    </div>
  </AccountShell>;
}
