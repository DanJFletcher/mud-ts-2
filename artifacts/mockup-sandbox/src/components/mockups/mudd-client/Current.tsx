import "./_group.css";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { MuddHttpClient, type GameSnapshot } from './_shared/client';
import {
  ActivityLog,
  Button,
  NavigationControls,
  Panel,
  RoomDescription,
  Text,
  TextInput,
  type ActivityEntry,
} from './_shared/ui';
import { Moon, Sun, Wind } from 'lucide-react';

const client = new MuddHttpClient({ worldInstanceId: 'mudd-demo-instance' });

function makeEntry(kind: ActivityEntry['kind'], text: string): ActivityEntry {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, kind, text };
}

export function Current() {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<'create' | 'look' | 'move' | null>(null);
  const [pendingExitId, setPendingExitId] = useState<string>();
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [connectionError, setConnectionError] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const addEntry = useCallback((kind: ActivityEntry['kind'], text: string) => {
    setEntries((current) => [...current.slice(-19), makeEntry(kind, text)]);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem('mudd-theme');
    const initial = stored === 'dark' ? 'dark' : 'light';
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  const loadGame = useCallback(async (announce = false) => {
    setLoading(true);
    setConnectionError('');
    try {
      const game = await client.getGame();
      setSnapshot(game);
      if (announce) addEntry('system', 'The world answers. Your latest view is in hand.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The world could not be reached.';
      setConnectionError(message);
      addEntry('error', message);
    } finally {
      setLoading(false);
    }
  }, [addEntry]);

  useEffect(() => {
    void loadGame();
  }, [loadGame]);

  const refreshAfterMutation = useCallback(async (message: string) => {
    addEntry('system', message);
    const latest = await client.getGame();
    setSnapshot(latest);
    setConnectionError('');
  }, [addEntry]);

  const createCharacter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const requestedName = name.trim();
    if (!requestedName || pending) return;
    setPending('create');
    try {
      const response = await client.createCharacter(requestedName);
      const version = 'newAggregateVersion' in response.receipt ? response.receipt.newAggregateVersion : 'unknown';
      await refreshAfterMutation(`${requestedName} has joined the path. Server confirmed version ${version}.`);
      setName('');
      addEntry('narration', 'A new journey begins at the edge of the known path.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Character creation failed.';
      addEntry('error', message);
    } finally {
      setPending(null);
    }
  };

  const inspect = useCallback(async () => {
    if (!snapshot?.character || pending) return;
    setPending('look');
    try {
      const location = await client.look(snapshot.character.characterId);
      setSnapshot((current) => current ? { ...current, location } : current);
      addEntry('narration', `You take in ${location.title}. ${location.description}`);
    } catch (error) {
      addEntry('error', error instanceof Error ? error.message : 'You cannot get a clear look just now.');
    } finally {
      setPending(null);
    }
  }, [addEntry, pending, snapshot]);

  const move = useCallback(async (exitId: string) => {
    if (!snapshot?.character || !snapshot.location || pending) return;
    const exit = snapshot.location.exits.find((item) => item.id === exitId);
    if (!exit?.available) {
      addEntry('error', 'That way is not open from here.');
      return;
    }
    setPending('move');
    setPendingExitId(exit.id);
    try {
      const response = await client.move(
        snapshot.character.characterId,
        exit.id,
        snapshot.location.revision,
      );
      const version = 'newAggregateVersion' in response.receipt ? response.receipt.newAggregateVersion : 'unknown';
      await refreshAfterMutation(`You travel ${exit.direction || exit.label}. Server confirmed version ${version}.`);
    } catch (error) {
      addEntry('error', error instanceof Error ? error.message : 'The path will not yield.');
    } finally {
      setPending(null);
      setPendingExitId(undefined);
    }
  }, [addEntry, pending, refreshAfterMutation, snapshot]);

  const submitCommand = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = command.trim();
    if (!value || pending) return;
    setCommand('');
    const [verb, ...rest] = value.split(/\s+/);
    const target = rest.join(' ').trim();
    if (verb.toLowerCase() === 'look' && !target) {
      addEntry('system', '> look');
      await inspect();
      return;
    }
    if (verb.toLowerCase() === 'go' && target) {
      const exits = snapshot?.location?.exits ?? [];
      const match = exits.find((exit) => exit.available && (
        exit.label.toLowerCase() === target.toLowerCase() ||
        exit.direction?.toLowerCase() === target.toLowerCase()
      ));
      if (!match) {
        addEntry('system', `> ${value}`);
        addEntry('error', `No available exit matches “${target}”.`);
        return;
      }
      addEntry('system', `> ${value}`);
      await move(match.id);
      return;
    }
    addEntry('system', `> ${value}`);
    addEntry('error', 'Try “look” or “go” followed by an available direction or exit label.');
  };

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem('mudd-theme', next);
  };

  const exits = useMemo(() => snapshot?.location?.exits ?? [], [snapshot?.location?.exits]);
  const hasCharacter = Boolean(snapshot?.character);

  return (
    <main className="wayfarer-shell">
      <div className="landscape-wash" aria-hidden="true" />
      <div className="app-frame">
        <header className="masthead">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true"><Wind size={18} strokeWidth={1.5} /></span>
            <div>
              <Text variant="eyebrow">Mudd · a small living world</Text>
              <p className="brand-caption">A path, one place at a time</p>
            </div>
          </div>
          <Button
            type="button"
            variant="quiet"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          >
            {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
            <span>{theme === 'light' ? 'Evening' : 'Daylight'}</span>
          </Button>
        </header>

        <section className="welcome-band" aria-label="Journey introduction">
          <div className="welcome-copy">
            <Text variant="eyebrow">The world is waiting</Text>
            <Text as="h1" variant="display">The Waystone Path</Text>
            <Text className="welcome-subtitle">No rush. Just the quiet work of being somewhere.</Text>
          </div>
          <div className="horizon-art" aria-hidden="true">
            <span className="horizon-sun" />
            <span className="ridge ridge-back" />
            <span className="ridge ridge-front" />
            <span className="horizon-line" />
          </div>
        </section>

        <div className="world-grid">
          <section className="primary-column" aria-label="World">
            {loading && !snapshot ? (
              <Panel className="room-panel loading-panel">
                <div className="skeleton-line skeleton-short" />
                <div className="skeleton-line skeleton-title" />
                <div className="skeleton-line skeleton-body" />
                <div className="skeleton-line skeleton-body skeleton-narrow" />
                <Text variant="muted">Finding your place in the world…</Text>
              </Panel>
            ) : connectionError && !snapshot ? (
              <Panel className="room-panel connection-panel" eyebrow="Connection" title="The path is quiet">
                <Text variant="muted">{connectionError}</Text>
                <Button type="button" onClick={() => void loadGame(true)}>Try again</Button>
              </Panel>
            ) : snapshot?.location ? (
              <Panel className="room-panel" aria-busy={pending === 'move' || pending === 'look'}>
                <div className="place-marker" aria-hidden="true"><span /></div>
                <RoomDescription
                  title={snapshot.location.title}
                  description={snapshot.location.description}
                  exits={exits}
                />
                <div className="room-meta">
                  <span><span className="status-dot" /> Here, now</span>
                  <span>Place {snapshot.location.locationId}</span>
                </div>
                <div className="room-rule" />
                <div className="navigation-heading">
                  <Text variant="eyebrow">Paths from here</Text>
                  <span className="quiet-hint">Choose a way onward</span>
                </div>
                {exits.length ? (
                  <NavigationControls
                    exits={exits}
                    onMove={(exitId) => void move(exitId)}
                    disabled={pending !== null}
                    pendingExitId={pendingExitId}
                  />
                ) : (
                  <p className="no-exits">There is nowhere further to go from this place.</p>
                )}
              </Panel>
            ) : (
              <Panel className="room-panel arrival-panel" eyebrow="A place to begin" title="Step into the landscape">
                <p className="arrival-note">Choose the name you would like the world to know. You can take your time here.</p>
                <form className="creation-form" onSubmit={createCharacter}>
                  <TextInput
                    id="traveler-name"
                    label="Name"
                    placeholder="What shall we call you?"
                    autoComplete="nickname"
                    maxLength={48}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    hint="Your name will be remembered on this path."
                    disabled={pending === 'create'}
                  />
                  <Button type="submit" disabled={!name.trim() || pending === 'create'}>
                    {pending === 'create' ? 'Making a place…' : 'Begin walking'}
                  </Button>
                </form>
              </Panel>
            )}

            {hasCharacter && snapshot?.location && (
              <Panel className="command-panel" eyebrow="Your words" title="A small command">
                <p className="command-intro">Look around, or choose a way to go. The world only moves when you do.</p>
                <form className="command-form" onSubmit={submitCommand}>
                  <TextInput
                    id="world-command"
                    label="Command"
                    placeholder="look  ·  go north"
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                    disabled={pending !== null}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <Button type="submit" variant="secondary" disabled={!command.trim() || pending !== null}>
                    {pending === 'look' ? 'Looking…' : pending === 'move' ? 'On the way…' : 'Send'}
                  </Button>
                </form>
                <div className="command-shortcuts" aria-label="Quick commands">
                  <button type="button" onClick={() => setCommand('look')} disabled={pending !== null}>look</button>
                  <span aria-hidden="true">·</span>
                  <span>go north</span>
                </div>
              </Panel>
            )}
          </section>

          <aside className="side-column">
            <Panel className="traveler-panel" eyebrow="Your traveler" title={snapshot?.character?.name || 'Guest'}>
              {snapshot ? (
                <>
                  <div className="identity-row">
                    <span className="identity-mark" aria-hidden="true">{snapshot.player.displayName.trim().charAt(0).toUpperCase() || 'G'}</span>
                    <div className="identity-copy">
                      <Text className="identity-name">{snapshot.player.displayName}</Text>
                      <Text variant="muted">Guest identity</Text>
                    </div>
                  </div>
                  {snapshot.character ? (
                    <div className="traveler-details">
                      <div><span>Journey</span><strong>Underway</strong></div>
                      <div><span>World</span><strong>Mudd</strong></div>
                    </div>
                  ) : (
                    <p className="guest-note">Your guest identity is ready. A name will make this journey yours.</p>
                  )}
                </>
              ) : (
                <div className="identity-skeleton" aria-label="Loading guest identity"><span /><span /></div>
              )}
            </Panel>

            <Panel className="log-panel" eyebrow="What has passed" title="Field notes">
              <ActivityLog entries={entries} label="World activity" />
              <p className="log-footnote">A record of this visit</p>
            </Panel>

            {connectionError && snapshot && (
              <div className="inline-connection" role="status">
                <span className="status-dot status-dot--error" />
                <span>Could not refresh the world: {connectionError}</span>
                <Button variant="quiet" type="button" onClick={() => void loadGame(true)}>Retry</Button>
              </div>
            )}
          </aside>
        </div>

        <footer className="page-footer">
          <span>Pay attention. The small things are the world.</span>
          <span className="footer-coordinate">M / 01</span>
        </footer>
      </div>
    </main>
  );
}
