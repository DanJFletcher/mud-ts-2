import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { MuddHttpClient, type GameSnapshot } from "@mudd/client-sdk";
import {
  ActivityLog,
  Button,
  Panel,
  Text,
  TextInput,
  type ActivityEntry,
} from "@mudd/ui";
import { Compass, Moon, NotebookText, Sun, UserRound, Users } from "lucide-react";
import { RoomChatPanel } from "./RoomChatPanel.js";
import { TerminalPanel } from "./TerminalPanel.js";
import { WorldMapPanel } from "./WorldMapPanel.js";

const client = new MuddHttpClient({ worldInstanceId: "mudd-demo-instance" });
type DialogueProjection = Awaited<ReturnType<MuddHttpClient["talk"]>>;
type Screen = "play" | "traveler" | "notes";
type WorldClientProps = { onLeaveWorld: () => Promise<void> };
type VisibleRoomObject = NonNullable<GameSnapshot["location"]>["objects"][number];
type VisibleNpc = NonNullable<NonNullable<GameSnapshot["location"]>["npcs"]>[number];

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

function findNpcMatches(target: string, npcs: readonly VisibleNpc[]) {
  const normalizedTarget = target.toLocaleLowerCase();
  const exactMatch = npcs.find((npc) =>
    npc.id.toLocaleLowerCase() === normalizedTarget ||
    npc.name.toLocaleLowerCase() === normalizedTarget
  );
  return exactMatch
    ? [exactMatch]
    : npcs.filter((npc) => npc.name.toLocaleLowerCase().includes(normalizedTarget));
}

const COMMAND_HELP: Record<string, readonly string[]> = {
  help: [
    "Usage: help [command]",
    "Show the command list or instructions for one command.",
  ],
  talk: [
    "Usage: talk <npc> [about <topic>]",
    "Speak privately with someone here. Choose a reply or ask about a topic.",
  ],
  look: [
    "Usage: look | look [at] <object>",
    "Look describes the current room. Add an object to inspect it here or in your inventory.",
  ],
  go: [
    "Usage: go <direction>",
    "Travel through an available exit. Use the Go quick action to choose from current exits.",
  ],
  read: [
    "Usage: read <object>",
    "Read written text on an object in the current room.",
  ],
  take: [
    "Usage: take <item> | take all",
    "Pick up an item in the current room, or take all available items there.",
  ],
  drop: [
    "Usage: drop <item>",
    "Put down an item you carry in the current room.",
  ],
  inspect: [
    "There is no separate inspect command.",
    "Use look at <object> to inspect something in the room or an item you carry.",
  ],
};

const GENERAL_HELP = [
  "Commands",
  "help [command] — List commands or show instructions for one.",
  "talk <npc> [about <topic>] — Speak privately with someone in the current room.",
  "look [at] <object> — Describe the room or inspect an object here or in your inventory.",
  "go <direction> — Travel through an available exit.",
  "read <object> — Read text on an object in the current room.",
  "take <item> | take all — Pick up one or all items in the current room.",
  "drop <item> — Put down an item you carry.",
  "Quick actions: Look, Read, Take, Drop, Go, Talk, and Help.",
];

function getCommandHelp(topic: string): readonly string[] {
  const normalizedTopic = topic.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  if (!normalizedTopic) return GENERAL_HELP;
  const helpTopic = normalizedTopic === "look at" ? "look" : normalizedTopic;
  return COMMAND_HELP[helpTopic] ?? [
    `No help is available for "${topic.trim()}".`,
    'Try "help" for the command list.',
  ];
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
  const [pending, setPending] = useState<"look" | "read" | "take" | "drop" | "move" | "talk" | null>(null);
  const [command, setCommand] = useState("");
  const [quickCommandPage, setQuickCommandPage] = useState<"main" | "more">("main");
  const [quickCommandMode, setQuickCommandMode] = useState<"quick" | "go" | "look" | "read" | "drop" | "take" | "talk">("quick");
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [activeDialogue, setActiveDialogue] = useState<DialogueProjection | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [inspectedCarriedItem, setInspectedCarriedItem] = useState<{ id: string; label: string; description: string }>();
  const [inventoryInspectError, setInventoryInspectError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    window.localStorage.getItem("mudd-theme") === "dark" ? "dark" : "light"
  );
  const [screen, setScreen] = useState<Screen>(currentScreen);
  const [chatFullscreen, setChatFullscreen] = useState(false);
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const contentRef = useRef<HTMLElement>(null);
  const terminalHistoryRef = useRef<HTMLDivElement>(null);
  const terminalFollowsLatestRef = useRef(true);
  const lastRoomLookIdRef = useRef<string | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleChatFullscreenChange = useCallback((fullscreen: boolean) => {
    setChatFullscreen(fullscreen);
    if (fullscreen) setMapFullscreen(false);
  }, []);
  const handleMapFullscreenChange = useCallback((fullscreen: boolean) => {
    setMapFullscreen(fullscreen);
    if (fullscreen) setChatFullscreen(false);
  }, []);

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
      const npcMatches = findNpcMatches(target, location.npcs ?? []);
      if (npcMatches.length === 1) {
        addEntry("narration", npcMatches[0]!.description);
        return;
      }
      if (npcMatches.length > 1) {
        addEntry("error", `Which one do you mean: ${npcMatches.map((npc) => npc.name).join(", ")}?`);
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
    if (!snapshot?.character || !snapshot.location || pending) return;
    setPending("read");
    try {
      const readable = await client.read(
        snapshot.character.characterId,
        objectId,
        snapshot.location.revision,
      );
      const nextSnapshot = await client.getGame();
      setSnapshot(nextSnapshot);
      setConnectionError("");
      addEntry("narration", readable.text);
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "You cannot read that just now.");
    } finally {
      setPending(null);
    }
  }, [addEntry, pending, snapshot]);

  const talkToNpc = useCallback(async (npcId: string, topic?: string) => {
    if (!snapshot?.character || pending) return;
    setPending("talk");
    try {
      const dialogue = await client.talk(snapshot.character.characterId, npcId, topic);
      addEntry("narration", `${dialogue.npcName}: ${dialogue.text}`);
      setActiveDialogue(dialogue.choices.length ? dialogue : null);
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "That person does not answer.");
    } finally {
      setPending(null);
    }
  }, [addEntry, pending, snapshot]);

  const chooseDialogueReply = useCallback(async (choiceId: string) => {
    if (!snapshot?.character || !activeDialogue || pending) return;
    const choice = activeDialogue.choices.find((candidate) => candidate.id === choiceId);
    if (!choice) return;

    setPending("talk");
    addEntry("system", `> ${choice.label}`);
    try {
      await client.chooseNpcDialogue(
        snapshot.character.characterId,
        activeDialogue.npcId,
        choice.id,
        snapshot.character.revision,
      );
      const [nextSnapshot, dialogue] = await Promise.all([
        client.getGame(),
        client.talk(snapshot.character.characterId, activeDialogue.npcId),
      ]);
      setSnapshot(nextSnapshot);
      setConnectionError("");
      setActiveDialogue(dialogue.choices.length ? dialogue : null);
      addEntry("narration", `${dialogue.npcName}: ${dialogue.text}`);
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "That reply is no longer available.");
    } finally {
      setPending(null);
    }
  }, [activeDialogue, addEntry, pending, snapshot]);

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

  const takeAllObjects = useCallback(async () => {
    if (!snapshot?.character || pending) return;
    setPending("take");
    try {
      let latestSnapshot = await client.getGame();
      let takenCount = 0;
      const initialTakeables = (latestSnapshot.location?.objects ?? []).filter((object) => object.takeable);
      if (!initialTakeables.length) {
        addEntry("error", "There is nothing here you can take.");
        return;
      }

      for (const item of initialTakeables) {
        const location = latestSnapshot.location;
        if (!location || !location.objects.some((object) => object.id === item.id && object.takeable)) continue;
        await client.take(snapshot.character.characterId, item.id, location.revision);
        latestSnapshot = await client.getGame();
        setSnapshot(latestSnapshot);
        setConnectionError("");
        addEntry("narration", `You pick up the ${item.label.toLocaleLowerCase()}.`);
        takenCount += 1;
      }

      if (!takenCount) addEntry("error", "There is nothing here you can take.");
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "You cannot take those items just now.");
      try {
        const currentSnapshot = await client.getGame();
        setSnapshot(currentSnapshot);
        setConnectionError("");
      } catch (refreshError) {
        const message = refreshError instanceof Error ? refreshError.message : "The world could not be reached.";
        setConnectionError(message);
        addEntry("error", message);
      }
    } finally {
      setPending(null);
    }
  }, [addEntry, pending, snapshot]);

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
    try {
      await client.move(snapshot.character.characterId, exit.id, snapshot.location.revision);
      await refreshAfterMutation(`You travel ${exit.direction || exit.label}.`);
      setActiveDialogue(null);
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "Unable to move.");
    } finally {
      setPending(null);
    }
  }, [addEntry, pending, refreshAfterMutation, snapshot]);

  const executeCommand = useCallback(async (rawCommand: string) => {
    const value = rawCommand.trim();
    if (!value || pending) return;
    const [verb, ...rest] = value.split(/\s+/);
    const target = rest.join(" ").trim();
    if (verb.toLowerCase() === "help") {
      addEntry("system", `> ${value}`);
      for (const line of getCommandHelp(target)) addEntry("narration", line);
      return;
    }
    if (verb.toLowerCase() === "talk") {
      addEntry("system", `> ${value}`);
      if (!target) {
        addEntry("error", "Talk to whom? Try “talk Mara”.");
        return;
      }
      const aboutMatch = /^(.+?)\s+about(?:\s+(.+))?$/i.exec(target);
      const npcTarget = aboutMatch?.[1]?.trim() || target;
      const topic = aboutMatch?.[2]?.trim();
      if (aboutMatch && !topic) {
        addEntry("error", "Talk about what? Try “talk Mara about the tower”.");
        return;
      }
      const matches = findNpcMatches(npcTarget, snapshot?.location?.npcs ?? []);
      if (matches.length === 0) {
        addEntry("error", `You do not see anyone called “${npcTarget}” here.`);
        return;
      }
      if (matches.length > 1) {
        addEntry("error", `Who do you mean: ${matches.map((npc) => npc.name).join(", ")}?`);
        return;
      }
      await talkToNpc(matches[0]!.id, topic);
      return;
    }
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
      if (target.toLocaleLowerCase() === "all") {
        await takeAllObjects();
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
    addEntry("error", 'Unknown command. Try "help" for the command list.');
  }, [addEntry, dropObject, inspect, move, pending, readObject, snapshot, takeAllObjects, takeObject, talkToNpc]);

  const submitQuickCommand = useCallback((rawCommand: string) => {
    setQuickCommandMode("quick");
    setQuickCommandPage("main");
    void executeCommand(rawCommand);
  }, [executeCommand]);

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
  const quickLookTargets = useMemo(() => {
    return [
      ...(snapshot?.location?.objects ?? []).map(({ id, label }) => ({ id, label })),
      ...(snapshot?.location?.npcs ?? []).map(({ id, name }) => ({ id, label: name })),
    ];
  }, [snapshot?.location?.npcs, snapshot?.location?.objects]);
  const quickTakeableObjects = useMemo(
    () => (snapshot?.location?.objects ?? []).filter((object) => object.takeable),
    [snapshot?.location?.objects],
  );
  const quickReturnLabel = quickCommandPage === "more" ? "Return to more quick actions" : "Return to quick commands";

  const handleContentTouchStart = (event: ReactTouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    const target = event.target;
    if (
      screen !== "play" ||
      !touch ||
      (target instanceof Element && target.closest("input, textarea, button, a, select"))
    ) {
      swipeStartRef.current = null;
      return;
    }
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleContentTouchEnd = (event: ReactTouchEvent<HTMLElement>) => {
    const start = swipeStartRef.current;
    const touch = event.changedTouches[0];
    swipeStartRef.current = null;
    if (!start || !touch) return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 80 || Math.abs(deltaY) > 60) return;
    if (deltaX > 0) {
      if (mapFullscreen) handleMapFullscreenChange(false);
      else if (!chatFullscreen) handleChatFullscreenChange(true);
    }
    if (deltaX < 0) {
      if (chatFullscreen) handleChatFullscreenChange(false);
      else if (!mapFullscreen) handleMapFullscreenChange(true);
    }
  };

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

      <section
        className="focused-content"
        key={screen}
        ref={contentRef}
        tabIndex={-1}
        aria-label={screen === "notes" ? "Field notes screen" : `${screen === "play" ? "Play" : "Traveler"} screen`}
        onTouchStart={handleContentTouchStart}
        onTouchEnd={handleContentTouchEnd}
        onTouchCancel={() => { swipeStartRef.current = null; }}
      >
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
                <TerminalPanel title={snapshot.location.title} busy={pending !== null}>
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
                  {activeDialogue?.choices.length ? (
                    <div className="focused-terminal-dialogue">
                      <div
                        className="focused-terminal-dialogue__choices"
                        role="group"
                        aria-label={`${activeDialogue.npcName} dialogue choices`}
                      >
                        {activeDialogue.choices.map((choice) => (
                          <button
                            key={choice.id}
                            type="button"
                            className="focused-quick-command"
                            onClick={() => void chooseDialogueReply(choice.id)}
                            disabled={pending !== null}
                          >
                            {choice.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <section className="focused-quick-commands" aria-label="Quick commands">
                    {quickCommandMode !== "quick" && (
                      <span className="focused-quick-commands__label" aria-hidden="true">
                        {quickCommandMode === "go" ? "Go"
                          : quickCommandMode === "look" ? "Look"
                            : quickCommandMode === "read" ? "Read"
                              : quickCommandMode === "drop" ? "Drop"
                                : quickCommandMode === "take" ? "Take" : "Talk"}
                      </span>
                    )}
                    <div
                      className="focused-quick-commands__actions"
                      role="group"
                      aria-label={
                        quickCommandMode === "quick"
                          ? quickCommandPage === "more" ? "More quick actions" : "Quick commands"
                          : quickCommandMode === "go" ? "Available directions"
                            : quickCommandMode === "look" ? "Things to look at"
                              : quickCommandMode === "read" ? "Readable objects"
                                : quickCommandMode === "drop" ? "Items to drop"
                                  : quickCommandMode === "talk" ? "People here" : "Items to take"
                      }
                    >
                      {quickCommandMode === "go" ? (
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
                              onClick={() => submitQuickCommand(`go ${direction.target}`)}
                              aria-label={`Go ${direction.label}`}
                              disabled={pending !== null}
                            >
                              {direction.label}
                            </button>
                          )) : <span className="focused-quick-commands__empty">No open directions</span>}
                        </>
                      ) : quickCommandMode === "look" ? (
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
                          <button
                            type="button"
                            className="focused-quick-command"
                            onClick={() => submitQuickCommand("look")}
                            aria-label="Look around"
                            disabled={pending !== null}
                          >
                            room
                          </button>
                          {quickLookTargets.map((target) => (
                            <button
                              key={target.id}
                              type="button"
                              className="focused-quick-command"
                              onClick={() => submitQuickCommand(`look at ${target.label}`)}
                              aria-label={`Look at ${target.label}`}
                              disabled={pending !== null}
                            >
                              {target.label.toLocaleLowerCase()}
                            </button>
                          ))}
                        </>
                      ) : quickCommandMode === "read" ? (
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
                          {(snapshot.location.objects ?? []).filter((object) => object.readable).length ? (
                            (snapshot.location.objects ?? []).filter((object) => object.readable).map((object) => (
                              <button
                                key={object.id}
                                type="button"
                                className="focused-quick-command"
                                onClick={() => submitQuickCommand(`read ${object.label}`)}
                                aria-label={`Read ${object.label}`}
                                disabled={pending !== null}
                              >
                                {object.label.toLocaleLowerCase()}
                              </button>
                            ))
                          ) : <span className="focused-quick-commands__empty">Nothing readable here</span>}
                        </>
                      ) : quickCommandMode === "drop" ? (
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
                          {(snapshot.character?.inventory ?? []).length ? (
                            (snapshot.character?.inventory ?? []).map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                className="focused-quick-command"
                                onClick={() => submitQuickCommand(`drop ${item.label}`)}
                                aria-label={`Drop ${item.label}`}
                                disabled={pending !== null}
                              >
                                {item.label.toLocaleLowerCase()}
                              </button>
                            ))
                          ) : <span className="focused-quick-commands__empty">Nothing to drop</span>}
                        </>
                      ) : quickCommandMode === "take" ? (
                        <>
                          <button
                            type="button"
                            className="focused-quick-command focused-quick-command--back"
                            onClick={() => setQuickCommandMode("quick")}
                            aria-label={quickReturnLabel}
                            disabled={pending !== null}
                          >
                            ‹
                          </button>
                          {quickTakeableObjects.length ? (
                            <>
                              <button
                                type="button"
                                className="focused-quick-command"
                                onClick={() => submitQuickCommand("take all")}
                                aria-label="Take all available items"
                                disabled={pending !== null}
                              >
                                all
                              </button>
                              {quickTakeableObjects.map((object) => (
                                <button
                                  key={object.id}
                                  type="button"
                                  className="focused-quick-command"
                                  onClick={() => submitQuickCommand(`take ${object.label}`)}
                                  aria-label={`Take ${object.label}`}
                                  disabled={pending !== null}
                                >
                                  {object.label.toLocaleLowerCase()}
                                </button>
                              ))}
                            </>
                          ) : <span className="focused-quick-commands__empty">Nothing to take here</span>}
                        </>
                      ) : quickCommandMode === "talk" ? (
                        <>
                          <button
                            type="button"
                            className="focused-quick-command focused-quick-command--back"
                            onClick={() => setQuickCommandMode("quick")}
                            aria-label={quickReturnLabel}
                            disabled={pending !== null}
                          >
                            ‹
                          </button>
                          {(snapshot.location.npcs ?? []).length ? (
                            (snapshot.location.npcs ?? []).map((npc) => (
                              <button
                                key={npc.id}
                                type="button"
                                className="focused-quick-command"
                                onClick={() => submitQuickCommand(`talk ${npc.name}`)}
                                aria-label={`Talk to ${npc.name}`}
                                disabled={pending !== null}
                              >
                                {npc.name}
                              </button>
                            ))
                          ) : <span className="focused-quick-commands__empty">No one to talk to here</span>}
                        </>
                      ) : quickCommandMode === "quick" && quickCommandPage === "more" ? (
                        <>
                          <button
                            type="button"
                            className="focused-quick-command focused-quick-command--back"
                            onClick={() => setQuickCommandPage("main")}
                            aria-label="Return to main quick actions"
                            disabled={pending !== null}
                          >
                            ‹
                          </button>
                          <button
                            type="button"
                            className="focused-quick-command"
                            onClick={() => setQuickCommandMode("take")}
                            aria-label="Show items to take"
                            disabled={pending !== null}
                          >
                            take <span aria-hidden="true">›</span>
                          </button>
                          <button
                            type="button"
                            className="focused-quick-command"
                            onClick={() => setQuickCommandMode("talk")}
                            aria-label="Show people to talk to"
                            disabled={pending !== null}
                          >
                            talk <span aria-hidden="true">›</span>
                          </button>
                          <button
                            type="button"
                            className="focused-quick-command"
                            onClick={() => submitQuickCommand("help")}
                            aria-label="Quick help"
                            disabled={pending !== null}
                          >
                            help
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="focused-quick-command"
                            onClick={() => setQuickCommandMode("look")}
                            aria-label="Show look targets"
                            disabled={pending !== null}
                          >
                            look <span aria-hidden="true">›</span>
                          </button>
                          <button
                            type="button"
                            className="focused-quick-command"
                            onClick={() => setQuickCommandMode("read")}
                            aria-label="Show readable objects"
                            disabled={pending !== null}
                          >
                            read <span aria-hidden="true">›</span>
                          </button>
                          <button
                            type="button"
                            className="focused-quick-command"
                            onClick={() => setQuickCommandMode("drop")}
                            aria-label="Show items to drop"
                            disabled={pending !== null}
                          >
                            drop <span aria-hidden="true">›</span>
                          </button>
                          <button
                            type="button"
                            className="focused-quick-command"
                            onClick={() => setQuickCommandMode("go")}
                            aria-label="Show available exits"
                            disabled={pending !== null}
                          >
                            go <span aria-hidden="true">›</span>
                          </button>
                          <button
                            type="button"
                            className="focused-quick-command focused-quick-command--next"
                            onClick={() => setQuickCommandPage("more")}
                            aria-label="Show more quick actions"
                            disabled={pending !== null}
                          >
                            ›
                          </button>
                        </>
                      )}
                    </div>
                  </section>
                  <section className="focused-command" aria-label="Text command">
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
                        {pending === "look" ? "Looking" : pending === "read" ? "Reading" : pending === "take" ? "Taking" : pending === "drop" ? "Dropping" : pending === "move" ? "Moving" : pending === "talk" ? "Talking" : "Send"}
                      </Button>
                    </form>
                  </section>
                </TerminalPanel>
                <RoomChatPanel
                  roomId={snapshot.location.locationId}
                  fullscreen={chatFullscreen}
                  onFullscreenChange={handleChatFullscreenChange}
                />
                <WorldMapPanel
                  map={snapshot.map}
                  fullscreen={mapFullscreen}
                  onFullscreenChange={handleMapFullscreenChange}
                />
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
              <div><div className="focused-kicker">Progress and session history</div><h1 className="focused-screen-title">Field notes</h1></div>
              <span className="focused-coordinate">{entries.length} {entries.length === 1 ? "entry" : "entries"}</span>
            </div>
            <div className="focused-notes-layout">
              <section className="focused-quest-journal" aria-labelledby="quest-journal-title">
                <h2 id="quest-journal-title">Quest journal</h2>
                {snapshot?.questJournal?.length ? (
                  <div className="focused-quest-list">
                    {snapshot.questJournal.map((quest) => (
                      <article className="focused-quest-card" key={quest.questId}>
                        <div className="focused-quest-heading">
                          <h3>{quest.title}</h3>
                          <span className={`focused-quest-status focused-quest-status--${quest.status}`}>
                            {quest.status === "completed" ? "Completed" : "Active"}
                          </span>
                        </div>
                        <p className="focused-quest-summary">{quest.summary}</p>
                        <ol className="focused-quest-objectives">
                          {quest.objectives.map((objective) => (
                            <li
                              className={objective.completed ? "focused-quest-objective focused-quest-objective--complete" : "focused-quest-objective"}
                              key={objective.id}
                            >
                              <span aria-hidden="true">{objective.completed ? "✓" : "○"}</span>
                              <span>{objective.label}</span>
                            </li>
                          ))}
                        </ol>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="focused-quest-empty">No quests accepted.</p>
                )}
              </section>
              <div className="focused-log">
                {entries.length ? (
                  <ActivityLog entries={[...entries].reverse()} label="Field notes" />
                ) : (
                  <p className="focused-feedback focused-feedback--empty">No activity this session. Actions and command results will appear here.</p>
                )}
              </div>
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
