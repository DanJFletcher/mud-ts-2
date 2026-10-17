import "./_group.css";
import "./_focused.css";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { MuddHttpClient, type GameSnapshot } from "./_shared/client";
import {
  ActivityLog,
  Button,
  NavigationControls,
  Panel,
  Text,
  TextInput,
  type ActivityEntry,
} from "./_shared/ui";
import { Compass, Moon, NotebookText, Sun, UserRound } from "lucide-react";

const client = new MuddHttpClient({ worldInstanceId: "mudd-demo-instance" });
type Screen = "play" | "traveler" | "notes";

function makeEntry(kind: ActivityEntry["kind"], text: string): ActivityEntry {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, kind, text };
}

export function FocusedClient() {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"create" | "look" | "move" | null>(null);
  const [pendingExitId, setPendingExitId] = useState<string>();
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [entries, setEntries] = useState<ActivityEntry[]>([
    { id: "preview-look", kind: "system", text: "> look" },
    { id: "preview-look-result", kind: "narration", text: "A circle of pale stones breaks through the moss." },
    { id: "preview-north", kind: "system", text: "> go north" },
    { id: "preview-north-result", kind: "system", text: "You travel north." },
    { id: "preview-bridge-look", kind: "system", text: "> look" },
    { id: "preview-bridge-description", kind: "narration", text: "A low stone bridge crosses clear water." },
    { id: "preview-south", kind: "system", text: "> go south" },
    { id: "preview-south-result", kind: "system", text: "You travel south." },
    { id: "preview-east", kind: "system", text: "> go east" },
    { id: "preview-east-result", kind: "system", text: "You travel east." },
    { id: "preview-tower-north", kind: "system", text: "> go north" },
    { id: "preview-tower-north-result", kind: "system", text: "You travel north." },
    { id: "preview-bridge-south", kind: "system", text: "> go south" },
    { id: "preview-bridge-south-result", kind: "system", text: "You travel south." },
    { id: "preview-return-look", kind: "system", text: "> look" },
    { id: "preview-return-description", kind: "narration", text: "A circle of pale stones breaks through the moss." },
  ]);
  const terminalHistoryRef = useRef<HTMLDivElement>(null);
  const terminalFollowsLatestRef = useRef(true);
  const [connectionError, setConnectionError] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [screen, setScreen] = useState<Screen>(() => {
    const requested = new URLSearchParams(window.location.search).get("screen");
    return requested === "traveler" || requested === "notes" ? requested : "play";
  });

  const addEntry = useCallback((kind: ActivityEntry["kind"], text: string) => {
    terminalFollowsLatestRef.current = true;
    setEntries((current) => [...current, makeEntry(kind, text)]);
  }, []);

  useEffect(() => {
    const history = terminalHistoryRef.current;
    if (history && terminalFollowsLatestRef.current) history.scrollTop = history.scrollHeight;
  }, [entries]);

  useEffect(() => {
    const stored = window.localStorage.getItem("mudd-theme");
    const initial = stored === "dark" ? "dark" : "light";
    setTheme(initial);
  }, []);

  const loadGame = useCallback(async () => {
    setLoading(true);
    setConnectionError("");
    try {
      setSnapshot(await client.getGame());
    } catch (error) {
      const message = error instanceof Error ? error.message : "The world could not be reached.";
      setConnectionError(message);
      addEntry("error", message);
    } finally {
      setLoading(false);
    }
  }, [addEntry]);

  useEffect(() => {
    void loadGame();
  }, [loadGame]);

  const refreshAfterMutation = useCallback(async (message: string) => {
    addEntry("system", message);
    const nextSnapshot = await client.getGame();
    setSnapshot(nextSnapshot);
    setConnectionError("");
    if (nextSnapshot.location) {
      addEntry("system", "> look");
      addEntry("narration", nextSnapshot.location.description);
    }
  }, [addEntry]);

  const createCharacter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const requestedName = name.trim();
    if (!requestedName || pending) return;
    setPending("create");
    try {
      await client.createCharacter(requestedName);
      await refreshAfterMutation(`${requestedName} joined the path.`);
      setName("");
      addEntry("narration", "A new journey begins at the edge of the known path.");
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "Character creation failed.");
    } finally {
      setPending(null);
    }
  };

  const inspect = useCallback(async () => {
    if (!snapshot?.character || pending) return;
    setPending("look");
    try {
      const location = await client.look(snapshot.character.characterId);
      setSnapshot((current) => current ? { ...current, location } : current);
      addEntry("narration", location.description);
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "You cannot get a clear look just now.");
    } finally {
      setPending(null);
    }
  }, [addEntry, pending, snapshot]);

  const move = useCallback(async (exitId: string) => {
    if (!snapshot?.character || !snapshot.location || pending) return;
    const exit = snapshot.location.exits.find((item) => item.id === exitId);
    if (!exit?.available) {
      addEntry("error", "That way is not open from here.");
      return;
    }
    setPending("move");
    setPendingExitId(exit.id);
    try {
      await client.move(snapshot.character.characterId, exit.id, snapshot.location.revision);
      await refreshAfterMutation(`You travel ${exit.direction || exit.label}.`);
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "The path will not yield.");
    } finally {
      setPending(null);
      setPendingExitId(undefined);
    }
  }, [addEntry, pending, refreshAfterMutation, snapshot]);

  const submitCommand = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = command.trim();
    if (!value || pending) return;
    setCommand("");
    const [verb, ...rest] = value.split(/\s+/);
    const target = rest.join(" ").trim();
    if (verb.toLowerCase() === "look" && !target) {
      addEntry("system", `> ${value}`);
      await inspect();
      return;
    }
    if (verb.toLowerCase() === "go" && target) {
      const exits = snapshot?.location?.exits ?? [];
      const match = exits.find((exit) => exit.available && (
        exit.label.toLowerCase() === target.toLowerCase() ||
        exit.direction?.toLowerCase() === target.toLowerCase()
      ));
      addEntry("system", `> ${value}`);
      if (!match) {
        addEntry("error", `No available exit matches “${target}”.`);
        return;
      }
      await move(match.id);
      return;
    }
    addEntry("system", `> ${value}`);
    addEntry("error", "Use “look” or “go” followed by an available direction.");
  };

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    window.localStorage.setItem("mudd-theme", next);
  };

  const exits = useMemo(() => snapshot?.location?.exits ?? [], [snapshot?.location?.exits]);

  return (
    <main className="focused-client" data-theme={theme}>
      <header className="focused-topbar">
        <div className="focused-brand"><span className="focused-brand-mark" aria-hidden="true" /> MUDD</div>
        <div className="focused-top-actions">
          <Button
            type="button"
            variant="quiet"
            className="focused-theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
          >
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
            <span>{theme === "light" ? "Night" : "Day"}</span>
          </Button>
        </div>
      </header>

      <section className="focused-content" key={screen}>
        {screen === "play" && (
          <div className="focused-screen focused-screen--play" aria-label="Play">
            {loading && !snapshot ? (
              <Panel className="focused-room focused-loading" aria-label="Loading location">
                <div className="skeleton-line skeleton-short" />
                <div className="skeleton-line skeleton-title" />
                <div className="skeleton-line skeleton-body" />
                <div className="skeleton-line skeleton-body skeleton-narrow" />
              </Panel>
            ) : connectionError && !snapshot ? (
              <Panel className="focused-room focused-connection" eyebrow="Connection" title="World unavailable">
                <Text variant="muted">{connectionError}</Text>
                <Button type="button" onClick={() => void loadGame()}>Retry</Button>
              </Panel>
            ) : snapshot?.location ? (
              <>
                <Panel className="focused-room focused-terminal" aria-busy={pending === "move" || pending === "look"}>
                  <div className="focused-terminal-room">
                    <h1 className="focused-terminal-location">{snapshot.location.title}</h1>
                  </div>
                  <div
                    className="focused-terminal-history"
                    ref={terminalHistoryRef}
                    role="region"
                    aria-label="Terminal output"
                    tabIndex={0}
                    onScroll={(event) => {
                      const history = event.currentTarget;
                      terminalFollowsLatestRef.current = history.scrollHeight - history.scrollTop - history.clientHeight < 32;
                    }}
                  >
                    {entries.length > 0 && <ActivityLog entries={entries} label="Terminal transcript" />}
                  </div>
                  <section className="focused-command" aria-label="Text command">
                    <div className="focused-command-label"><span>Command</span><span>look · go north</span></div>
                    <form className="focused-command-form" onSubmit={submitCommand}>
                      <TextInput id="focused-world-command" label="Enter a command" placeholder="Type a command" value={command} onChange={(event) => setCommand(event.target.value)} disabled={pending !== null} autoComplete="off" spellCheck={false} />
                      <Button type="submit" variant="secondary" disabled={!command.trim() || pending !== null}>
                        {pending === "look" ? "Looking" : pending === "move" ? "Moving" : "Send"}
                      </Button>
                    </form>
                  </section>
                </Panel>
                <section className="focused-paths" aria-label="Available exits">
                  <div className="focused-kicker focused-paths-heading">Available paths</div>
                  {exits.length ? (
                    <NavigationControls
                      exits={exits}
                      onMove={(exitId) => void move(exitId)}
                      disabled={pending !== null}
                      pendingExitId={pendingExitId}
                    />
                  ) : (
                    <p className="focused-feedback focused-feedback--empty">No open paths from here.</p>
                  )}
                </section>
              </>
            ) : (
              <Panel className="focused-room focused-arrival" eyebrow="Traveler" title="Choose a name">
                <p className="focused-arrival-copy">A name to carry through the world.</p>
                <form className="focused-arrival-form" onSubmit={createCharacter}>
                  <TextInput id="focused-traveler-name" label="Name" placeholder="Name" maxLength={48} value={name} onChange={(event) => setName(event.target.value)} disabled={pending === "create"} />
                  <Button type="submit" disabled={!name.trim() || pending === "create"}>{pending === "create" ? "Joining…" : "Begin"}</Button>
                </form>
              </Panel>
            )}

            {connectionError && snapshot && (
              <div className="focused-feedback focused-feedback--error" role="status" aria-live="polite">
                <i aria-hidden="true" /><p>{connectionError} <button type="button" onClick={() => void loadGame()}>Retry</button></p>
              </div>
            )}
          </div>
        )}

        {screen === "traveler" && (
          <div className="focused-screen" aria-label="Traveler">
            <div className="focused-screen-heading">
              <div><div className="focused-kicker">Character</div><h1 className="focused-screen-title">Traveler</h1></div>
            </div>
            {snapshot ? (
              <Panel className="focused-card">
                <div className="focused-identity">
                  <span className="focused-avatar" aria-hidden="true">{(snapshot.character?.name || snapshot.player.displayName).trim().charAt(0).toUpperCase() || "G"}</span>
                  <div>
                    <h2 className="focused-identity-name">{snapshot.character?.name || "Guest"}</h2>
                    <p className="focused-identity-label">{snapshot.player.displayName} · Guest identity</p>
                  </div>
                </div>
                <div className="focused-details">
                  <div className="focused-detail"><span>Journey</span><strong>{snapshot.character ? "Underway" : "Not started"}</strong></div>
                   <div className="focused-detail"><span>World</span><strong>The Waystone Path</strong></div>
                   <div className="focused-detail focused-detail--wide"><span>Current location</span><strong>{snapshot.location?.title || "—"}</strong></div>
                </div>
                {!snapshot.character && <p className="focused-note">Begin from Play to enter the world.</p>}
              </Panel>
            ) : (
              <Panel className="focused-card"><Text variant="muted">Traveler details are loading.</Text></Panel>
            )}
          </div>
        )}

        {screen === "notes" && (
          <div className="focused-screen" aria-label="Field notes">
            <div className="focused-screen-heading">
              <div><div className="focused-kicker">Session history</div><h1 className="focused-screen-title">Field notes</h1></div>
              <span className="focused-coordinate">{entries.length} {entries.length === 1 ? "entry" : "entries"}</span>
            </div>
            <div className="focused-log">
               {entries.length ? (
                 <ActivityLog entries={[...entries].reverse()} label="Field notes" />
               ) : (
                 <p className="focused-feedback focused-feedback--empty">No activity this session. Actions and command results will appear here.</p>
               )}
            </div>
          </div>
        )}
      </section>

      <nav className="focused-bottom-nav" aria-label="Game screens">
        <button type="button" className="focused-tab" aria-current={screen === "play" ? "page" : undefined} onClick={() => setScreen("play")}><Compass aria-hidden="true" /><span>Play</span></button>
        <button type="button" className="focused-tab" aria-current={screen === "traveler" ? "page" : undefined} onClick={() => setScreen("traveler")}><UserRound aria-hidden="true" /><span>Traveler</span></button>
        <button type="button" className="focused-tab" aria-current={screen === "notes" ? "page" : undefined} onClick={() => setScreen("notes")}><NotebookText aria-hidden="true" /><span>Field notes</span></button>
      </nav>
    </main>
  );
}
