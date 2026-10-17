import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { MuddHttpClient, type GameSnapshot } from "@mudd/client-sdk";
import {
  ActivityLog,
  Button,
  NavigationControls,
  Panel,
  Text,
  TextInput,
  type ActivityEntry,
} from "@mudd/ui";
import { Compass, Moon, NotebookText, Sun, UserRound, Users } from "lucide-react";

const client = new MuddHttpClient({ worldInstanceId: "mudd-demo-instance" });
type Screen = "play" | "traveler" | "notes";
type WorldClientProps = { onLeaveWorld: () => Promise<void> };
type VisibleRoomObject = NonNullable<GameSnapshot["location"]>["objects"][number];

function findObjectMatches(target: string, objects: VisibleRoomObject[]) {
  const normalizedTarget = target.toLocaleLowerCase();
  const exactMatch = objects.find((object) =>
    object.id.toLocaleLowerCase() === normalizedTarget ||
    object.label.toLocaleLowerCase() === normalizedTarget
  );
  return exactMatch
    ? [exactMatch]
    : objects.filter((object) => object.label.toLocaleLowerCase().includes(normalizedTarget));
}

function currentScreen(): Screen {
  const route = window.location.hash.slice(2);
  return route === "traveler" || route === "notes" ? route : "play";
}

function makeEntry(kind: ActivityEntry["kind"], text: string): ActivityEntry {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, kind, text };
}

export function WorldClient({ onLeaveWorld }: WorldClientProps) {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"look" | "read" | "take" | "drop" | "move" | null>(null);
  const [pendingExitId, setPendingExitId] = useState<string>();
  const [command, setCommand] = useState("");
  const [quickCommandMode, setQuickCommandMode] = useState<"quick" | "walk">("quick");
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [connectionError, setConnectionError] = useState("");
  const [inspectedCarriedItem, setInspectedCarriedItem] = useState<{ id: string; label: string; description: string }>();
  const [inventoryInspectError, setInventoryInspectError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    window.localStorage.getItem("mudd-theme") === "dark" ? "dark" : "light"
  );
  const [screen, setScreen] = useState<Screen>(currentScreen);
  const contentRef = useRef<HTMLElement>(null);
  const terminalHistoryRef = useRef<HTMLDivElement>(null);
  const terminalFollowsLatestRef = useRef(true);
  const lastRoomLookIdRef = useRef<string | null>(null);

  const addEntry = useCallback((kind: ActivityEntry["kind"], text: string) => {
    terminalFollowsLatestRef.current = true;
    setEntries((current) => [...current, makeEntry(kind, text)]);
  }, []);

  const addDefaultLook = useCallback((location: GameSnapshot["location"]) => {
    if (!location || lastRoomLookIdRef.current === location.locationId) return;
    lastRoomLookIdRef.current = location.locationId;
    addEntry("system", "> look");
    addEntry("narration", location.description);
  }, [addEntry]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("mudd-theme", theme);
  }, [theme]);

  useEffect(() => {
    const history = terminalHistoryRef.current;
    if (screen === "play" && history && terminalFollowsLatestRef.current) {
      history.scrollTop = history.scrollHeight;
    }
  }, [entries, screen]);

  useEffect(() => {
    const navigate = () => {
      setScreen(currentScreen());
      window.scrollTo?.(0, 0);
      requestAnimationFrame(() => contentRef.current?.focus());
    };
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);

  const loadGame = useCallback(async () => {
    setLoading(true);
    setConnectionError("");
    try {
      const nextSnapshot = await client.getGame();
      setSnapshot(nextSnapshot);
      addDefaultLook(nextSnapshot.location);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The world could not be reached.";
      setConnectionError(message);
      addEntry("error", message);
    } finally {
      setLoading(false);
    }
  }, [addDefaultLook, addEntry]);

  useEffect(() => {
    void loadGame();
  }, [loadGame]);

  const refreshAfterMutation = useCallback(async (message: string) => {
    addEntry("system", message);
    const nextSnapshot = await client.getGame();
    setSnapshot(nextSnapshot);
    setConnectionError("");
    addDefaultLook(nextSnapshot.location);
  }, [addDefaultLook, addEntry]);

  const inspect = useCallback(async (target?: string) => {
    if (!snapshot?.character || pending) return;
    setPending("look");
    try {
      const location = await client.look(snapshot.character.characterId);
      setSnapshot((current) => current ? { ...current, location } : current);
      if (!target) {
        addEntry("narration", location.description);
        return;
      }
      const inventoryObjects = (snapshot.character.inventory ?? []).map((item) => ({
        ...item,
        readable: false,
        takeable: true,
      }));
      const matches = findObjectMatches(target, [...location.objects, ...inventoryObjects]);
      if (matches.length === 0) {
        addEntry("error", `You do not see anything called “${target}” here.`);
      } else if (matches.length > 1) {
        addEntry("error", `Which one do you mean: ${matches.map((object) => object.label).join(", ")}?`);
      } else {
        const object = await client.inspect(snapshot.character.characterId, matches[0]!.id);
        addEntry("narration", object.description);
      }
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "You cannot get a clear look just now.");
    } finally {
      setPending(null);
    }
  }, [addEntry, pending, snapshot]);

  const inspectCarriedItem = useCallback(async (item: NonNullable<GameSnapshot["character"]>["inventory"][number]) => {
    if (!snapshot?.character || pending) return;
    setPending("look");
    setInventoryInspectError("");
    try {
      const inspected = await client.inspect(snapshot.character.characterId, item.id);
      setInspectedCarriedItem(inspected);
    } catch (error) {
      setInventoryInspectError(error instanceof Error ? error.message : "You cannot inspect that item just now.");
    } finally {
      setPending(null);
    }
  }, [pending, snapshot]);

  const readObject = useCallback(async (objectId: string) => {
    if (!snapshot?.character || pending) return;
    setPending("read");
    try {
      const readable = await client.read(snapshot.character.characterId, objectId);
      addEntry("narration", readable.text);
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "You cannot read that just now.");
    } finally {
      setPending(null);
    }
  }, [addEntry, pending, snapshot]);

  const takeObject = useCallback(async (itemId: string, label: string) => {
    if (!snapshot?.character || !snapshot.location || pending) return;
    setPending("take");
    try {
      await client.take(snapshot.character.characterId, itemId, snapshot.location.revision);
      await refreshAfterMutation(`You pick up the ${label.toLocaleLowerCase()}.`);
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "You cannot take that item just now.");
    } finally {
      setPending(null);
    }
  }, [addEntry, pending, refreshAfterMutation, snapshot]);

  const dropObject = useCallback(async (itemId: string, label: string) => {
    if (!snapshot?.character || !snapshot.location || pending) return;
    setPending("drop");
    try {
      await client.drop(snapshot.character.characterId, itemId, snapshot.location.revision);
      await refreshAfterMutation(`You put down the ${label.toLocaleLowerCase()}.`);
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "You cannot drop that item just now.");
    } finally {
      setPending(null);
    }
  }, [addEntry, pending, refreshAfterMutation, snapshot]);

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
      addEntry("error", error instanceof Error ? error.message : "Unable to move.");
    } finally {
      setPending(null);
      setPendingExitId(undefined);
    }
  }, [addEntry, pending, refreshAfterMutation, snapshot]);

  const executeCommand = useCallback(async (rawCommand: string) => {
    const value = rawCommand.trim();
    if (!value || pending) return;
    const [verb, ...rest] = value.split(/\s+/);
    const target = rest.join(" ").trim();
    if (verb.toLowerCase() === "look") {
      addEntry("system", `> ${value}`);
      const lookTarget = target.replace(/^at\s+/i, "").replace(/^the\s+/i, "").trim();
      if (target && (!lookTarget || /^at$/i.test(target))) {
        addEntry("error", "Look at what? Try “look at marker”.");
        return;
      }
      await inspect(lookTarget || undefined);
      return;
    }
    if (verb.toLowerCase() === "read") {
      addEntry("system", `> ${value}`);
      if (!target) {
        addEntry("error", "Read what? Try “read marker”.");
        return;
      }
      const readableObjects = (snapshot?.location?.objects ?? []).filter((object) => object.readable);
      const matches = findObjectMatches(target, readableObjects);
      if (matches.length === 0) {
        addEntry("error", `There is nothing readable called “${target}” here.`);
        return;
      }
      if (matches.length > 1) {
        addEntry("error", `Which one do you mean: ${matches.map((object) => object.label).join(", ")}?`);
        return;
      }
      await readObject(matches[0]!.id);
      return;
    }
    if (verb.toLowerCase() === "take") {
      addEntry("system", `> ${value}`);
      if (!target) {
        addEntry("error", "Take what? Try “take stone”.");
        return;
      }
      const objects = snapshot?.location?.objects ?? [];
      const matches = findObjectMatches(target, objects);
      if (matches.length === 0) {
        addEntry("error", `There is nothing here you can take called “${target}”.`);
        return;
      }
      if (matches.length > 1) {
        addEntry("error", `Which one do you mean: ${matches.map((object) => object.label).join(", ")}?`);
        return;
      }
      const object = matches[0]!;
      if (!object.takeable) {
        addEntry("error", `You cannot take the ${object.label.toLocaleLowerCase()}.`);
        return;
      }
      await takeObject(object.id, object.label);
      return;
    }
    if (verb.toLowerCase() === "drop") {
      addEntry("system", `> ${value}`);
      if (!target) {
        addEntry("error", "Drop what? Try “drop stone”.");
        return;
      }
      const inventory = snapshot?.character?.inventory ?? [];
      const matches = findObjectMatches(target, inventory.map((item) => ({
        ...item, readable: false, takeable: true,
      })));
      if (matches.length === 0) {
        addEntry("error", `You are not carrying anything called “${target}”.`);
        return;
      }
      if (matches.length > 1) {
        addEntry("error", `Which one do you mean: ${matches.map((item) => item.label).join(", ")}?`);
        return;
      }
      await dropObject(matches[0]!.id, matches[0]!.label);
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
    addEntry("error", "Use “look”, “look at <object>”, “go <direction>”, “read <object>”, “take <item>”, or “drop <item>”.");
  }, [addEntry, dropObject, inspect, move, pending, readObject, snapshot, takeObject]);

  const submitCommand = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!command.trim() || pending) return;
    const value = command;
    setCommand("");
    void executeCommand(value);
  };

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
  };

  const handleLeaveWorld = async () => {
    setLeaving(true);
    try {
      await onLeaveWorld();
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "Could not leave the world.");
    } finally {
      setLeaving(false);
    }
  };

  const exits = useMemo(() => snapshot?.location?.exits ?? [], [snapshot?.location?.exits]);
  const quickDirections = useMemo(() => {
    const seen = new Set<string>();
    return exits.flatMap((exit) => {
      if (!exit.available) return [];
      const target = exit.direction?.trim() || exit.label.trim();
      const normalizedTarget = target.toLowerCase();
      if (!target || seen.has(normalizedTarget)) return [];
      seen.add(normalizedTarget);
      return [{ target, label: normalizedTarget }];
    });
  }, [exits]);

  return (
    <main className="focused-client" data-theme={theme}>
      <header className="focused-topbar">
        <div className="focused-brand"><span className="focused-brand-mark" aria-hidden="true" /> MUDD</div>
        <div className="focused-top-actions">
          <Button type="button" variant="quiet" className="focused-leave-world" onClick={() => void handleLeaveWorld()} disabled={leaving}>
            <Users size={16} /><span>Characters</span>
          </Button>
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

      <section className="focused-content" key={screen} ref={contentRef} tabIndex={-1} aria-label={screen === "notes" ? "Field notes screen" : `${screen === "play" ? "Play" : "Traveler"} screen`}>
        {connectionError && !snapshot && screen !== "play" && (
          <div className="focused-feedback focused-feedback--error" role="alert">
            <span aria-hidden="true">!</span>
            <p>{connectionError} <Button type="button" variant="quiet" onClick={() => void loadGame()}>Retry</Button></p>
          </div>
        )}
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
                <div className="focused-session-recovery-actions">
                  <Button type="button" onClick={() => void loadGame()}>Retry</Button>
                  <Button type="button" variant="quiet" onClick={() => void handleLeaveWorld()} disabled={leaving}>Characters</Button>
                </div>
              </Panel>
            ) : snapshot?.location ? (
              <>
                <Panel className="focused-room focused-terminal" aria-busy={pending !== null}>
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
                  <section className="focused-quick-commands" aria-label="Quick commands">
                    <span className="focused-quick-commands__label" aria-hidden="true">
                      {quickCommandMode === "walk" ? "Walk" : "Quick"}
                    </span>
                    <div
                      className="focused-quick-commands__actions"
                      role="group"
                      aria-label={quickCommandMode === "walk" ? "Walking directions" : "Quick commands"}
                    >
                      {quickCommandMode === "walk" ? (
                        <>
                          <button
                            type="button"
                            className="focused-quick-command focused-quick-command--back"
                            onClick={() => setQuickCommandMode("quick")}
                            aria-label="Return to quick commands"
                            disabled={pending !== null}
                          >
                            ‹
                          </button>
                          {quickDirections.length ? quickDirections.map((direction) => (
                            <button
                              key={direction.target}
                              type="button"
                              className="focused-quick-command"
                              onClick={() => void executeCommand(`go ${direction.target}`)}
                              aria-label={`Go ${direction.label}`}
                              disabled={pending !== null}
                            >
                              {direction.label}
                            </button>
                          )) : <span className="focused-quick-commands__empty">No open directions</span>}
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="focused-quick-command"
                            onClick={() => void executeCommand("look")}
                            aria-label="Quick look"
                            disabled={pending !== null}
                          >
                            look
                          </button>
                          <button
                            type="button"
                            className="focused-quick-command"
                            onClick={() => setQuickCommandMode("walk")}
                            aria-label="Show walking directions"
                            disabled={pending !== null}
                          >
                            walk <span aria-hidden="true">›</span>
                          </button>
                        </>
                      )}
                    </div>
                  </section>
                  <section className="focused-command" aria-label="Text command">
                    <div className="focused-command-label"><span>Command</span><span>look at · take · drop · read</span></div>
                    <form className="focused-command-form" onSubmit={submitCommand}>
                      <TextInput
                        id="focused-world-command"
                        label="Enter a command"
                        placeholder="Type a command"
                        value={command}
                        onChange={(event) => setCommand(event.target.value)}
                        disabled={pending !== null}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <Button type="submit" variant="secondary" disabled={!command.trim() || pending !== null}>
                        {pending === "look" ? "Looking" : pending === "read" ? "Reading" : pending === "take" ? "Taking" : pending === "drop" ? "Dropping" : pending === "move" ? "Moving" : "Send"}
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
              <Panel className="focused-room focused-connection" eyebrow="World session" title="Character unavailable">
                <Text variant="muted">This character can’t be loaded in the current world session.</Text>
                <div className="focused-session-recovery-actions">
                  <Button type="button" onClick={() => void loadGame()}>Retry</Button>
                  <Button type="button" variant="quiet" onClick={() => void handleLeaveWorld()} disabled={leaving}>Characters</Button>
                </div>
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
                    <p className="focused-identity-label">{snapshot.player.displayName} · Account</p>
                  </div>
                </div>
                <div className="focused-details">
                  <div className="focused-detail"><span>Journey</span><strong>{snapshot.character ? "Underway" : "Not started"}</strong></div>
                   <div className="focused-detail"><span>World</span><strong>The Waystone Path</strong></div>
                   <div className="focused-detail focused-detail--wide"><span>Current location</span><strong>{snapshot.location?.title || "—"}</strong></div>
                    <div className="focused-detail focused-detail--wide">
                      <span>Carried items</span>
                      {snapshot.character?.inventory.length ? (
                        <div className="focused-inventory">
                          {snapshot.character.inventory.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className="focused-inventory-item"
                              aria-label={`Inspect ${item.label}`}
                              disabled={pending !== null}
                              onClick={() => void inspectCarriedItem(item)}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      ) : <strong>None</strong>}
                      {inspectedCarriedItem && snapshot.character?.inventory.some((item) => item.id === inspectedCarriedItem.id) && (
                        <p className="focused-inventory-description" aria-live="polite">
                          <strong>{inspectedCarriedItem.label}</strong>
                          {inspectedCarriedItem.description}
                        </p>
                      )}
                      {inventoryInspectError && <p className="focused-inventory-error" role="status">{inventoryInspectError}</p>}
                    </div>
                </div>
                {!snapshot.character && <p className="focused-note">Begin from Play to enter the world.</p>}
              </Panel>
            ) : (
               <Panel className="focused-card"><Text variant="muted">{loading ? "Traveler details are loading." : "Traveler details are unavailable."}</Text></Panel>
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
        <a href="#/play" className="focused-tab" aria-current={screen === "play" ? "page" : undefined}><Compass aria-hidden="true" /><span>Play</span></a>
        <a href="#/traveler" className="focused-tab" aria-current={screen === "traveler" ? "page" : undefined}><UserRound aria-hidden="true" /><span>Traveler</span></a>
        <a href="#/notes" className="focused-tab" aria-current={screen === "notes" ? "page" : undefined}><NotebookText aria-hidden="true" /><span>Field notes</span></a>
      </nav>
    </main>
  );
}
