import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { GameSnapshotSchema, MuddHttpClient, type CommandResponse, type GameSnapshot } from "@mudd/client-sdk";
import { FLEE_STAMINA_COST, type InteractionInbox } from "@mudd/contracts";
import {
  ActivityLog,
  Button,
  ClassAbilityList,
  ClassChoice,
  DailyBoard,
  DisclosureButton,
  InteractionOptionsDialog,
  NavigationControls,
  NpcDialogueDialog,
  Panel,
  Text,
  TextInput,
  type ActivityEntry,
  type ActivityLogAction,
  type ActivityLogTarget,
  type AvailableClassAction,
  type CharacterClassDefinition,
} from "@mudd/ui";
import { ChevronDown, Compass, Heart, Info as InfoIcon, Keyboard, Menu, Moon, Sparkles, Sun, Users, X, Zap } from "lucide-react";
import { RoomChatPanel, type RoomChatMessage } from "./RoomChatPanel.js";
import { ActionRefreshGate } from "./action-refresh-gate.js";
import { TerminalPanel } from "./TerminalPanel.js";
import { WorldMapPanel } from "./WorldMapPanel.js";
import CodexScreen from "./codex/CodexScreen.js";
import { PwaInstallAction } from "./lobby/PwaInstallAction.js";

const client = new MuddHttpClient({ worldInstanceId: "mudd-demo-instance", basePath: import.meta.env.BASE_URL });
type ClassCatalogSummary = { id: string; revision: number; classes: CharacterClassDefinition[] };
type CharacterClassSnapshot = CharacterClassDefinition & { catalogId: string; catalogRevision: number };
type ClassAwareCharacter = NonNullable<GameSnapshot["character"]> & {
  characterClass?: CharacterClassSnapshot;
  availableClassActions?: AvailableClassAction[];
};
const classCharacter = (character: GameSnapshot["character"]): ClassAwareCharacter | undefined =>
  character as ClassAwareCharacter | undefined;
type DialogueProjection = Awaited<ReturnType<MuddHttpClient["talk"]>>;
type MerchantCatalog = Awaited<ReturnType<MuddHttpClient["getMerchantCatalog"]>>;
type Screen = "play" | "vitals" | "items" | "equipment" | "stats" | "notes" | "codex";
type WorldClientProps = { onLeaveWorld: () => Promise<void>; worldInstanceId?: string };
type VisibleNpc = NonNullable<NonNullable<GameSnapshot["location"]>["npcs"]>[number];

function findObjectMatches<T extends { id: string; label: string }>(
  target: string,
  objects: readonly T[],
): T[] {
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

function respawnNotice(events: CommandResponse["events"], locationName: string): string | undefined {
  const event = events?.find((candidate) => candidate.type === "character.respawned");
  if (!event?.payload || typeof event.payload !== "object") return undefined;
  const payload = event.payload as {
    droppedItem?: { item?: { label?: unknown } };
  };
  const droppedLabel = typeof payload.droppedItem?.item?.label === "string"
    ? payload.droppedItem.item.label
    : undefined;
  return `You awaken at ${locationName}, restored to full health.${droppedLabel ? ` ${droppedLabel} was dropped where you fell.` : ""}`;
}

const COMMAND_HELP: Record<string, readonly string[]> = {
  help: [
    "Usage: help [command]",
    "Show the command list or instructions for one command.",
  ],
  party: [
    "Usage: party [help|info|list|create|join <id>|quests|quest start <id>|leave|close]",
    "Manage a public party of up to four players, start shared quests, and coordinate cooperative encounters.",
  ],
  quests: [
    "Usage: quests | quests <number or choice>",
    "After talking to an NPC, list and select one of their dialogue choices.",
  ],
  jobs: [
    "Usage: jobs [browse|accept <id>|deliver <id>]",
    "Browse today’s local bulletin, accept a posting, or deliver its carried supplies.",
  ],
  gather: [
    "Usage: gather <source-id or label>",
    "Collect a non-fish supply from a source in the current location. Use a fishing rod to fish.",
  ],
  accept: [
    "Usage: accept <request-id>",
    "Accept a pending player challenge addressed to your current character.",
  ],
  decline: [
    "Usage: decline <request-id>",
    "Decline a pending player challenge addressed to your current character.",
  ],
  talk: [
    "Usage: talk <npc> [about <topic>]",
    "Speak privately with someone here. Choose a reply or ask about a topic.",
  ],
  shop: [
    "Usage: shop <merchant>",
    "Browse the current merchant’s character-specific stock.",
  ],
  buy: [
    "Usage: buy <item>",
    "Buy an item from a merchant catalog you have opened in this room.",
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
    "Usage: read <object> | read bulletin",
    "Read written text in this room or open its daily bulletin.",
  ],
  take: [
    "Usage: take <item> | take all",
    "Pick up an item in the current room, or take all available items there.",
  ],
  equip: [
    "Usage: equip <item>",
    "Equip a carried weapon or armor item. Equipped gear changes combat damage.",
  ],
  unequip: [
    "Usage: unequip <weapon|armor>",
    "Remove the item from an equipment slot. Gear cannot be changed during combat.",
  ],
  use: [
    "Usage: use <item> on <target> | use <healing item> | use <fishing rod>",
    "Use an item on a room object, or restore health during or between encounters.",
  ],
  rest: [
    "Usage: rest",
    "Rest for free in any room while out of combat. Standing restores each vital by 2% of its maximum every two seconds; resting restores 6%.",
  ],
  stand: [
    "Usage: stand",
    "Leave the free resting posture so you can travel or begin combat.",
  ],
  inn: [
    "Usage: inn rest",
    "Immediately restore missing health, stamina, and mana at this inn for its listed price.",
  ],
  drop: [
    "Usage: drop <item>",
    "Put down an item you carry in the current room.",
  ],
  attack: [
    "Usage: attack <opponent> | attack",
    "Challenge a player in the same room, start a solo NPC fight, or attack during combat. Eligible online party members join NPC fights together.",
  ],
  defend: [
    "Usage: defend",
    "Guard against the opponent’s next strike during an active encounter.",
  ],
  flee: [
    "Usage: flee",
    `End an active PvE encounter and return to the room. Costs ${FLEE_STAMINA_COST} stamina.`,
  ],
  inspect: [
    "There is no separate inspect command.",
    "Use look at <object> to inspect something in the room or an item you carry.",
  ],
};

const GENERAL_HELP = [
  "Commands",
  "help [command] — List commands or show instructions for one.",
  "party [help|info|list|create|join <id>|quests|quest start <id>|leave|close] — Manage your party and its quests.",
  "quests [number or choice] — List or select a reply in the current NPC dialogue.",
  "jobs [browse|accept <id>|deliver <id>] — Browse the local daily bulletin and fulfil postings.",
  "gather <source> — Collect a local supply source; use a fishing rod to fish.",
  "talk <npc> [about <topic>] — Speak privately with someone in the current room.",
  "shop <merchant> — Browse a merchant’s goods and your balance.",
  "buy <item> — Purchase an item from the open merchant catalog.",
  "look [at] <object> — Describe the room or inspect an object here or in your inventory.",
  "go <direction> — Travel through an available exit.",
  "read <object> | read bulletin — Read room text or open the local daily bulletin.",
  "take <item> | take all — Pick up one or all items in the current room.",
  "equip <item> — Equip a carried weapon or armor item.",
  "unequip <weapon|armor> — Remove equipped gear from a slot.",
  "use <item> on <target> | use <healing item> | use <fishing rod> — Use a room item, restore health, or fish at a marked spot.",
  "rest — Rest for free in any room while out of combat; recover health, stamina, and mana.",
  "stand — Leave the free resting posture.",
  "inn rest — Immediately restore missing health, stamina, and mana for the inn’s listed price.",
  "drop <item> — Put down an item you carry.",
  "attack <opponent> — Begin an encounter or attack during combat.",
  "defend — Guard against the opponent’s next strike.",
  `flee — End an active PvE encounter; costs ${FLEE_STAMINA_COST} stamina.`,
  "Quick actions include available movement, item, equipment, merchant, dialogue, and combat actions.",
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
  const route = window.location.hash.slice(2).split("?")[0];
  if (route === "info/codex" || route.startsWith("info/codex/")) return "codex";
  if (route === "notes" || route === "info/notes" || route === "info/field-notes") return "notes";
  if (route === "info/items") return "items";
  if (route === "info/equipment") return "equipment";
  if (route === "info/stats") return "stats";
  if (route === "traveler" || route === "info" || route === "info/traveler" || route === "info/vitals") return "vitals";
  return "play";
}

function makeEntry(kind: ActivityEntry["kind"], text: string, locationId?: string): ActivityEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind,
    text,
    ...(locationId ? { locationId } : {}),
  };
}

function dailyCycleResetDate(cycle: string): string {
  const cycleStart = Date.parse(`${cycle}T00:00:00.000Z`);
  if (!Number.isFinite(cycleStart)) return cycle;
  return new Date(cycleStart + 86_400_000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function completedQuestObjectiveKeys(snapshot: GameSnapshot): string[] {
  return (snapshot.questJournal ?? []).flatMap((quest) =>
    quest.objectives
      .filter((objective) => objective.completed)
      .map((objective) => `${quest.questId}\u0000${objective.id}`),
  );
}

export function WorldClient({
  onLeaveWorld,
  worldInstanceId = window.localStorage.getItem("mudd-world-instance-id") ?? "mudd-demo-instance",
}: WorldClientProps) {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const activeLocationIdRef = useRef<string | undefined>(snapshot?.location?.locationId);
  activeLocationIdRef.current = snapshot?.location?.locationId;
  const [classCatalog, setClassCatalog] = useState<ClassCatalogSummary | undefined>();
  const [classCatalogError, setClassCatalogError] = useState<string>();
  const [classChoiceId, setClassChoiceId] = useState("");
  const [confirmClassAdoption, setConfirmClassAdoption] = useState(false);
  const [interactionInbox, setInteractionInbox] = useState<InteractionInbox | null>(null);
  const [partyInfo, setPartyInfo] = useState<Awaited<ReturnType<MuddHttpClient["getPartyInfo"]>> | null>(null);
  const [teamCombatInfo, setTeamCombatInfo] = useState<Awaited<ReturnType<MuddHttpClient["getTeamCombatInfo"]>> | null>(null);
  const teamPollingActive = useRef(false);
  teamPollingActive.current = Boolean(partyInfo?.party || teamCombatInfo?.encounter?.status === "active");
  const [presenceStale, setPresenceStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPendingState] = useState<"look" | "read" | "take" | "use" | "drop" | "move" | "talk" | "shop" | "buy" | "combat" | "rest" | "stand" | "equip" | "party" | "daily" | "gather" | null>(null);
  const refreshGate = useRef(new ActionRefreshGate());
  const actionTiming = useRef<{ name: string; started: number } | null>(null);
  const setPending = useCallback((value: typeof pending) => {
    if (value) {
      refreshGate.current.begin();
      actionTiming.current = { name: value, started: performance.now() };
    } else refreshGate.current.end();
    setPendingState(value);
  }, []);
  useLayoutEffect(() => {
    if (pending || !actionTiming.current) return;
    const { name, started } = actionTiming.current;
    const metric = `mudd:action-visible:${name}`;
    performance.clearMeasures?.(metric);
    performance.measure?.(metric, { start: started, end: performance.now() });
    actionTiming.current = null;
  }, [pending, snapshot]);
  const [command, setCommand] = useState("");
  const [quickCommandPage, setQuickCommandPage] = useState(1);
  const [quickCommandPageSize, setQuickCommandPageSize] = useState(() =>
    window.matchMedia?.("(min-width: 700px)").matches ? 6 : 4
  );
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    const desktopQuery = window.matchMedia?.("(min-width: 700px)");
    return desktopQuery ? !desktopQuery.matches : window.innerWidth < 700;
  });
  const [quickCommandMode, setQuickCommandMode] = useState<"quick" | "choose-exit" | "look" | "read" | "drop" | "take" | "talk" | "attack" | "shop" | "buy" | "use" | "use-target" | "equip" | "unequip">("quick");
  const [quickUseItemId, setQuickUseItemId] = useState<string | null>(null);
  const [combatUseMenuOpen, setCombatUseMenuOpen] = useState(false);
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [collapsedQuestGroups, setCollapsedQuestGroups] = useState({ active: false, completed: false });
  const [collapsedQuestCards, setCollapsedQuestCards] = useState<Set<string>>(() => new Set());
  const [activeDialogue, setActiveDialogue] = useState<DialogueProjection | null>(null);
  const [dialogueModalOpen, setDialogueModalOpen] = useState(false);
  const [activeInteractionTarget, setActiveInteractionTarget] = useState<ActivityLogTarget | null>(null);
  const [activeMerchantCatalog, setActiveMerchantCatalog] = useState<MerchantCatalog | null>(null);
  const [dailyBoard, setDailyBoard] = useState<Awaited<ReturnType<MuddHttpClient["dailyBoard"]>> | null>(null);
  const [dailyBoardContext, setDailyBoardContext] = useState<{
    characterId: string;
    locationId: string;
    worldInstanceId: string;
  } | null>(null);
  const [dailyBoardLoading, setDailyBoardLoading] = useState(false);
  const [dailyBoardError, setDailyBoardError] = useState("");
  const [pendingDailyJobId, setPendingDailyJobId] = useState<string>();
  const [connectionError, setConnectionError] = useState("");
  const [inspectedCarriedItem, setInspectedCarriedItem] = useState<{ id: string; label: string; description: string }>();
  const [inventoryInspectError, setInventoryInspectError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    window.localStorage.getItem("mudd-theme") === "dark" ? "dark" : "light"
  );
  const [screen, setScreen] = useState<Screen>(currentScreen);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileCommandInputOpen, setMobileCommandInputOpen] = useState(false);
  const [terminalExpandRequest, setTerminalExpandRequest] = useState(0);
  const [terminalCanScrollDown, setTerminalCanScrollDown] = useState(false);
  const [chatFullscreen, setChatFullscreen] = useState(false);
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const contentRef = useRef<HTMLElement>(null);
  const navMenuRef = useRef<HTMLDivElement>(null);
  const navMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const terminalHistoryRef = useRef<HTMLDivElement>(null);
  const fishingTickBusyRef = useRef(false);
  const woodcuttingTickBusyRef = useRef(false);
  const terminalFollowsLatestRef = useRef(true);
  const lastRoomLookIdRef = useRef<string | null>(null);
  const knownQuestObjectiveCompletionsRef = useRef<Set<string>>(new Set());
  const knownInteractionStatusesRef = useRef<Map<string, string>>(new Map());
  const knownPvpUpdateRef = useRef<string | null>(null);
  const knownPartyRevisionRef = useRef<number | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const dailyBoardRequestIdRef = useRef(0);
  const dailyContextRef = useRef({
    characterId: snapshot?.character?.characterId,
    locationId: snapshot?.location?.locationId,
    worldInstanceId,
    boardIds: (snapshot?.dailyActivities?.boards ?? []).map((board) => board.id),
  });
  dailyContextRef.current = {
    characterId: snapshot?.character?.characterId,
    locationId: snapshot?.location?.locationId,
    worldInstanceId,
    boardIds: (snapshot?.dailyActivities?.boards ?? []).map((board) => board.id),
  };
  const dailyBoardIdsKey = dailyContextRef.current.boardIds.join("\u0000");
  const displayedDailyBoard = dailyBoard && dailyBoardContext &&
    dailyBoardContext.characterId === dailyContextRef.current.characterId &&
    dailyBoardContext.locationId === dailyContextRef.current.locationId &&
    dailyBoardContext.worldInstanceId === dailyContextRef.current.worldInstanceId &&
    dailyContextRef.current.boardIds.includes(dailyBoard.boardId)
    ? dailyBoard
    : null;

  useEffect(() => {
    dailyBoardRequestIdRef.current += 1;
    setDailyBoard(null);
    setDailyBoardContext(null);
    setDailyBoardError("");
    setDailyBoardLoading(false);
    setPendingDailyJobId(undefined);
  }, [
    snapshot?.character?.characterId,
    snapshot?.location?.locationId,
    worldInstanceId,
    dailyBoardIdsKey,
  ]);

  useEffect(() => {
    let active = true;
    setClassCatalogError(undefined);
    void client.getWorlds().then((worlds) => {
      if (!active) return;
      const world = worlds.find((candidate) => candidate.worldInstanceId === worldInstanceId);
      setClassCatalog(world?.classCatalog);
    }).catch(() => {
      if (active) {
        setClassCatalog(undefined);
        setClassCatalogError("Class choices could not be loaded. Reconnect or reload to try again.");
      }
    });
    return () => { active = false; };
  }, [worldInstanceId]);

  useEffect(() => {
    setClassChoiceId("");
    setConfirmClassAdoption(false);
  }, [snapshot?.character?.characterId]);

  useEffect(() => {
    setMenuOpen(false);
    setMobileCommandInputOpen(false);
  }, [screen]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !navMenuRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      navMenuTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const handleChatFullscreenChange = useCallback((fullscreen: boolean) => {
    setChatFullscreen(fullscreen);
    if (fullscreen) setMapFullscreen(false);
  }, []);
  const handleMapFullscreenChange = useCallback((fullscreen: boolean) => {
    setMapFullscreen(fullscreen);
    if (fullscreen) setChatFullscreen(false);
  }, []);

  const addEntry = useCallback((
    kind: ActivityEntry["kind"],
    text: string,
    preserveScroll = false,
    locationId = activeLocationIdRef.current,
  ) => {
    terminalFollowsLatestRef.current = !preserveScroll;
    setEntries((current) => [...current, makeEntry(kind, text, locationId)]);
  }, []);
  const addNpcTerminalEvent = useCallback((message: RoomChatMessage) => {
    addEntry("narration", `${message.speakerName}: ${message.text}`, true);
  }, [addEntry]);

  const rememberCompletedQuestObjectives = useCallback((nextSnapshot: GameSnapshot) => {
    for (const key of completedQuestObjectiveKeys(nextSnapshot)) {
      knownQuestObjectiveCompletionsRef.current.add(key);
    }
  }, []);

  const announceNewQuestObjectives = useCallback((nextSnapshot: GameSnapshot) => {
    for (const quest of nextSnapshot.questJournal ?? []) {
      if (quest.status !== "active") continue;
      for (const objective of quest.objectives) {
        if (!objective.completed) continue;
        const key = `${quest.questId}\u0000${objective.id}`;
        if (knownQuestObjectiveCompletionsRef.current.has(key)) continue;
        knownQuestObjectiveCompletionsRef.current.add(key);
        addEntry("system", `Objective complete: ${objective.label} — ${quest.title}.`);
      }
    }
  }, [addEntry]);

  const addDefaultLook = useCallback((location: GameSnapshot["location"]) => {
    if (!location || lastRoomLookIdRef.current === location.locationId) return;
    lastRoomLookIdRef.current = location.locationId;
    addEntry("system", "> look");
    addEntry("location", location.title, false, location.locationId);
    addEntry("narration", location.description, false, location.locationId);
  }, [addEntry]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("mudd-theme", theme);
  }, [theme]);

  useEffect(() => {
    const history = terminalHistoryRef.current;
    if (screen !== "play" || !history) {
      setTerminalCanScrollDown(false);
      return;
    }
    if (terminalFollowsLatestRef.current) history.scrollTop = history.scrollHeight;
    setTerminalCanScrollDown(history.scrollHeight - history.scrollTop - history.clientHeight > 32);
  }, [entries, screen]);

  const scrollTerminalToLatest = useCallback(() => {
    const history = terminalHistoryRef.current;
    if (!history) return;
    terminalFollowsLatestRef.current = true;
    history.scrollTop = history.scrollHeight;
    setTerminalCanScrollDown(false);
  }, []);

  useEffect(() => {
    const navigate = () => {
      setScreen(currentScreen());
      window.scrollTo?.(0, 0);
      requestAnimationFrame(() => contentRef.current?.focus());
    };
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);

  useEffect(() => {
    client.setWorldInstanceId(worldInstanceId);
  }, [worldInstanceId]);

  const loadGame = useCallback(async () => {
    setLoading(true);
    setConnectionError("");
    try {
      const nextSnapshot = await client.getGame();
      rememberCompletedQuestObjectives(nextSnapshot);
      setSnapshot(nextSnapshot);
      addDefaultLook(nextSnapshot.location);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The world could not be reached.";
      setConnectionError(message);
      addEntry("error", message);
    } finally {
      setLoading(false);
    }
  }, [addDefaultLook, addEntry, rememberCompletedQuestObjectives]);

  useEffect(() => {
    void loadGame();
  }, [loadGame]);

  const presenceCharacterId = snapshot?.character &&
    snapshot.character.health?.current !== 0 &&
    snapshot.character.combat?.status !== "defeat"
    ? snapshot.character.characterId
    : null;

  useEffect(() => {
    if (!presenceCharacterId) {
      setPresenceStale(false);
      return;
    }

    let active = true;
    let requestRunning = false;
    const sendHeartbeat = async () => {
      if (!active || document.visibilityState === "hidden" || requestRunning || refreshGate.current.busy) return;
      const epoch = refreshGate.current.capture();
      requestRunning = true;
      try {
        const presence = await client.heartbeatWorldSession();
        if (!active || !refreshGate.current.accepts(epoch)) return;
        setSnapshot((current) => {
          const location = current?.location;
          if (
            !current ||
            !location ||
            presence.worldInstanceId !== location.worldInstanceId ||
            presence.locationId !== location.locationId
          ) return current;
          return { ...current, location: { ...location, occupants: presence.occupants } };
        });
        setPresenceStale(false);
      } catch {
        if (active) setPresenceStale(true);
      } finally {
        requestRunning = false;
      }
    };
    let snapshotRefreshRunning = false;
    const refreshSnapshot = async () => {
      if (!active || document.visibilityState === "hidden" || snapshotRefreshRunning || refreshGate.current.busy) return;
      const epoch = refreshGate.current.capture();
      snapshotRefreshRunning = true;
      try {
        const latest = GameSnapshotSchema.parse(await client.getGame());
        if (active && refreshGate.current.accepts(epoch)) setSnapshot((current) => {
          const previousLocation = current?.location;
          if (previousLocation && latest.location &&
              previousLocation.worldInstanceId === latest.location.worldInstanceId &&
              previousLocation.locationId === latest.location.locationId) {
            return { ...latest, location: { ...latest.location, occupants: previousLocation.occupants } };
          }
          return latest;
        });
      } catch {
        // Keep the last known snapshot; heartbeat owns connection health.
      } finally {
        snapshotRefreshRunning = false;
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void sendHeartbeat();
        void refreshSnapshot();
      }
    };

    void sendHeartbeat();
    const interval = window.setInterval(() => void sendHeartbeat(), 30_000);
    const snapshotFallback = window.setInterval(() => {
      if (client.realtimeConnectionState !== 'connected') void refreshSnapshot();
    }, 15_000);
    const stopPresence = client.watchRealtime("presence", sendHeartbeat, 3_000, () => !refreshGate.current.busy);
    // Presence remains frequent for multiplayer; the full game snapshot also
    // includes map, journal, stats and room data, so refresh that less often.
    const stopSnapshot = client.watchRealtime("character", refreshSnapshot, 15_000, () => !refreshGate.current.busy);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("pageshow", refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.clearInterval(snapshotFallback);
      stopPresence();
      stopSnapshot();
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("pageshow", refreshWhenVisible);
    };
  }, [presenceCharacterId]);

  useEffect(() => {
    if (!presenceCharacterId) {
      setInteractionInbox(null);
      knownInteractionStatusesRef.current.clear();
      return;
    }
    let active = true;
    let requestRunning = false;
    const refreshInteractions = async () => {
      if (!active || document.visibilityState === "hidden" || requestRunning || refreshGate.current.busy) return;
      const epoch = refreshGate.current.capture();
      requestRunning = true;
      try {
        const inbox = await client.getInteractionInbox();
        if (!active || !refreshGate.current.accepts(epoch)) return;
        for (const request of inbox.requests) {
          const previous = knownInteractionStatusesRef.current.get(request.requestId);
          if (previous === undefined) {
            if (request.status === "pending" && request.recipientCharacterId === presenceCharacterId) {
              addEntry("system", `${request.initiatorName} challenges you. Use “accept ${request.requestId}” or “decline ${request.requestId}”.`, true);
            }
          } else if (previous !== request.status) {
            const message = request.status === "accepted"
              ? `${request.recipientName} accepted your challenge.`
              : request.status === "declined"
                ? `${request.recipientName} declined your challenge.`
                : request.status === "expired"
                  ? `The challenge to ${request.recipientName} expired.`
                  : request.status === "cancelled"
                    ? `The challenge with ${request.recipientName} was cancelled.`
                    : "";
            if (message && request.initiatorCharacterId === presenceCharacterId) addEntry("system", message, true);
          }
          knownInteractionStatusesRef.current.set(request.requestId, request.status);
        }
        const encounter = inbox.encounter;
        const pvpUpdateKey = encounter ? `${encounter.encounterId}:${encounter.updatedAt}` : null;
        if (encounter && pvpUpdateKey !== knownPvpUpdateRef.current) {
          addEntry("narration", encounter.lastNarration, true);
        }
        knownPvpUpdateRef.current = pvpUpdateKey;
        setInteractionInbox(inbox);
      } catch {
        // Keep the last known state; the normal game heartbeat reports connection health.
      } finally {
        requestRunning = false;
      }
    };
    void refreshInteractions();
    const stopInteractions = client.watchRealtime("interactions", refreshInteractions, 3_000, () => !refreshGate.current.busy);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshInteractions();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      stopInteractions();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [addEntry, presenceCharacterId]);

  const refreshPartyState = useCallback(async (preserveTerminalScroll = false) => {
    if (!presenceCharacterId) return null;
    if (preserveTerminalScroll && refreshGate.current.busy) return null;
    const epoch = refreshGate.current.capture();
    const previousRevision = knownPartyRevisionRef.current;
    const next = await client.getPartyInfo(presenceCharacterId, previousRevision ?? undefined);
    if (preserveTerminalScroll && !refreshGate.current.accepts(epoch)) return null;
    if (previousRevision !== null) {
      for (const activity of next.activity) {
        if (activity.playerId === snapshot?.player.id) continue;
        const who = activity.displayName ?? "A player";
        const message = activity.type === "joined"
          ? `${who} joined the party.`
          : activity.type === "left"
            ? `${who} left the party.`
            : activity.type === "closed"
              ? `${who} closed the party.`
              : `${who} formed a party.`;
        addEntry("system", message, preserveTerminalScroll);
      }
    }
    knownPartyRevisionRef.current = next.revision;
    setPartyInfo(next);
    return next;
  }, [addEntry, presenceCharacterId, snapshot?.player.id]);

  const refreshTeamCombat = useCallback(async () => {
    if (!presenceCharacterId) return null;
    const next = await client.getTeamCombatInfo(presenceCharacterId);
    setTeamCombatInfo(next);
    return next;
  }, [presenceCharacterId]);

  useEffect(() => {
    if (!presenceCharacterId) {
      setTeamCombatInfo(null);
      return;
    }
    let active = true;
    let requestRunning = false;
    let lastChecked = 0;
    const poll = async () => {
      if (!active || requestRunning || document.visibilityState === "hidden" || refreshGate.current.busy) return;
      if (!teamPollingActive.current && Date.now() - lastChecked < 6_000) return;
      const epoch = refreshGate.current.capture();
      lastChecked = Date.now();
      requestRunning = true;
      try {
        const next = await client.getTeamCombatInfo(presenceCharacterId);
        if (active && refreshGate.current.accepts(epoch)) setTeamCombatInfo(next);
      } catch {
        // Keep the last known encounter while the connection recovers.
      } finally {
        requestRunning = false;
      }
    };
    void poll();
    const stopTeam = client.watchRealtime("team", () => { lastChecked = 0; return poll(); }, 2_000,
      () => !refreshGate.current.busy);
    return () => {
      active = false;
      stopTeam();
    };
  }, [presenceCharacterId]);

  useEffect(() => {
    if (!presenceCharacterId) {
      setPartyInfo(null);
      knownPartyRevisionRef.current = null;
      return;
    }
    knownPartyRevisionRef.current = null;
    let active = true;
    let requestRunning = false;
    const pollParty = async () => {
      if (!active || document.visibilityState === "hidden" || requestRunning) return;
      requestRunning = true;
      try {
        await refreshPartyState(true);
      } catch {
        // Party notifications are optional; keep the last known terminal state.
      } finally {
        requestRunning = false;
      }
    };
    void pollParty();
    const stopParty = client.watchRealtime("party", pollParty, partyInfo?.party ? 3_000 : 9_000,
      () => !refreshGate.current.busy);
    const onVisible = () => {
      if (document.visibilityState === "visible") void pollParty();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      stopParty();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [presenceCharacterId, refreshPartyState, Boolean(partyInfo?.party)]);

  const refreshAfterMutation = useCallback(async (
    message: string,
    announceQuestObjectives = false,
    traceId?: string,
  ) => {
    addEntry("system", message);
    const nextSnapshot = await client.getGame(traceId);
    setSnapshot(nextSnapshot);
    setConnectionError("");
    addDefaultLook(nextSnapshot.location);
    if (announceQuestObjectives) announceNewQuestObjectives(nextSnapshot);
    else rememberCompletedQuestObjectives(nextSnapshot);
    return nextSnapshot;
  }, [addDefaultLook, addEntry, announceNewQuestObjectives, rememberCompletedQuestObjectives]);

  const fetchDailyBoard = useCallback(async (boardId: string) => {
    const requestContext = { ...dailyContextRef.current };
    if (!requestContext.characterId || !requestContext.locationId) {
      const message = "Enter the world with a character before browsing daily postings.";
      setDailyBoardError(message);
      throw new Error(message);
    }
    if (!requestContext.boardIds.includes(boardId)) {
      dailyBoardRequestIdRef.current += 1;
      setDailyBoard(null);
      setDailyBoardContext(null);
      setDailyBoardError("");
      setDailyBoardLoading(false);
      return null;
    }
    const requestId = ++dailyBoardRequestIdRef.current;
    setDailyBoardLoading(true);
    setDailyBoardError("");
    try {
      const board = await client.dailyBoard(requestContext.characterId, boardId);
      const latestContext = dailyContextRef.current;
      if (
        requestId !== dailyBoardRequestIdRef.current ||
        latestContext.characterId !== requestContext.characterId ||
        latestContext.locationId !== requestContext.locationId ||
        latestContext.worldInstanceId !== requestContext.worldInstanceId ||
        !latestContext.boardIds.includes(boardId)
      ) return null;
      if (!board) throw new Error("The bulletin returned no postings.");
      setDailyBoard(board);
      setDailyBoardContext({
        characterId: requestContext.characterId,
        locationId: requestContext.locationId,
        worldInstanceId: requestContext.worldInstanceId,
      });
      return board;
    } catch (error) {
      if (requestId !== dailyBoardRequestIdRef.current) return null;
      const message = error instanceof Error ? error.message : "The daily bulletin could not be reached.";
      setDailyBoardError(message);
      throw error;
    } finally {
      if (requestId === dailyBoardRequestIdRef.current) setDailyBoardLoading(false);
    }
  }, []);

  const openDailyBoard = useCallback(async (boardId?: string) => {
    const characterId = snapshot?.character?.characterId;
    const selectedBoardId = boardId ?? snapshot?.dailyActivities?.boards[0]?.id;
    if (!characterId) {
      addEntry("error", "Enter the world with a character before browsing daily postings.");
      return null;
    }
    if (!selectedBoardId) {
      addEntry("narration", "There is no daily bulletin available in this world.");
      setDailyBoard(null);
      return null;
    }
    try {
      const board = await fetchDailyBoard(selectedBoardId);
      if (!board) return null;
      addEntry("system", `${board.name} — cycle ${board.cycle}.`);
      const resetAt = new Date(board.resetsAt);
      const remainingMs = Math.max(0, resetAt.getTime() - Date.now());
      const resetHours = Math.floor(remainingMs / 3_600_000);
      const resetMinutes = Math.floor((remainingMs % 3_600_000) / 60_000);
      addEntry("narration", `Resets at ${resetAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} (${resetHours}h ${resetMinutes}m remaining).`);
      for (const job of board.jobs) {
        const supplyLabel = snapshot?.dailyActivities?.sources.find(
          (source) => source.supply.typeId === job.supplyTypeId,
        )?.supply.label ?? job.supplyTypeId;
        const status = job.status === "available" ? "available" : job.status === "active" ? "in progress" : "completed";
        addEntry(
          "narration",
          `${job.poster}: ${job.title}. Bring ${job.quantity} ${supplyLabel}; ${job.carried}/${job.quantity} carried. Status: ${status}. Reward: ${job.gold} gold and ${job.experience} XP.`,
        );
      }
      return board;
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "The daily bulletin could not be reached.");
      return null;
    }
  }, [addEntry, fetchDailyBoard, snapshot?.character?.characterId, snapshot?.dailyActivities?.boards, snapshot?.dailyActivities?.sources]);

  const performDailyJob = useCallback(async (
    board: NonNullable<typeof dailyBoard>,
    jobId: string,
    action: "accept" | "deliver",
  ) => {
    if (!snapshot?.character || pending) return;
    const job = board.jobs.find((candidate) => candidate.id === jobId);
    if (!job) {
      addEntry("error", "That posting is no longer on this bulletin.");
      return;
    }
    setPending("daily");
    setPendingDailyJobId(jobId);
    try {
      const response = await client.dailyJob(snapshot.character.characterId, snapshot.character.revision, {
        boardId: board.boardId,
        cycle: board.cycle,
        jobId,
        action,
      });
      let message = `Accepted “${job.title}” from ${job.poster}.`;
      if (action === "deliver") {
        const event = response.events?.find((candidate) => candidate.type === "character.daily_job_changed");
        const payload = event?.payload;
        const actualGold = payload && typeof payload === "object" && "gold" in payload && typeof payload.gold === "number"
          ? payload.gold
          : job.gold;
        const actualExperience = payload && typeof payload === "object" && "experience" in payload && typeof payload.experience === "number"
          ? payload.experience
          : job.experience;
        message = `Delivered “${job.title}” for ${actualGold} gold and ${actualExperience} XP.`;
      }
      const updatedSnapshot = await refreshAfterMutation(message);
      const stillAtBoard = updatedSnapshot.character?.characterId === snapshot.character.characterId &&
        updatedSnapshot.location?.locationId === snapshot.location?.locationId &&
        updatedSnapshot.dailyActivities?.boards.some((candidate) => candidate.id === board.boardId);
      if (stillAtBoard) {
        try {
          await fetchDailyBoard(board.boardId);
        } catch {
          // The command succeeded; the inline board exposes its own refresh error.
        }
      }
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : `You could not ${action} that posting.`);
    } finally {
      setPendingDailyJobId(undefined);
      setPending(null);
    }
  }, [addEntry, fetchDailyBoard, pending, refreshAfterMutation, snapshot]);

  const performSupplyGather = useCallback(async (sourceId: string, label: string) => {
    if (!snapshot?.character || pending) return;
    const cycle = snapshot.dailyActivities?.cycle;
    if (!cycle) {
      addEntry("error", "Daily supply gathering is not available right now.");
      return;
    }
    setPending("gather");
    try {
      await client.gatherSupply(snapshot.character.characterId, snapshot.character.revision, sourceId, cycle);
      const updatedSnapshot = await refreshAfterMutation(`Gathered supplies at ${label}.`);
      const stillAtBoard = dailyBoard && updatedSnapshot.character?.characterId === snapshot.character.characterId &&
        updatedSnapshot.location?.locationId === snapshot.location?.locationId &&
        updatedSnapshot.dailyActivities?.boards.some((candidate) => candidate.id === dailyBoard.boardId);
      if (stillAtBoard && dailyBoard) {
        try {
          await fetchDailyBoard(dailyBoard.boardId);
        } catch {
          // A board refresh failure must not turn a successful gather into a failed action.
        }
      }
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "You could not gather that supply.");
    } finally {
      setPending(null);
    }
  }, [addEntry, dailyBoard, fetchDailyBoard, pending, refreshAfterMutation, snapshot]);

  const performFishingTick = useCallback(async (castId: string) => {
    if (fishingTickBusyRef.current) return;
    fishingTickBusyRef.current = true;
    try {
      const current = await client.getGame();
      const character = current.character;
      if (!character?.activeFishing || character.activeFishing.castId !== castId) {
        setSnapshot(current);
        return;
      }
      const result = await client.advanceFishingCast(character.characterId, castId, character.revision);
      const event = result.events?.find((candidate) => candidate.type === "character.fishing_cast_advanced");
      const payload = event?.payload;
      const next = await client.getGame();
      setSnapshot(next);
      setConnectionError("");
      if (!payload || typeof payload !== "object" || !("status" in payload)) return;
      const outcome = payload as {
        status?: unknown;
        item?: { label?: unknown; fishCatch?: { lengthCm?: unknown; weightGrams?: unknown; rarity?: unknown } };
      };
      if (outcome.status === "caught" && outcome.item) {
        const fish = outcome.item;
        addEntry("narration", `You caught a ${typeof fish.label === "string" ? fish.label : "fish"}!`);
        if (typeof fish.fishCatch?.lengthCm === "number" && typeof fish.fishCatch?.weightGrams === "number") {
          const rarity = typeof fish.fishCatch.rarity === "string"
            ? `${fish.fishCatch.rarity.charAt(0).toLocaleUpperCase()}${fish.fishCatch.rarity.slice(1)} catch`
            : "Catch";
          addEntry("system", `${rarity}: ${fish.fishCatch.lengthCm} cm, ${fish.fishCatch.weightGrams} g.`);
        }
      } else if (outcome.status === "no-bite") {
        addEntry("narration", "No bites. You reel in your line.");
      } else if (outcome.status === "interrupted") {
        addEntry("narration", "Your fishing is interrupted. You reel in your line.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The fishing cast could not be advanced.";
      if (message.includes("line is still in the water")) {
        window.setTimeout(() => { void performFishingTick(castId); }, 250);
      } else {
        addEntry("error", message);
        try {
          const refreshed = await client.getGame();
          setSnapshot(refreshed);
          if (refreshed.character?.activeFishing?.castId === castId) {
            window.setTimeout(() => { void performFishingTick(castId); }, 1_000);
          }
        } catch {
          // The cast will be resumed from its persisted snapshot after reconnect.
        }
      }
    } finally {
      fishingTickBusyRef.current = false;
    }
  }, [addEntry]);

  const performFishingCast = useCallback(async (rodItemId: string) => {
    if (!snapshot?.character || pending) return;
    setPending("use");
    try {
      await client.startFishingCast(snapshot.character.characterId, rodItemId, snapshot.character.revision);
      const next = await client.getGame();
      setSnapshot(next);
      setConnectionError("");
      addEntry("narration", "You cast your line and wait...");
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "You cannot fish here.");
    } finally {
      setPending(null);
    }
  }, [addEntry, pending, snapshot]);

  const activeFishingCast = snapshot?.character?.activeFishing;
  useEffect(() => {
    if (!activeFishingCast) return;
    const nextTickAt = Date.parse(activeFishingCast.startedAt) +
      (activeFishingCast.ticksCompleted + 1) * activeFishingCast.tickIntervalSeconds * 1000;
    const timer = window.setTimeout(() => {
      void performFishingTick(activeFishingCast.castId);
    }, Math.max(0, nextTickAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [
    activeFishingCast?.castId,
    activeFishingCast?.startedAt,
    activeFishingCast?.ticksCompleted,
    activeFishingCast?.tickIntervalSeconds,
    performFishingTick,
  ]);

  const performWoodcuttingTick = useCallback(async (actionId: string) => {
    if (woodcuttingTickBusyRef.current) return;
    woodcuttingTickBusyRef.current = true;
    try {
      const current = await client.getGame();
      const character = current.character;
      if (!character?.activeWoodcutting || character.activeWoodcutting.actionId !== actionId) {
        setSnapshot(current);
        return;
      }
      const result = await client.advanceWoodcutting(character.characterId, actionId, character.revision);
      const event = result.events?.find((candidate) => candidate.type === "character.woodcutting_action_advanced");
      const payload = event?.payload;
      const next = await client.getGame();
      setSnapshot(next);
      setConnectionError("");
      if (!payload || typeof payload !== "object" || !("status" in payload)) return;
      const outcome = payload as {
        status?: unknown;
        logLabel?: unknown;
        skillExperienceAwarded?: unknown;
        totalExperience?: unknown;
        level?: unknown;
        treeDepleted?: unknown;
      };
      if (outcome.status === "logged") {
        const label = typeof outcome.logLabel === "string" ? outcome.logLabel : "logs";
        addEntry("narration", `You cut a bundle of ${label}.`);
        if (typeof outcome.skillExperienceAwarded === "number" &&
            typeof outcome.totalExperience === "number" && typeof outcome.level === "number") {
          addEntry("system", `Woodcutting +${outcome.skillExperienceAwarded} XP · Level ${outcome.level} · ${outcome.totalExperience} XP total.`);
        }
        if (outcome.treeDepleted === true) {
          addEntry("narration", "The pine has been chopped down. It will regrow in about a minute.");
        }
      } else if (outcome.status === "no-log") {
        addEntry("narration", "You swing for ten seconds, but no logs come free.");
      } else if (outcome.status === "tree-depleted") {
        addEntry("narration", "The tree has already been chopped down.");
      } else if (outcome.status === "interrupted") {
        addEntry("narration", "You stop chopping.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The woodcutting action could not be advanced.";
      if (message.includes("axe is still swinging")) {
        window.setTimeout(() => { void performWoodcuttingTick(actionId); }, 250);
      } else if (/revision|conflict/i.test(message)) {
        try {
          const refreshed = await client.getGame();
          setSnapshot(refreshed);
          if (refreshed.character?.activeWoodcutting?.actionId === actionId) {
            window.setTimeout(() => { void performWoodcuttingTick(actionId); }, 250);
          }
        } catch {
          // Refresh and resume the persisted action on the next connection update.
        }
      } else {
        addEntry("error", message);
        try {
          const refreshed = await client.getGame();
          setSnapshot(refreshed);
          if (refreshed.character?.activeWoodcutting?.actionId === actionId) {
            window.setTimeout(() => { void performWoodcuttingTick(actionId); }, 1_000);
          }
        } catch {
          // The action resumes from its persisted character projection after reconnect.
        }
      }
    } finally {
      woodcuttingTickBusyRef.current = false;
    }
  }, [addEntry]);

  const performWoodcuttingStart = useCallback(async (axeItemId: string, treeId: string) => {
    if (!snapshot?.character || pending) return;
    setPending("use");
    try {
      await client.startWoodcutting(snapshot.character.characterId, axeItemId, treeId, snapshot.character.revision);
      const next = await client.getGame();
      setSnapshot(next);
      setConnectionError("");
      addEntry("narration", "You begin swinging your axe at the tree...");
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "You cannot chop that tree.");
    } finally {
      setPending(null);
    }
  }, [addEntry, pending, snapshot]);

  const activeWoodcutting = snapshot?.character?.activeWoodcutting;
  useEffect(() => {
    if (!activeWoodcutting) return;
    const nextTickAt = Date.parse(activeWoodcutting.startedAt) +
      (activeWoodcutting.ticksCompleted + 1) * 1000;
    const timer = window.setTimeout(() => {
      void performWoodcuttingTick(activeWoodcutting.actionId);
    }, Math.max(0, nextTickAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [
    activeWoodcutting?.actionId,
    activeWoodcutting?.startedAt,
    activeWoodcutting?.ticksCompleted,
    performWoodcuttingTick,
  ]);

  const handleDailyJobAction = useCallback((jobId: string, action: "accept" | "deliver") => {
    if (displayedDailyBoard) void performDailyJob(displayedDailyBoard, jobId, action);
  }, [displayedDailyBoard, performDailyJob]);

  useEffect(() => {
    if (!displayedDailyBoard) return;
    const resetAt = Date.parse(displayedDailyBoard.resetsAt);
    let timeout = 0;
    const refreshAtReset = () => {
      const remaining = resetAt - Date.now();
      if (remaining > 0) {
        timeout = window.setTimeout(refreshAtReset, Math.min(remaining + 100, 2_147_000_000));
        return;
      }
      const current = dailyContextRef.current;
      if (
        current.characterId !== dailyBoardContext?.characterId ||
        current.locationId !== dailyBoardContext?.locationId ||
        current.worldInstanceId !== dailyBoardContext?.worldInstanceId ||
        !current.boardIds.includes(displayedDailyBoard.boardId)
      ) return;
      void loadGame();
      void fetchDailyBoard(displayedDailyBoard.boardId).catch(() => undefined);
    };
    timeout = window.setTimeout(refreshAtReset, Math.min(Math.max(0, resetAt - Date.now() + 100), 2_147_000_000));
    return () => window.clearTimeout(timeout);
  }, [dailyBoardContext, displayedDailyBoard?.boardId, displayedDailyBoard?.cycle, displayedDailyBoard?.resetsAt, fetchDailyBoard, loadGame]);

  const closeDailyBoard = useCallback(() => {
    dailyBoardRequestIdRef.current += 1;
    setDailyBoard(null);
    setDailyBoardContext(null);
    setDailyBoardError("");
    setDailyBoardLoading(false);
  }, []);

  const inspect = useCallback(async (target?: string) => {
    if (!snapshot?.character || pending) return;
    setPending("look");
    try {
      const location = await client.look(
        snapshot.character.characterId,
        undefined,
        { includeNpcDescriptions: true },
      );
      setSnapshot((current) => current ? { ...current, location } : current);
      if (!target) {
        addEntry("location", location.title);
        addEntry("narration", location.description);
        return;
      }
      const npcMatches = findNpcMatches(target, location.npcs ?? []);
      if (npcMatches.length === 1) {
        const description = npcMatches[0]!.description;
        if (!description) {
          addEntry("error", `You cannot get a clear look at ${npcMatches[0]!.name} right now.`);
          return;
        }
        addEntry("narration", description);
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
      announceNewQuestObjectives(nextSnapshot);
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "You cannot read that just now.");
    } finally {
      setPending(null);
    }
  }, [addEntry, announceNewQuestObjectives, pending, snapshot]);

  const talkToNpc = useCallback(async (npcId: string, topic?: string) => {
    if (!snapshot?.character || pending) return;
    setPending("talk");
    try {
      const dialogue = await client.talk(snapshot.character.characterId, npcId, topic);
      addEntry("narration", `${dialogue.npcName}: ${dialogue.text}`);
      setActiveDialogue(dialogue);
      setDialogueModalOpen((isOpen) => isOpen || dialogue.choices.length > 0);
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "That person does not answer.");
    } finally {
      setPending(null);
    }
  }, [addEntry, pending, snapshot]);

  const chooseDialogueReply = useCallback(async (choiceId: string, announceChoice = true) => {
    if (!snapshot?.character || !activeDialogue || pending) return;
    const choice = activeDialogue.choices.find((candidate) => candidate.id === choiceId);
    if (!choice) return;

    setPending("talk");
    if (announceChoice) addEntry("system", `> ${choice.label}`);
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
      rememberCompletedQuestObjectives(nextSnapshot);
      setSnapshot(nextSnapshot);
      setConnectionError("");
      setActiveDialogue(dialogue);
      setDialogueModalOpen((isOpen) => isOpen || dialogue.choices.length > 0);
      addEntry("narration", `${dialogue.npcName}: ${dialogue.text}`);
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "That reply is no longer available.");
    } finally {
      setPending(null);
    }
  }, [activeDialogue, addEntry, pending, rememberCompletedQuestObjectives, snapshot]);

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
    if (snapshot.character.inventory.find((item) => item.id === itemId)?.questBound) {
      addEntry("error", "Quest items cannot be dropped.");
      return;
    }
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

  const changeEquipment = useCallback(async (
    action: "equip" | "unequip",
    itemOrSlot: string,
  ) => {
    if (!snapshot?.character || pending) return;
    const item = action === "equip"
      ? snapshot.character.inventory.find((candidate) => candidate.id === itemOrSlot)
      : undefined;
    const slot = action === "equip" ? item?.equipment?.slot : itemOrSlot as "weapon" | "armor";
    if (!slot) return;
    setPending("equip");
    try {
      if (action === "equip") {
        await client.equip(snapshot.character.characterId, item!.id, snapshot.character.revision);
      } else {
        await client.unequip(snapshot.character.characterId, slot, snapshot.character.revision);
      }
      const nextSnapshot = await client.getGame();
      setSnapshot(nextSnapshot);
      setConnectionError("");
      addEntry("narration", action === "equip"
        ? `You equip the ${item!.label.toLocaleLowerCase()} as your ${slot}.`
        : `You unequip your ${slot}.`);
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "Your equipment could not be changed.");
    } finally {
      setPending(null);
    }
  }, [addEntry, pending, snapshot]);

  const performItemUse = useCallback(async (itemId: string, targetId: string) => {
    if (!snapshot?.character || !snapshot.location || pending) return;
    setPending("use");
    try {
      const result = await client.use(
        snapshot.character.characterId,
        itemId,
        targetId,
        snapshot.location.revision,
      );
      const nextSnapshot = await client.getGame();
      setSnapshot(nextSnapshot);
      setConnectionError("");
      addEntry("narration", result.response);
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "You cannot use that item here.");
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
    const traceId = new URLSearchParams(window.location.search).get("muddTrace") === "1"
      ? crypto.randomUUID()
      : undefined;
    const actionStartedAt = traceId ? performance.now() : 0;
    let snapshotReadyAt: number | undefined;
    const logMoveTrace = (outcome: "success" | "error") => {
      if (!traceId) return;
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const paintedAt = performance.now();
        console.info("[mudd_perf_trace_action]", JSON.stringify({
          traceId,
          action: exit.roadId ? "character.road.step" : "character.move",
          outcome,
          commandAndSnapshotMs: snapshotReadyAt === undefined
            ? null
            : Math.round((snapshotReadyAt - actionStartedAt) * 10) / 10,
          snapshotToPaintMs: snapshotReadyAt === undefined
            ? null
            : Math.round((paintedAt - snapshotReadyAt) * 10) / 10,
          actionToPaintMs: Math.round((paintedAt - actionStartedAt) * 10) / 10,
        }));
      }));
    };
    setPending("move");
    try {
      const response = exit.roadId
        ? await client.roadStep(snapshot.character.characterId, exit.id, snapshot.location.revision, undefined, traceId)
        : await client.move(snapshot.character.characterId, exit.id, snapshot.location.revision, undefined, traceId);
      const partyAmbush = response.events?.some((event) => event.type === "team.road_encounter_started");
      const nextSnapshot = await refreshAfterMutation(
        partyAmbush
          ? "A roadside ambush interrupts your travel."
          : `You travel ${exit.direction || exit.label}.`,
        true,
        traceId,
      );
      snapshotReadyAt = traceId ? performance.now() : undefined;
      if (partyAmbush) {
        const nextTeamInfo = await refreshTeamCombat();
        if (nextTeamInfo?.encounter) {
          addEntry("narration", `${nextTeamInfo.encounter.lastNarration} Round ${nextTeamInfo.encounter.round}.`);
        }
      } else if (response.events?.some((event) => event.type === "character.combat_encounter_started")) {
        addEntry("narration", nextSnapshot.character?.combat?.lastNarration ?? "A roadside opponent blocks your way.");
      }
      if (!dialogueModalOpen) setActiveDialogue(null);
      setActiveMerchantCatalog(null);
      logMoveTrace("success");
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "Unable to move.");
      logMoveTrace("error");
    } finally {
      setPending(null);
    }
  }, [addEntry, dialogueModalOpen, pending, refreshAfterMutation, refreshTeamCombat, snapshot]);

  const browseMerchant = useCallback(async (merchantNpcId: string) => {
    if (!snapshot?.character || pending) return;
    setPending("shop");
    try {
      const catalog = await client.getMerchantCatalog(snapshot.character.characterId, merchantNpcId);
      setActiveMerchantCatalog(catalog);
      addEntry("narration", `${catalog.merchantName} has the following goods for sale.`);
    } catch (error) {
      setActiveMerchantCatalog(null);
      addEntry("error", error instanceof Error ? error.message : "You cannot browse that merchant’s goods.");
    } finally {
      setPending(null);
    }
  }, [addEntry, pending, snapshot]);

  const purchaseMerchantListing = useCallback(async (listingId: string, recordCommand = false) => {
    if (!snapshot?.character || !snapshot.location || !activeMerchantCatalog || pending) return;
    const listing = activeMerchantCatalog.listings.find((candidate) => candidate.id === listingId);
    if (!listing) return;
    if (recordCommand) addEntry("system", `> buy ${listing.item.label.toLocaleLowerCase()}`);
    setPending("buy");
    try {
      await client.purchaseMerchantListing(
        snapshot.character.characterId,
        activeMerchantCatalog.merchantNpcId,
        listing.id,
        snapshot.location.revision,
      );
      const [nextSnapshot, nextCatalog] = await Promise.all([
        client.getGame(),
        client.getMerchantCatalog(snapshot.character.characterId, activeMerchantCatalog.merchantNpcId),
      ]);
      setSnapshot(nextSnapshot);
      setActiveMerchantCatalog(nextCatalog);
      setConnectionError("");
      addEntry(
        "narration",
        `You buy the ${listing.item.label.toLocaleLowerCase()} for ${listing.price} ${nextCatalog.currency.name}${listing.price === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "The purchase could not be completed.");
    } finally {
      setPending(null);
    }
  }, [activeMerchantCatalog, addEntry, pending, snapshot]);

  const performCombatAction = useCallback(async (
    action: "attack" | "defend" | "flee" | "use-item",
    targetNpcId?: string,
    recordCommand = false,
    itemId?: string,
  ) => {
    if (!snapshot?.character || !snapshot.location || pending) return;
    const previousExperience = snapshot.character.advancement?.experience ?? 0;
    const activeEncounter = snapshot.character.combat?.status === "active"
      ? snapshot.character.combat
      : undefined;
    let activeTeamEncounter = teamCombatInfo?.encounter?.status === "active"
      ? teamCombatInfo.encounter
      : undefined;
    if (recordCommand) {
      const commandText = action === "attack" && targetNpcId
        ? `> attack ${snapshot.location.npcs?.find((npc) => npc.id === targetNpcId)?.name ?? "opponent"}`
        : action === "use-item" && itemId
          ? `> use ${snapshot.character.inventory.find((item) => item.id === itemId)?.label ?? "item"}`
          : `> ${action}`;
      addEntry("system", commandText);
    }
    setPending("combat");
    try {
      let playerHasParty = Boolean(partyInfo?.party);
      if (!activeTeamEncounter && !activeEncounter && action === "attack" && targetNpcId) {
        const currentParty = await client.getPartyInfo(snapshot.character.characterId);
        setPartyInfo(currentParty);
        playerHasParty = Boolean(currentParty.party);
      }
      let result;
      if (activeTeamEncounter) {
        result = await client.performTeamCombatAction(
          snapshot.character.characterId,
          activeTeamEncounter.encounterId,
          action,
          itemId ? { itemId } : {},
        );
      } else if (!activeEncounter && action === "attack" && targetNpcId && playerHasParty) {
        const started = await client.startTeamCombat(
          snapshot.character.characterId,
          targetNpcId,
          snapshot.character.revision,
        );
        if (!started.receipt.ok) throw new Error(started.receipt.message);
        const startedInfo = await client.getTeamCombatInfo(snapshot.character.characterId);
        setTeamCombatInfo(startedInfo);
        activeTeamEncounter = startedInfo.encounter?.status === "active"
          ? startedInfo.encounter
          : undefined;
        if (!activeTeamEncounter) throw new Error("The cooperative encounter did not start.");
        result = await client.performTeamCombatAction(
          snapshot.character.characterId,
          activeTeamEncounter.encounterId,
          "attack",
        );
      } else {
        result = await client.performCombatAction(
          snapshot.character.characterId,
          action,
          snapshot.character.revision,
          activeEncounter
            ? { encounterId: activeEncounter.encounterId, ...(itemId ? { itemId } : {}) }
            : targetNpcId
              ? { targetNpcId }
              : itemId
                ? { itemId }
                : {},
        );
      }
      if (!result.receipt.ok) throw new Error(result.receipt.message);
      const [nextSnapshot, nextTeamInfo] = await Promise.all([
        client.getGame(),
        refreshTeamCombat(),
      ]);
      setSnapshot(nextSnapshot);
      if (nextTeamInfo) setTeamCombatInfo(nextTeamInfo);
      setConnectionError("");
      const encounter = nextSnapshot.character?.combat;
      const teamEncounter = nextTeamInfo?.encounter;
      const notice = respawnNotice(result.events, nextSnapshot.location?.title ?? "the fountain");
      if (notice) {
        addEntry("narration", notice);
      } else if (teamEncounter) {
        addEntry("narration", `${teamEncounter.lastNarration} Round ${teamEncounter.round}.`);
      } else if (action === "use-item" && !activeEncounter) {
        const nextHealth = nextSnapshot.character?.health;
        const previousHealth = snapshot.character.health;
        const label = snapshot.character.inventory.find((item) => item.id === itemId)?.label ?? "item";
        const recovered = nextHealth && previousHealth
          ? nextHealth.current - previousHealth.current
          : 0;
        if (nextHealth) {
          addEntry("narration", `You use the ${label.toLocaleLowerCase()} and recover ${recovered} health. You: ${nextHealth.current}/${nextHealth.maximum}.`);
        }
      } else if (encounter) {
        const advancement = nextSnapshot.character?.advancement;
        const rewardNarration = encounter.status === "victory" &&
          advancement?.lastRewardedEncounterId === encounter.encounterId
          ? ` You gain ${advancement.experience - previousExperience} XP. Level ${advancement.level}.`
          : "";
        addEntry("narration", `${encounter.lastNarration}${rewardNarration} You: ${encounter.playerHealth}/${encounter.playerMaxHealth}. ${encounter.opponentName}: ${encounter.opponentHealth}/${encounter.opponentMaxHealth}.`);
      }
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "The combat action could not be completed.");
    } finally {
      setPending(null);
    }
  }, [addEntry, partyInfo?.party, pending, refreshTeamCombat, snapshot, teamCombatInfo]);

  const performClassAbility = useCallback(async (abilityId: string) => {
    const game = snapshot;
    const character = classCharacter(game?.character);
    if (!game?.character || !character || !game.location || pending) return;
    const teamEncounter = teamCombatInfo?.encounter?.status === "active" ? teamCombatInfo.encounter : undefined;
    const soloEncounter = game.character.combat?.status === "active" ? game.character.combat : undefined;
    const pvpEncounter = interactionInbox?.encounter?.status === "active" &&
      interactionInbox.encounter.participants.some((participant) => participant.characterId === game.character!.characterId)
      ? interactionInbox.encounter : undefined;
    if (!teamEncounter && !soloEncounter && !pvpEncounter) return;
    setPending("combat");
    try {
      const result = pvpEncounter
        ? await client.performPvpAction(game.character.characterId, pvpEncounter.encounterId, "ability", undefined, abilityId)
        : teamEncounter
          ? await client.performTeamCombatAction(game.character.characterId, teamEncounter.encounterId, "ability", { abilityId })
          : await client.performCombatAction(
            game.character.characterId,
            "ability",
            game.character.revision,
            { encounterId: soloEncounter?.encounterId, abilityId },
          );
      if (!result.receipt.ok) throw new Error(result.receipt.message);
      const [nextSnapshot, nextTeamInfo, nextInbox] = await Promise.all([
        client.getGame(),
        refreshTeamCombat(),
        pvpEncounter ? client.getInteractionInbox() : Promise.resolve(interactionInbox),
      ]);
      setSnapshot(nextSnapshot);
      if (nextTeamInfo) setTeamCombatInfo(nextTeamInfo);
      if (nextInbox) setInteractionInbox(nextInbox);
      const refreshedPvp = nextInbox?.encounter;
      const refreshedTeam = nextTeamInfo?.encounter;
      const refreshedSolo = nextSnapshot.character?.combat;
      const narration = pvpEncounter
        ? refreshedPvp?.lastNarration
        : teamEncounter
          ? refreshedTeam?.lastNarration
          : refreshedSolo?.lastNarration;
      if (narration) addEntry("narration", narration);
      setConnectionError("");
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "The class action could not be completed.");
    } finally {
      setPending(null);
    }
  }, [addEntry, interactionInbox, pending, refreshTeamCombat, snapshot, teamCombatInfo]);

  const adoptCharacterClass = useCallback(async () => {
    const game = snapshot;
    const character = classCharacter(game?.character);
    if (!game?.character || !character || character.characterClass || !classChoiceId || pending) return;
    if (snapshot?.character?.combat?.status === "active" || teamCombatInfo?.encounter?.status === "active" || interactionInbox?.encounter?.status === "active") {
      addEntry("error", "Class adoption is available only outside combat.");
      return;
    }
    if (!confirmClassAdoption) {
      setConfirmClassAdoption(true);
      return;
    }
    setPending("combat");
    try {
      await client.chooseCharacterClass(
        game.character.characterId,
        game.character.revision,
        classChoiceId,
      );
      const nextSnapshot = await client.getGame();
      setSnapshot(nextSnapshot);
      setConfirmClassAdoption(false);
      setClassChoiceId("");
      addEntry("system", "Your class has been adopted. This choice cannot be changed.");
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "Class adoption could not be completed.");
    } finally {
      setPending(null);
    }
  }, [addEntry, classChoiceId, confirmClassAdoption, interactionInbox?.encounter?.status, pending, snapshot, teamCombatInfo?.encounter?.status]);

  const challengePlayer = useCallback(async (recipientCharacterId: string, recipientName: string) => {
    if (!snapshot?.character || pending) return;
    addEntry("system", `> attack ${recipientName}`);
    setPending("combat");
    try {
      await client.requestInteraction(snapshot.character.characterId, recipientCharacterId);
      addEntry("narration", `Challenge sent to ${recipientName}. Waiting for a response.`);
      setInteractionInbox(await client.getInteractionInbox());
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "The challenge could not be sent.");
    } finally {
      setPending(null);
    }
  }, [addEntry, pending, snapshot]);

  const respondToPlayerChallenge = useCallback(async (requestId: string, response: "accept" | "decline") => {
    if (!snapshot?.character || pending) return;
    setPending("combat");
    try {
      await client.respondToInteraction(snapshot.character.characterId, requestId, response);
      const inbox = await client.getInteractionInbox();
      setInteractionInbox(inbox);
      const request = inbox.requests.find((candidate) => candidate.requestId === requestId);
      addEntry("system", response === "accept"
        ? `You accept ${request?.initiatorName ?? "the challenge"}’s challenge.`
        : `You decline ${request?.initiatorName ?? "the challenge"}’s challenge.`);
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "You could not respond to that challenge.");
    } finally {
      setPending(null);
    }
  }, [addEntry, pending, snapshot]);

  const performPvpAction = useCallback(async (
    action: "attack" | "defend" | "flee" | "use-item",
    itemId?: string,
  ) => {
    const encounter = interactionInbox?.encounter;
    if (!snapshot?.character || !encounter || pending) return;
    setPending("combat");
    try {
      const result = await client.performPvpAction(snapshot.character.characterId, encounter.encounterId, action, itemId);
      const [inbox, nextSnapshot] = await Promise.all([client.getInteractionInbox(), client.getGame()]);
      setInteractionInbox(inbox);
      setSnapshot(nextSnapshot);
      const nextEncounter = inbox.encounter;
      if (nextEncounter) {
        knownPvpUpdateRef.current = `${nextEncounter.encounterId}:${nextEncounter.updatedAt}`;
        addEntry("narration", nextEncounter.lastNarration);
      }
      const notice = respawnNotice(result.events, nextSnapshot.location?.title ?? "the fountain");
      if (notice) addEntry("narration", notice);
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "The combat action could not be completed.");
    } finally {
      setPending(null);
    }
  }, [addEntry, interactionInbox, pending, snapshot]);

  const performStaminaPostureChange = useCallback(async (posture: "rest" | "stand") => {
    if (!snapshot?.character || pending) return;
    setPending(posture);
    try {
      if (posture === "rest") {
        await client.rest(snapshot.character.characterId, snapshot.character.revision);
      } else {
        await client.stand(snapshot.character.characterId, snapshot.character.revision);
      }
      const nextSnapshot = await client.getGame();
      setSnapshot(nextSnapshot);
      setConnectionError("");
      addEntry("narration", posture === "rest"
        ? "You ease into a resting posture. The surface beneath you feels cool and firm; your breathing slows as nearby sounds soften."
        : "You rise, stretching the stiffness from your limbs. Your clothes rustle as your feet find steady ground.");
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "You could not change your resting posture.");
    } finally {
      setPending(null);
    }
  }, [addEntry, pending, snapshot]);

  const performInnRest = useCallback(async () => {
    if (!snapshot?.character || !snapshot.location?.inn || pending) return;
    const inn = snapshot.location.inn;
    const previousHealth = snapshot.character.health;
    const previousResources = snapshot.character.resources;
    setPending("rest");
    try {
      await client.restAtInn(snapshot.character.characterId, inn.id, snapshot.character.revision);
      const nextSnapshot = await client.getGame();
      setSnapshot(nextSnapshot);
      setConnectionError("");
      const nextHealth = nextSnapshot.character?.health;
      const nextResources = nextSnapshot.character?.resources;
      const nextWallet = nextSnapshot.character?.wallet;
      const healthRestored = nextHealth
        ? nextHealth.current - (previousHealth?.current ?? nextHealth.maximum)
        : 0;
      const staminaRestored = nextResources
        ? nextResources.stamina.current - previousResources.stamina.current
        : 0;
      const manaRestored = nextResources
        ? nextResources.mana.current - previousResources.mana.current
        : 0;
      addEntry(
        "narration",
        `You rest at ${inn.name}, restore ${healthRestored} health, ${staminaRestored} stamina, and ${manaRestored} mana, and pay ${inn.restPrice} ${inn.currency.name}${inn.restPrice === 1 ? "" : "s"}. Health: ${nextHealth?.current ?? "—"}/${nextHealth?.maximum ?? "—"}. Balance: ${nextWallet?.balance ?? "—"}.`,
      );
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "You could not rest at this inn.");
    } finally {
      setPending(null);
    }
  }, [addEntry, pending, snapshot]);

  const executeCommand = useCallback(async (rawCommand: string) => {
    const value = rawCommand.trim();
    if (!value || pending) return;
    const [verb, ...rest] = value.split(/\s+/);
    const target = rest.join(" ").trim();
    if (["accept", "decline"].includes(verb.toLowerCase())) {
      addEntry("system", `> ${value}`);
      if (!target) {
        addEntry("error", `Choose a challenge ID: ${verb.toLowerCase()} <id>.`);
        return;
      }
      const request = interactionInbox?.requests.find((candidate) =>
        candidate.requestId === target &&
        candidate.recipientCharacterId === snapshot?.character?.characterId &&
        candidate.status === "pending");
      if (!request) {
        addEntry("error", "That pending challenge is not available to this character.");
        return;
      }
      await respondToPlayerChallenge(target, verb.toLowerCase() as "accept" | "decline");
      return;
    }
    if (verb.toLowerCase() === "help") {
      addEntry("system", `> ${value}`);
      for (const line of getCommandHelp(target)) addEntry("narration", line);
      return;
    }
    if (verb.toLocaleLowerCase() === "quests") {
      addEntry("system", `> ${value}`);
      const choices = activeDialogue?.choices ?? [];
      if (!activeDialogue || choices.length === 0) {
        addEntry("error", 'Talk to an NPC first with “talk <name>”; there are no dialogue choices to select.');
        return;
      }
      if (!target) {
        addEntry("narration", `Replies from ${activeDialogue.npcName}:`);
        choices.forEach((choice, index) => addEntry("narration", `${index + 1}. ${choice.label}`));
        addEntry("narration", "Choose a reply with “quests <number>”.");
        return;
      }

      const index = /^\d+$/.test(target) ? Number(target) : 0;
      const exactMatches = choices.filter(
        (choice) => choice.label.toLocaleLowerCase() === target.toLocaleLowerCase(),
      );
      const choice = index > 0
        ? choices[index - 1]
        : exactMatches.length === 1
          ? exactMatches[0]
          : undefined;
      if (!choice) {
        addEntry("error", `Choose a number from 1 to ${choices.length}, or enter a reply exactly as shown. Type “quests” to list replies.`);
        return;
      }
      await chooseDialogueReply(choice.id, false);
      return;
    }
    if (verb.toLowerCase() === "jobs") {
      addEntry("system", `> ${value}`);
      const commandArgs = target.split(/\s+/).filter(Boolean);
      const [subcommand = "browse", jobId] = commandArgs;
      const normalized = subcommand.toLocaleLowerCase();
      if (normalized === "help") {
        for (const line of getCommandHelp("jobs")) addEntry("narration", line);
        return;
      }
      const boardId = snapshot?.dailyActivities?.boards[0]?.id;
      if (normalized === "browse" && (commandArgs.length === 0 || commandArgs.length === 1)) {
        await openDailyBoard(boardId);
        return;
      }
      if ((normalized !== "accept" && normalized !== "deliver") || commandArgs.length !== 2 || !jobId) {
        addEntry("error", "Usage: jobs [browse|accept <id>|deliver <id>].");
        return;
      }
      if (!boardId) {
        addEntry("error", "There is no daily bulletin available in this world.");
        return;
      }
      try {
        const board = displayedDailyBoard?.boardId === boardId ? displayedDailyBoard : await fetchDailyBoard(boardId);
        if (!board) throw new Error("The bulletin returned no postings.");
        await performDailyJob(board, jobId, normalized);
      } catch (error) {
        addEntry("error", error instanceof Error ? error.message : "The daily posting could not be completed.");
      }
      return;
    }
    if (verb.toLowerCase() === "gather") {
      addEntry("system", `> ${value}`);
      const sources = (snapshot?.dailyActivities?.sources ?? [])
        .filter((source) => source.locationId === snapshot?.location?.locationId);
      if (!target) {
        addEntry("error", "Choose a local source: gather <source-id or label>.");
        return;
      }
      const matches = sources.filter((source) => {
        const search = target.toLocaleLowerCase();
        return source.id.toLocaleLowerCase() === search ||
          source.label.toLocaleLowerCase() === search ||
          source.label.toLocaleLowerCase().includes(search);
      });
      if (matches.length !== 1) {
        addEntry("error", matches.length
          ? `Which source do you mean: ${matches.map((source) => source.label).join(", ")}?`
          : `There is no local supply source matching “${target}”.`);
        return;
      }
      await performSupplyGather(matches[0]!.id, matches[0]!.label);
      return;
    }
    if (verb.toLowerCase() === "party") {
      addEntry("system", `> ${value}`);
      const [subcommand = "info", ...args] = target.split(/\s+/).filter(Boolean);
      const partyCommand = subcommand.toLocaleLowerCase();
      if (partyCommand === "help") {
        for (const line of getCommandHelp("party")) addEntry("narration", line);
        return;
      }
      if (!snapshot?.character) {
        addEntry("error", "Enter the world with a character before managing a party.");
        return;
      }
      setPending("party");
      try {
        if (partyCommand === "list") {
          const { parties } = await client.listParties(snapshot.character.characterId);
          if (!parties.length) {
            addEntry("narration", "There are no public parties available.");
          } else {
            for (const party of parties) {
              addEntry("narration",
                `${party.leaderName} — ${party.memberCount}/${party.maxMembers} members — ID ${party.groupId}${party.joinable ? "" : " (full)"}`);
            }
            addEntry("system", "Join with: party join <id>");
          }
        } else if (partyCommand === "quests" || (partyCommand === "quest" && args.length === 0)) {
          const journal = await client.getPartyQuests(snapshot.character.characterId);
          if (!journal.partyId) {
            addEntry("narration", "Join a party to view shared quests.");
          } else if (!journal.available.length && !journal.quests.length) {
            addEntry("narration", "There are no party quests available.");
          } else {
            for (const quest of journal.quests) {
              addEntry("narration", `${quest.title} (${quest.status}) — ${quest.summary}`);
              for (const objective of quest.objectives) {
                addEntry("narration", `${objective.completed ? "✓" : "·"} ${objective.progress}/${objective.required} ${objective.label}`);
              }
            }
            for (const quest of journal.available) {
              addEntry("narration", `${quest.title} — ${quest.summary} (start: party quest start ${quest.questId})`);
            }
          }
        } else if (partyCommand === "quest") {
          if (args.length !== 2 || args[0]?.toLocaleLowerCase() !== "start") {
            throw new Error("Usage: party quest start <quest-id>");
          }
          await client.startPartyQuest(snapshot.character.characterId, args[1]!);
          const journal = await client.getPartyQuests(snapshot.character.characterId);
          const started = journal.quests.find((quest) => quest.questId === args[1]);
          addEntry("narration", `Your party started ${started?.title ?? args[1]}.`);
        } else if (partyCommand === "create") {
          if (args.length) throw new Error("Usage: party create");
          await client.createParty(snapshot.character.characterId);
          const info = await refreshPartyState();
          addEntry("narration", `Party created${info?.party ? ` (ID ${info.party.groupId})` : ""}.`);
        } else if (partyCommand === "join") {
          if (args.length !== 1) throw new Error("Usage: party join <id>");
          await client.joinParty(snapshot.character.characterId, args[0]!);
          const info = await refreshPartyState();
          addEntry("narration", `You joined ${info?.party?.leaderName ?? "the party"}.`);
        } else if (partyCommand === "info") {
          if (args.length) throw new Error("Usage: party info");
          const info = await refreshPartyState() ?? partyInfo;
          if (!info?.party) {
            addEntry("narration", "You are not in a party. Use “party list” to browse or “party create” to start one.");
          } else {
            addEntry("narration",
              `${info.party.leaderName} leads party ${info.party.groupId} (${info.party.members.length}/${info.party.maxMembers}).`);
            for (const member of info.party.members) {
              addEntry("narration", `${member.displayName}${member.playerId === info.party.ownerPlayerId ? " (leader)" : ""}`);
            }
          }
        } else if (partyCommand === "leave") {
          if (args.length) throw new Error("Usage: party leave");
          const before = await refreshPartyState();
          await client.leaveParty(snapshot.character.characterId);
          await refreshPartyState();
          addEntry("narration", before?.party?.ownerPlayerId === snapshot.player.id
            ? "You left and closed your party."
            : "You left the party.");
        } else if (partyCommand === "close") {
          if (args.length) throw new Error("Usage: party close");
          await client.closeParty(snapshot.character.characterId);
          await refreshPartyState();
          addEntry("narration", "You closed the party.");
        } else {
          throw new Error('Unknown party command. Try “party help”.');
        }
      } catch (error) {
        addEntry("error", error instanceof Error ? error.message : "That party action could not be completed.");
      } finally {
        setPending(null);
      }
      return;
    }
    if (verb.toLowerCase() === "rest") {
      addEntry("system", `> ${value}`);
      if (target) {
        addEntry("error", 'Use “inn rest” for the paid immediate inn service.');
        return;
      }
      await performStaminaPostureChange("rest");
      return;
    }
    if (verb.toLowerCase() === "stand") {
      addEntry("system", `> ${value}`);
      if (target) {
        addEntry("error", "Use “stand” without a target.");
        return;
      }
      await performStaminaPostureChange("stand");
      return;
    }
    if (verb.toLowerCase() === "inn") {
      addEntry("system", `> ${value}`);
      if (target.toLocaleLowerCase() !== "rest") {
        addEntry("error", 'Usage: inn rest — immediately restore health, stamina, and mana for the listed price.');
        return;
      }
      if (!snapshot?.location?.inn) {
        addEntry("error", "There is no priced inn service in this location.");
        return;
      }
      await performInnRest();
      return;
    }
    if (["attack", "defend", "flee"].includes(verb.toLowerCase())) {
      const action = verb.toLowerCase() as "attack" | "defend" | "flee";
      addEntry("system", `> ${value}`);
      const activeEncounter = snapshot?.character?.combat?.status === "active"
        ? snapshot.character.combat
        : undefined;
      const activeTeamEncounter = teamCombatInfo?.encounter?.status === "active"
        ? teamCombatInfo.encounter
        : undefined;
      if (action === "attack" && !activeEncounter && !activeTeamEncounter) {
        if (!target) {
          addEntry("error", "Attack whom? Choose an available combatant or try “attack Practice Sentinel”.");
          return;
        }
        const targets = (snapshot?.location?.npcs ?? []).filter((npc) => npc.canChallenge);
        const matches = findNpcMatches(target, targets);
        if (matches.length === 0) {
          const playerMatches = (snapshot?.location?.occupants ?? [])
            .filter((player) =>
              player.id !== snapshot?.character?.characterId &&
              player.displayName.toLocaleLowerCase().includes(target.toLocaleLowerCase()));
          if (playerMatches.length === 1) {
            await challengePlayer(playerMatches[0]!.id, playerMatches[0]!.displayName);
            return;
          }
          if (playerMatches.length > 1) {
            addEntry("error", `Which player do you mean: ${playerMatches.map((player) => player.displayName).join(", ")}?`);
            return;
          }
          addEntry("error", `There is no available combatant called “${target}” here.`);
          return;
        }
        if (matches.length > 1) {
          addEntry("error", `Who do you mean: ${matches.map((npc) => npc.name).join(", ")}?`);
          return;
        }
        await performCombatAction("attack", matches[0]!.id);
        return;
      }
      if (!activeEncounter && !activeTeamEncounter) {
        addEntry("error", "There is no active encounter. Choose an available combatant to attack first.");
        return;
      }
      if (target) {
        const activeOpponent = activeEncounter?.opponentName ??
          activeTeamEncounter?.participants.find((participant) => participant.teamId !== "allies")?.displayName ??
          "the opponent";
        addEntry("error", `The active opponent is ${activeOpponent}; use “${action}” without a target.`);
        return;
      }
      await performCombatAction(action);
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
    if (verb.toLowerCase() === "shop") {
      addEntry("system", `> ${value}`);
      if (!target) {
        addEntry("error", "Browse whose goods? Try “shop Sella”.");
        return;
      }
      const matches = findNpcMatches(target, snapshot?.location?.npcs ?? []);
      if (matches.length === 0) {
        addEntry("error", `You do not see anyone called “${target}” here.`);
        return;
      }
      if (matches.length > 1) {
        addEntry("error", `Who do you mean: ${matches.map((npc) => npc.name).join(", ")}?`);
        return;
      }
      await browseMerchant(matches[0]!.id);
      return;
    }
    if (verb.toLowerCase() === "buy") {
      addEntry("system", `> ${value}`);
      if (!target) {
        addEntry("error", "Buy what? Browse the shop, then try “buy lantern”.");
        return;
      }
      if (!activeMerchantCatalog) {
        addEntry("error", "Open a merchant’s catalog first with “shop <merchant>”.");
        return;
      }
      const normalizedTarget = target.toLocaleLowerCase();
      const exactMatch = activeMerchantCatalog.listings.find((listing) =>
        listing.id.toLocaleLowerCase() === normalizedTarget ||
        listing.item.label.toLocaleLowerCase() === normalizedTarget
      );
      const matches = exactMatch
        ? [exactMatch]
        : activeMerchantCatalog.listings.filter((listing) =>
          listing.item.label.toLocaleLowerCase().includes(normalizedTarget)
        );
      if (matches.length === 0) {
        addEntry("error", `The open catalog has no item called “${target}”.`);
        return;
      }
      if (matches.length > 1) {
        addEntry("error", `Which item do you mean: ${matches.map((listing) => listing.item.label).join(", ")}?`);
        return;
      }
      await purchaseMerchantListing(matches[0]!.id);
      return;
    }
    if (verb.toLowerCase() === "equip") {
      addEntry("system", `> ${value}`);
      if (!target) {
        addEntry("error", "Equip what? Try “equip practice blade”.");
        return;
      }
      const inventory = snapshot?.character?.inventory ?? [];
      const matches = findObjectMatches(target, inventory.map((item) => ({
        ...item, readable: false, takeable: true,
      })));
      if (matches.length !== 1) {
        addEntry("error", matches.length
          ? `Which item do you mean: ${matches.map((item) => item.label).join(", ")}?`
          : `You are not carrying an item called “${target}”.`);
        return;
      }
      const item = inventory.find((candidate) => candidate.id === matches[0]!.id);
      if (!item?.equipment) {
        addEntry("error", `The ${matches[0]!.label.toLocaleLowerCase()} cannot be equipped.`);
        return;
      }
      await changeEquipment("equip", item.id);
      return;
    }
    if (verb.toLowerCase() === "unequip") {
      addEntry("system", `> ${value}`);
      const slot = target.toLocaleLowerCase();
      if (slot !== "weapon" && slot !== "armor") {
        addEntry("error", "Unequip which slot? Use “unequip weapon” or “unequip armor”.");
        return;
      }
      await changeEquipment("unequip", slot);
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
        addEntry("error", "Read what? Try “read marker” or “read bulletin”.");
        return;
      }
      const bulletinTarget = target.replace(/^the\s+/i, "").trim().toLocaleLowerCase();
      if (/^(?:daily\s+)?(?:bulletin|notice)(?:\s+board)?$/.test(bulletinTarget)) {
        const bulletin = snapshot?.dailyActivities?.boards[0];
        if (!bulletin) {
          addEntry("error", "There is no bulletin board here.");
          return;
        }
        await openDailyBoard(bulletin.id);
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
    if (verb.toLowerCase() === "use") {
      addEntry("system", `> ${value}`);
      const activeEncounter = snapshot?.character?.combat?.status === "active"
        ? snapshot.character.combat
        : undefined;
      if (activeEncounter) {
        if (!target || /\s+on\s+/i.test(target)) {
          addEntry("error", "During combat, use a healing item by name, for example “use Small healing draught”.");
          return;
        }
        const carriedItems = snapshot?.character?.inventory ?? [];
        const itemMatches = findObjectMatches(target.replace(/^(?:the|a|an)\s+/i, "").trim(), carriedItems);
        if (itemMatches.length === 0) {
          addEntry("error", `You are not carrying anything called “${target}”.`);
          return;
        }
        if (itemMatches.length > 1) {
          addEntry("error", `Which item do you mean: ${itemMatches.map((item) => item.label).join(", ")}?`);
          return;
        }
        const item = itemMatches[0]!;
        if (!item.consumable || item.equipment) {
          addEntry("error", `${item.label} cannot be used as a combat item.`);
          return;
        }
        await performCombatAction("use-item", undefined, false, item.id);
        return;
      }
      const useMatch = /^(.+?)\s+on\s+(.+)$/i.exec(target);
      if (!useMatch) {
        const itemTarget = target.replace(/^(?:the|a|an)\s+/i, "").trim();
        let itemMatches = findObjectMatches(itemTarget, snapshot?.character?.inventory ?? []);
        if (!itemMatches.length && itemTarget.replace(/\s+/g, "").toLocaleLowerCase() === "fishingrod") {
          itemMatches = (snapshot?.character?.inventory ?? []).filter((item) => item.fishingRod);
        }
        if (itemMatches.length > 1) {
          addEntry("error", `Which item do you mean: ${itemMatches.map((item) => item.label).join(", ")}?`);
          return;
        }
        const item = itemMatches[0];
        if (item?.consumable?.effect === "heal") {
          await performCombatAction("use-item", undefined, false, item.id);
          return;
        }
        if (item?.fishingRod) {
          await performFishingCast(item.id);
          return;
        }
        addEntry("error", "Use a healing item, a fishing rod at a marked spot, or an axe on a named tree.");
        return;
      }
      const itemTarget = useMatch[1]!.replace(/^(?:the|a|an)\s+/i, "").trim();
      const objectTarget = useMatch[2]!.replace(/^(?:the|a|an)\s+/i, "").trim();
      if (!itemTarget || !objectTarget) {
        addEntry("error", "Use what on what? Try “use stone on bell”.");
        return;
      }
      const carriedItems = (snapshot?.character?.inventory ?? []).map((item) => ({
        ...item, readable: false, takeable: true,
      }));
      const axeMatches = findObjectMatches(
        itemTarget,
        carriedItems.filter((item) => item.woodcuttingAxe),
      );
      if (axeMatches.length) {
        if (axeMatches.length > 1) {
          addEntry("error", `Which axe do you mean: ${axeMatches.map((item) => item.label).join(", ")}?`);
          return;
        }
        const treeMatches = findObjectMatches(objectTarget, snapshot?.availableWoodcuttingTrees ?? []);
        if (treeMatches.length === 0) {
          addEntry("error", `There is no tree called “${objectTarget}” here.`);
          return;
        }
        if (treeMatches.length > 1) {
          addEntry("error", `Which tree do you mean: ${treeMatches.map((tree) => tree.label).join(", ")}?`);
          return;
        }
        await performWoodcuttingStart(axeMatches[0]!.id, treeMatches[0]!.id);
        return;
      }
      const itemMatches = findObjectMatches(itemTarget, carriedItems);
      if (itemMatches.length === 0) {
        addEntry("error", `You are not carrying anything called “${itemTarget}”.`);
        return;
      }
      if (itemMatches.length > 1) {
        addEntry("error", `Which item do you mean: ${itemMatches.map((item) => item.label).join(", ")}?`);
        return;
      }
      const targetMatches = findObjectMatches(objectTarget, snapshot?.location?.objects ?? []);
      if (targetMatches.length === 0) {
        addEntry("error", `There is no object called “${objectTarget}” in this room.`);
        return;
      }
      if (targetMatches.length > 1) {
        addEntry("error", `Which target do you mean: ${targetMatches.map((object) => object.label).join(", ")}?`);
        return;
      }
      await performItemUse(itemMatches[0]!.id, targetMatches[0]!.id);
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
      const matches = exits.filter((exit) => exit.available && (
        exit.label.toLowerCase() === target.toLowerCase() ||
        exit.direction?.toLowerCase() === target.toLowerCase()
      ));
      addEntry("system", `> ${value}`);
      if (matches.length === 0) {
        addEntry("error", `No available exit matches “${target}”.`);
        return;
      }
      if (matches.length > 1) {
        addEntry("error", `More than one exit leads ${target}. Choose one: ${matches.map((exit) => exit.label).join('; ')}.`);
        return;
      }
      await move(matches[0]!.id);
      return;
    }
    addEntry("system", `> ${value}`);
    addEntry("error", 'Unknown command. Try "help" for the command list.');
  }, [activeDialogue, addEntry, browseMerchant, changeEquipment, chooseDialogueReply, dropObject, inspect, move, pending, purchaseMerchantListing, readObject, snapshot, takeAllObjects, takeObject, talkToNpc, performItemUse, performFishingCast, performWoodcuttingStart, activeMerchantCatalog, performCombatAction, performInnRest, performStaminaPostureChange, interactionInbox, respondToPlayerChallenge, challengePlayer, partyInfo, refreshPartyState, teamCombatInfo, openDailyBoard, fetchDailyBoard, performDailyJob, performSupplyGather, displayedDailyBoard]);

  const submitQuickCommand = useCallback((rawCommand: string) => {
    setQuickCommandMode("quick");
    setQuickCommandPage(1);
    setQuickUseItemId(null);
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
    const availableExits = exits.filter((exit) => exit.available);
    const directionCounts = new Map<string, number>();
    for (const exit of availableExits) {
      const direction = (exit.direction?.trim() || exit.label.trim()).toLowerCase();
      directionCounts.set(direction, (directionCounts.get(direction) ?? 0) + 1);
    }
    return availableExits.map((exit) => {
      const direction = exit.direction?.trim() || exit.label.trim();
      const isAmbiguous = (directionCounts.get(direction.toLowerCase()) ?? 0) > 1;
      const target = isAmbiguous ? exit.label.trim() : direction;
      return { target, label: isAmbiguous ? exit.label.trim() : direction.toLowerCase() };
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
  const challengeableNpcs = useMemo(
    () => (snapshot?.location?.npcs ?? []).filter((npc) => npc.canChallenge),
    [snapshot?.location?.npcs],
  );
  const quickShopNpcs = useMemo(
    () => (snapshot?.location?.npcs ?? []).filter((npc) => npc.canShop),
    [snapshot?.location?.npcs],
  );
  const quickBuyListings = useMemo(
    () => activeMerchantCatalog?.listings.filter((listing) =>
      !listing.purchased && activeMerchantCatalog.currency.balance >= listing.price
    ) ?? [],
    [activeMerchantCatalog],
  );
  const currentCombat = snapshot?.character?.combat;
  const isGameOver = currentCombat?.status === "defeat" || snapshot?.character?.health?.current === 0;
  const visibleCombat = currentCombat?.locationId === snapshot?.location?.locationId
    ? currentCombat
    : undefined;
  const latestTeamCombat = teamCombatInfo?.encounter;
  const visibleTeamCombat = latestTeamCombat?.locationId === snapshot?.location?.locationId
    ? latestTeamCombat
    : undefined;
  const activeTeamCombat = visibleTeamCombat?.status === "active" ? visibleTeamCombat : undefined;
  const teamCombatant = activeTeamCombat?.participants.find((participant) =>
    participant.kind === "player" &&
    participant.characterId === snapshot?.character?.characterId,
  );
  const isTeamCombatTurn = activeTeamCombat?.currentParticipantId === snapshot?.character?.characterId;
  const isAnyCombatActive = visibleCombat?.status === "active" || Boolean(activeTeamCombat);
  const visiblePvp = interactionInbox?.encounter &&
    interactionInbox.encounter.status !== "completed" &&
    interactionInbox.encounter.participants.some((participant) =>
      participant.characterId === snapshot?.character?.characterId)
    ? interactionInbox.encounter
    : undefined;
  const hasVisiblePvp = Boolean(visiblePvp);
  const isPvpTurn = visiblePvp?.turnCharacterId === snapshot?.character?.characterId;
  const availableClassActions = classCharacter(snapshot?.character)?.availableClassActions ?? [];
  const currentCharacterClass = classCharacter(snapshot?.character)?.characterClass;
  useEffect(() => {
    if (screen !== "play") return;

    const handleMovementKeys = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']"))
      ) return;

      let direction: "north" | "east" | "south" | "west" | "up" | "down" | undefined;
      if (event.shiftKey) {
        if (event.key === "ArrowUp") direction = "up";
        else if (event.key === "ArrowDown") direction = "down";
      } else {
        if (event.key === "ArrowUp") direction = "north";
        else if (event.key === "ArrowRight") direction = "east";
        else if (event.key === "ArrowDown") direction = "south";
        else if (event.key === "ArrowLeft") direction = "west";
      }
      if (!direction || !snapshot?.character || !snapshot.location || pending || isAnyCombatActive || hasVisiblePvp ||
          snapshot.character.staminaRecovery.posture === "resting") return;

      event.preventDefault();
      const matchingExits = snapshot.location.exits.filter((exit) =>
        exit.available && (exit.direction?.trim() || exit.label.trim()).toLocaleLowerCase() === direction
      );
      if (matchingExits.length > 1) {
        setQuickCommandPage(1);
        setQuickCommandMode("choose-exit");
        return;
      }
      if (matchingExits[0]) void move(matchingExits[0].id);
    };

    document.addEventListener("keydown", handleMovementKeys);
    return () => document.removeEventListener("keydown", handleMovementKeys);
  }, [hasVisiblePvp, isAnyCombatActive, move, pending, screen, snapshot]);
  useLayoutEffect(() => {
    if (!mobileCommandInputOpen) return;
    document.getElementById("focused-world-command")?.focus({ preventScroll: true });
  }, [mobileCommandInputOpen]);
  useEffect(() => {
    if (isAnyCombatActive || hasVisiblePvp) setMobileCommandInputOpen(false);
  }, [isAnyCombatActive, hasVisiblePvp]);
  useEffect(() => {
    setCombatUseMenuOpen(false);
  }, [visibleCombat?.encounterId, visibleCombat?.status, visibleTeamCombat?.encounterId, visibleTeamCombat?.status]);
  const quickInventory = snapshot?.character?.inventory ?? [];
  const outsideCombatHealth = snapshot?.character?.health;
  const canFlee = (snapshot?.character?.resources.stamina.current ?? 0) >= FLEE_STAMINA_COST;
  const canHealOutsideCombat = Boolean(
    outsideCombatHealth && outsideCombatHealth.current < outsideCombatHealth.maximum,
  );
  const quickUseItems = quickInventory.filter((item) => {
    if (item.fishingRod) {
      return !isAnyCombatActive && (snapshot?.availableFishingSpots?.length ?? 0) > 0;
    }
    if (item.woodcuttingAxe) {
      return !isAnyCombatActive && !snapshot?.character?.activeWoodcutting &&
        !snapshot?.character?.activeFishing && (snapshot?.availableWoodcuttingTrees?.length ?? 0) > 0;
    }
    if (item.consumable?.effect === "heal") {
      return activeTeamCombat
        ? Boolean(teamCombatant &&
          teamCombatant.health < teamCombatant.maximumHealth &&
          !(activeTeamCombat.consumedItemIdsByCharacter[snapshot?.character?.characterId ?? ""] ?? []).includes(item.id))
        : visibleCombat?.status === "active"
          ? visibleCombat.playerHealth < visibleCombat.playerMaxHealth
        : canHealOutsideCombat;
    }
    return !isAnyCombatActive &&
      (snapshot?.location?.objects ?? []).some((object) => !object.readable && !object.takeable);
  });
  const terminalLookTargets = useMemo<ActivityLogTarget[]>(() => {
    const location = snapshot?.location;
    if (!location) return [];
    const look: ActivityLogAction = { id: "look", label: "Look" };
    const inventory = snapshot?.character?.inventory ?? [];
    const equipment = snapshot?.character?.equipment;
    const usableItemIds = new Set(quickUseItems.map((item) => item.id));

    return [
      ...location.objects.map((object) => ({
        id: object.id,
        label: object.label,
        actions: [
          look,
          ...(object.readable ? [{ id: "read", label: "Read" }] : []),
          ...(object.takeable ? [{ id: "take", label: "Take" }] : []),
        ],
      })),
      ...(location.npcs ?? []).map((npc) => ({
        id: npc.id,
        label: npc.name,
        actions: [
          look,
          { id: "talk", label: "Talk" },
          ...(npc.canShop ? [{ id: "shop", label: "Shop" }] : []),
          ...(npc.canChallenge ? [{ id: "attack", label: "Attack" }] : []),
        ],
      })),
      ...inventory.map((item) => {
        const equippedSlot = item.id === equipment?.weaponItemId
          ? "weapon"
          : item.id === equipment?.armorItemId
            ? "armor"
            : undefined;
        const actions: ActivityLogAction[] = [{ id: "look", label: "Look" }];
        if (item.questBound !== true && !equippedSlot) actions.push({ id: "drop", label: "Drop" });
        if (item.equipment && !equippedSlot) actions.push({ id: "equip", label: "Equip" });
        if (equippedSlot) actions.push({ id: `unequip-${equippedSlot}`, label: `Unequip ${equippedSlot}` });
        if (usableItemIds.has(item.id)) actions.push({ id: "use", label: "Use" });
        return { id: `inventory:${item.id}`, label: item.label, actions };
      }),
      { id: `room:${location.locationId}`, label: location.title, actions: [look] },
    ];
  }, [quickUseItems, snapshot?.character?.equipment, snapshot?.character?.inventory, snapshot?.location]);
  const performTerminalTargetAction = (target: ActivityLogTarget, actionId: string) => {
    setActiveInteractionTarget(null);
    const label = target.label;
    if (actionId === "use" && target.id.startsWith("inventory:")) {
      const itemId = target.id.slice("inventory:".length);
      const item = snapshot?.character?.inventory.find((candidate) => candidate.id === itemId);
      if (!item) return;
      if (item.fishingRod || item.consumable?.effect === "heal") {
        submitQuickCommand(`use ${label}`);
      } else {
        setQuickUseItemId(item.id);
        setQuickCommandMode("use-target");
      }
      return;
    }

    const command = actionId === "look"
      ? target.id.startsWith("room:") ? "look" : `look ${label}`
      : actionId === "unequip-weapon"
        ? "unequip weapon"
        : actionId === "unequip-armor"
          ? "unequip armor"
          : ["read", "take", "talk", "shop", "attack", "drop", "equip"].includes(actionId)
            ? `${actionId} ${label}`
            : undefined;
    if (command) submitQuickCommand(command);
  };
  const handleTerminalLookTarget = (target: ActivityLogTarget) => {
    if ((target.actions?.length ?? 1) > 1) {
      setActiveInteractionTarget(target);
      return;
    }
    performTerminalTargetAction(target, target.actions?.[0]?.id ?? "look");
  };
  const quickCommandItems = useMemo(() => {
    type QuickAction = {
      id: string;
      label: string;
      ariaLabel: string;
      opensMenu: boolean;
      disabled?: boolean;
      onSelect: () => void;
    };
    const actions: QuickAction[] = [];
    const addMode = (
      id: string,
      mode: "look" | "read" | "drop" | "take" | "use" | "talk" | "shop" | "buy" | "attack" | "equip" | "unequip",
      ariaLabel: string,
    ) => actions.push({ id, label: id, ariaLabel, opensMenu: true, onSelect: () => setQuickCommandMode(mode) });
    const inventory = snapshot?.character?.inventory ?? [];
    const equipment = snapshot?.character?.equipment;
    const unequippedInventory = inventory.filter((item) =>
      item.questBound !== true &&
      item.id !== equipment?.weaponItemId && item.id !== equipment?.armorItemId,
    );
    const gearToEquip = inventory.filter((item) => item.equipment &&
      (item.equipment.slot === "weapon" ? equipment?.weaponItemId : equipment?.armorItemId) !== item.id);
    const readableObjects = (snapshot?.location?.objects ?? []).filter((object) => object.readable);
    const localSources = (snapshot?.dailyActivities?.sources ?? [])
      .filter((source) => source.locationId === snapshot?.location?.locationId);
    const dailyCycle = snapshot?.dailyActivities?.cycle;
    const countForSource = (sourceId: string) => snapshot?.character?.supplyCollections?.find(
      (collection) => collection.sourceId === sourceId && collection.cycle === dailyCycle,
    )?.count ?? 0;
    const bulletin = snapshot?.dailyActivities?.boards[0];
    for (const source of localSources) {
      const count = countForSource(source.id);
      actions.push({
        id: `gather-${source.id}`,
        label: `gather ${source.label} ${count}/${source.dailyLimit}`,
        ariaLabel: `Gather ${source.supply.label} at ${source.label}; ${count} of ${source.dailyLimit} collected today`,
        opensMenu: false,
        disabled: count >= source.dailyLimit,
        onSelect: () => { void performSupplyGather(source.id, source.label); },
      });
    }
    if (snapshot?.character?.staminaRecovery.posture === "resting") {
      actions.push({
        id: "stand",
        label: "stand",
        ariaLabel: "Stand and leave the resting posture",
        opensMenu: false,
        onSelect: () => submitQuickCommand("stand"),
      });
      actions.push({
        id: "help",
        label: "help",
        ariaLabel: "Show command help",
        opensMenu: false,
        onSelect: () => submitQuickCommand("help"),
      });
      return actions;
    }

    addMode("look", "look", "Show look targets");
    if (readableObjects.length > 0 || bulletin) addMode("read", "read", "Show readable objects");
    if (unequippedInventory.length > 0) addMode("drop", "drop", "Show items to drop");
    if (quickTakeableObjects.length > 0) addMode("take", "take", "Show items to take");
    if (quickUseItems.length > 0) {
      addMode("use", "use", "Show items to use");
    }
    if ((snapshot?.location?.npcs?.length ?? 0) > 0) addMode("talk", "talk", "Show people to talk to");
    if (quickShopNpcs.length > 0) addMode("shop", "shop", "Show merchants");
    if (quickBuyListings.length > 0) addMode("buy", "buy", "Show items to buy");
    if (gearToEquip.length > 0 && visibleCombat?.status !== "active") addMode("equip", "equip", "Show gear to equip");
    if ((equipment?.weaponItemId || equipment?.armorItemId) && visibleCombat?.status !== "active") {
      addMode("unequip", "unequip", "Show equipped gear to remove");
    }

    if (visibleCombat?.status === "active") {
      actions.push({
        id: "attack",
        label: "attack",
        ariaLabel: "Attack during active combat",
        opensMenu: false,
        onSelect: () => submitQuickCommand("attack"),
      });
      actions.push({
        id: "defend",
        label: "defend",
        ariaLabel: "Defend",
        opensMenu: false,
        onSelect: () => submitQuickCommand("defend"),
      });
      if (canFlee) {
        actions.push({
          id: "flee",
          label: "flee",
          ariaLabel: "Flee",
          opensMenu: false,
          onSelect: () => submitQuickCommand("flee"),
        });
      }
    } else if (challengeableNpcs.length > 0) {
      addMode("attack", "attack", "Show opponents to attack");
    }
    if (!isAnyCombatActive && !hasVisiblePvp) {
      actions.push({
        id: "rest",
        label: "rest",
        ariaLabel: "Rest and recover health, stamina, and mana",
        opensMenu: false,
        onSelect: () => submitQuickCommand("rest"),
      });
    }
    const health = snapshot?.character?.health;
    const resources = snapshot?.character?.resources;
    const needsRest = Boolean(
      (health && health.current < health.maximum) ||
      (resources && (
        resources.stamina.current < resources.stamina.maximum ||
        resources.mana.current < resources.mana.maximum
      )),
    );
    if (
      visibleCombat?.status !== "active" &&
      snapshot?.location?.inn &&
      needsRest
    ) {
      const inn = snapshot.location.inn;
      actions.push({
        id: "paid-inn-rest",
        label: `paid inn rest · ${inn.restPrice} ${inn.currency.name}${inn.restPrice === 1 ? "" : "s"}`,
        ariaLabel: `Paid immediate inn recovery at ${inn.name} for ${inn.restPrice} ${inn.currency.name}${inn.restPrice === 1 ? "" : "s"}`,
        opensMenu: false,
        onSelect: () => submitQuickCommand("inn rest"),
      });
    }
    actions.push({
      id: "help",
      label: "help",
      ariaLabel: "Show command help",
      opensMenu: false,
      onSelect: () => submitQuickCommand("help"),
    });
    return actions;
  }, [
    challengeableNpcs.length,
    hasVisiblePvp,
    isAnyCombatActive,
    quickBuyListings.length,
    quickShopNpcs.length,
    quickTakeableObjects.length,
    quickUseItems.length,
    setQuickCommandMode,
    snapshot?.character?.inventory,
    snapshot?.availableFishingSpots,
    snapshot?.availableWoodcuttingTrees,
    snapshot?.character?.equipment,
    snapshot?.location?.npcs,
    snapshot?.location?.objects,
    snapshot?.location?.inn,
    snapshot?.character?.health,
    snapshot?.character?.resources,
    snapshot?.character?.staminaRecovery.posture,
    canFlee,
    submitQuickCommand,
    visibleCombat,
    performSupplyGather,
    performFishingCast,
    pending,
  ]);
  const quickCommandPages = useMemo(() => {
    const pages: (typeof quickCommandItems)[] = [];
    for (let index = 0; index < quickCommandItems.length; index += quickCommandPageSize) {
      pages.push(quickCommandItems.slice(index, index + quickCommandPageSize));
    }
    return pages.length > 0 ? pages : [[]];
  }, [quickCommandItems, quickCommandPageSize]);
  useEffect(() => {
    const desktopQuery = window.matchMedia?.("(min-width: 700px)");
    if (!desktopQuery) {
      const updateMobileViewport = () => setIsMobileViewport(window.innerWidth < 700);
      updateMobileViewport();
      window.addEventListener("resize", updateMobileViewport);
      return () => window.removeEventListener("resize", updateMobileViewport);
    }

    const updateViewport = () => {
      const isDesktop = desktopQuery.matches;
      setQuickCommandPageSize(isDesktop ? 6 : 4);
      setIsMobileViewport(!isDesktop);
    };
    updateViewport();
    desktopQuery.addEventListener("change", updateViewport);
    return () => desktopQuery.removeEventListener("change", updateViewport);
  }, []);
  const visibleQuickCommandPage = Math.min(quickCommandPage, quickCommandPages.length);
  const visibleQuickCommandItems = quickCommandPages[visibleQuickCommandPage - 1] ?? [];
  useEffect(() => {
    if (quickCommandPage !== visibleQuickCommandPage) setQuickCommandPage(visibleQuickCommandPage);
  }, [quickCommandPage, visibleQuickCommandPage]);
  const quickReturnLabel = "Return to quick commands";

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

  const infoTabs = (
    <nav className="focused-info-tabs" aria-label="Info sections">
      {([
        { id: "vitals", label: "Vitals", href: "#/info" },
        { id: "items", label: "Items", href: "#/info/items" },
        { id: "equipment", label: "Equipment", href: "#/info/equipment" },
        { id: "stats", label: "Stats", href: "#/info/stats" },
        { id: "notes", label: "Field notes", href: "#/info/notes" },
        { id: "codex", label: "Codex", href: "#/info/codex" },
      ] as const).map((tab) => (
        <a
          key={tab.id}
          href={tab.href}
          className="focused-info-tab"
          aria-current={screen === tab.id ? "page" : undefined}
          onClick={() => setMenuOpen(false)}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );

  return (
    <main className="focused-client" data-theme={theme}>
      <section
        className={`focused-content${screen === "play" && snapshot?.location && !isGameOver ? " focused-content--play" : ""}`}
        key={screen}
        ref={contentRef}
        tabIndex={-1}
        aria-label={isGameOver ? "Game over screen" : screen === "play" ? "Play screen" : "Info screen"}
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
        {isGameOver && (
          <div className="focused-screen focused-screen--game-over" aria-label="Game over">
            <Panel className="focused-room focused-connection" eyebrow="Character lost" title="Game over">
              <Text variant="muted">Your character has died. This journey is over. Create a new character to begin again.</Text>
              <div className="focused-session-recovery-actions">
                <Button type="button" onClick={() => void handleLeaveWorld()} disabled={leaving}>Start a new character</Button>
              </div>
            </Panel>
          </div>
        )}

        {!isGameOver && screen === "play" && (
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
                <TerminalPanel
                  title={snapshot.location.title}
                  busy={pending !== null}
                  expandRequest={terminalExpandRequest}
                  mobileViewport={isMobileViewport}
                >
                    <div className="focused-room-presence" role="group" aria-label="Players in this room">
                      <Users size={14} aria-hidden="true" />
                      <span>
                        {snapshot.location.occupants.length > 0
                          ? `Here now: ${snapshot.location.occupants.map((occupant) => occupant.displayName).join(", ")}`
                          : "No other players here"}
                      </span>
                      {presenceStale && (
                        <span className="focused-room-presence__status" role="status">
                          Presence may be out of date.
                        </span>
                      )}
                    </div>
                    {snapshot.character?.health && !isAnyCombatActive && !visiblePvp && (
                      <div className="focused-terminal-vitals" role="group" aria-label="Character vitals">
                        <span className="focused-terminal-vital" role="group" aria-label="Character health" title="Health">
                          <Heart size={14} aria-hidden="true" />
                          {snapshot.character.health.current}/{snapshot.character.health.maximum}
                        </span>
                        <span className="focused-terminal-vital" role="group" aria-label="Character stamina" title="Stamina">
                          <Zap size={14} aria-hidden="true" />
                          {snapshot.character.resources.stamina.current}/{snapshot.character.resources.stamina.maximum}
                        </span>
                        <span className="focused-terminal-vital" role="group" aria-label="Character mana" title="Mana">
                          <Sparkles size={14} aria-hidden="true" />
                          {snapshot.character.resources.mana.current}/{snapshot.character.resources.mana.maximum}
                        </span>
                      </div>
                    )}
                    <div className="focused-terminal-history-shell">
                      <div
                        className="focused-terminal-history"
                        ref={terminalHistoryRef}
                        role="region"
                        aria-label="Terminal output"
                        tabIndex={0}
                        onScroll={(event) => {
                          const history = event.currentTarget;
                          const distanceFromLatest = history.scrollHeight - history.scrollTop - history.clientHeight;
                          terminalFollowsLatestRef.current = distanceFromLatest < 32;
                          setTerminalCanScrollDown(distanceFromLatest > 32);
                        }}
                      >
                        {entries.length > 0 && (
                          <ActivityLog
                            entries={entries}
                            label="Terminal transcript"
                            currentLocationId={snapshot.location?.locationId}
                            lookTargets={terminalLookTargets}
                            onLookTarget={handleTerminalLookTarget}
                            actionsDisabled={pending !== null}
                          />
                        )}
                      </div>
                      {terminalCanScrollDown && (
                        <button
                          type="button"
                          className="focused-terminal-scroll-latest"
                          onClick={scrollTerminalToLatest}
                          aria-label="Scroll to latest"
                        >
                          <ChevronDown size={14} aria-hidden="true" />
                          <span>Scroll to latest</span>
                        </button>
                      )}
                    </div>
                  {!isAnyCombatActive && !visiblePvp && activeMerchantCatalog ? (
                    <section className="focused-merchant-catalog" aria-label={`${activeMerchantCatalog.merchantName} shop catalog`}>
                      <div className="focused-merchant-catalog__header">
                        <div>
                          <strong>{activeMerchantCatalog.merchantName}</strong>
                          <span>
                            Balance: {activeMerchantCatalog.currency.balance} {activeMerchantCatalog.currency.name}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="focused-merchant-catalog__close"
                          onClick={() => setActiveMerchantCatalog(null)}
                          aria-label="Close merchant catalog"
                          disabled={pending !== null}
                        >
                          ×
                        </button>
                      </div>
                      <div className="focused-merchant-catalog__list">
                        {activeMerchantCatalog.listings.map((listing) => {
                          const cannotAfford = activeMerchantCatalog.currency.balance < listing.price;
                          return (
                            <article className="focused-merchant-catalog__item" key={listing.id}>
                              <div>
                                <strong>{listing.item.label}</strong>
                                <span>{listing.item.description}</span>
                              </div>
                              <button
                                type="button"
                                className="focused-quick-command"
                                onClick={() => void purchaseMerchantListing(listing.id, true)}
                                disabled={pending !== null || listing.purchased || cannotAfford}
                                aria-label={`${listing.purchased ? "Purchased" : cannotAfford ? "Cannot afford" : "Buy"} ${listing.item.label} for ${listing.price} ${activeMerchantCatalog.currency.name}`}
                              >
                                {listing.purchased
                                  ? "Bought"
                                  : `${listing.price} ${activeMerchantCatalog.currency.symbol}`}
                              </button>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  ) : null}
                  {!dialogueModalOpen && !isAnyCombatActive && !visiblePvp && activeDialogue?.choices.length ? (
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
                  {visiblePvp ? (
                    <section className="focused-terminal-combat" aria-label="Player combat">
                      <div className="focused-terminal-combat__status" role="status" aria-live="polite">
                        <strong>Round {visiblePvp.round} · Duel</strong>
                        {visiblePvp.participants.map((participant) => (
                          <span key={participant.characterId}>
                            {participant.name} {participant.health}/{participant.maximumHealth}
                          </span>
                        ))}
                        <span>{visiblePvp.lastNarration}</span>
                      </div>
                      {visiblePvp.status === "active" ? (
                        isPvpTurn ? (
                          <>
                          <div className="focused-terminal-combat__actions" role="group" aria-label="Player combat actions">
                            <button type="button" className="focused-quick-command focused-combat-action" onClick={() => void performPvpAction("attack")} disabled={pending !== null}>attack</button>
                            <button type="button" className="focused-quick-command focused-combat-action" onClick={() => void performPvpAction("defend")} disabled={pending !== null}>defend</button>
                            {quickInventory.some((item) =>
                              item.consumable?.effect === "heal" &&
                              item.id !== snapshot.character?.equipment.weaponItemId &&
                              item.id !== snapshot.character?.equipment.armorItemId &&
                              (visiblePvp.participants.find((participant) => participant.characterId === snapshot.character?.characterId)?.health ?? 0) < (visiblePvp.participants.find((participant) => participant.characterId === snapshot.character?.characterId)?.maximumHealth ?? 0)
                            ) && (
                              <div className="focused-terminal-combat__items">
                                {quickInventory.filter((item) => item.consumable?.effect === "heal").map((item) => (
                                  <button key={item.id} type="button" className="focused-quick-command focused-combat-action" onClick={() => void performPvpAction("use-item", item.id)} disabled={pending !== null}>
                                    use {item.label}
                                  </button>
                                ))}
                              </div>
                            )}
                            <button type="button" className="focused-quick-command focused-combat-action" onClick={() => void performPvpAction("flee")} disabled={pending !== null}>flee</button>
                          </div>
                          <ClassAbilityList actions={availableClassActions} onUse={(abilityId) => void performClassAbility(abilityId)} disabled={pending !== null} label="Duel class abilities" />
                          </>
                        ) : <span role="status">Waiting for the other player’s turn.</span>
                      ) : <span role="status">Saving combat outcomes…</span>}
                    </section>
                  ) : activeTeamCombat ? (
                    <section className="focused-terminal-combat" aria-label="Cooperative combat">
                      <div className="focused-terminal-combat__status" role="status" aria-live="polite">
                        <strong>Round {activeTeamCombat.round} · Cooperative encounter</strong>
                        <span>{activeTeamCombat.participants.map((participant) =>
                          `${participant.displayName} ${participant.health}/${participant.maximumHealth}`,
                        ).join(" · ")}</span>
                        <span>{activeTeamCombat.lastNarration}</span>
                      </div>
                      {isTeamCombatTurn ? (
                        <>
                        <div className="focused-terminal-combat__actions" role="group" aria-label="Cooperative combat actions">
                          <button type="button" className="focused-quick-command focused-combat-action" onClick={() => void performCombatAction("attack", undefined, true)} disabled={pending !== null}>attack</button>
                          <button type="button" className="focused-quick-command focused-combat-action" onClick={() => void performCombatAction("defend", undefined, true)} disabled={pending !== null}>defend</button>
                          {quickUseItems.some((item) => item.consumable?.effect === "heal") ? (
                            <button type="button" className="focused-quick-command focused-combat-action" aria-expanded={combatUseMenuOpen} onClick={() => setCombatUseMenuOpen((open) => !open)} disabled={pending !== null}>use</button>
                          ) : null}
                          <button type="button" className="focused-quick-command focused-combat-action" onClick={() => void performCombatAction("flee", undefined, true)} disabled={pending !== null || !canFlee} title={canFlee ? undefined : `Need ${FLEE_STAMINA_COST} stamina to flee`}>flee</button>
                        </div>
                        <ClassAbilityList actions={availableClassActions} onUse={(abilityId) => void performClassAbility(abilityId)} disabled={pending !== null} label="Cooperative class abilities" />
                        </>
                      ) : <span role="status">Waiting for your party’s turn.</span>}
                      {combatUseMenuOpen && isTeamCombatTurn ? (
                        <div className="focused-terminal-combat__items" role="group" aria-label="Items available during cooperative combat">
                          {quickUseItems.filter((item) => item.consumable?.effect === "heal").map((item) => (
                            <button key={item.id} type="button" className="focused-quick-command focused-combat-action" onClick={() => {
                              setCombatUseMenuOpen(false);
                              void performCombatAction("use-item", undefined, true, item.id);
                            }} disabled={pending !== null}>
                              {item.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </section>
                  ) : visibleCombat?.status === "active" ? (
                    <section className="focused-terminal-combat" aria-label="Combat">
                      <div className="focused-terminal-combat__status" role="status" aria-live="polite">
                        <strong>Round {visibleCombat.round} · {visibleCombat.opponentName}</strong>
                        <span>You {visibleCombat.playerHealth}/{visibleCombat.playerMaxHealth} · {visibleCombat.opponentName} {visibleCombat.opponentHealth}/{visibleCombat.opponentMaxHealth}</span>
                      </div>
                      <div className="focused-terminal-combat__actions" role="group" aria-label="Combat actions">
                        <button
                          type="button"
                          className="focused-quick-command focused-combat-action"
                          aria-label="Attack during active combat"
                          onClick={() => void performCombatAction("attack", undefined, true)}
                          disabled={pending !== null}
                        >
                          attack
                        </button>
                        <button
                          type="button"
                          className="focused-quick-command focused-combat-action"
                          aria-label="Defend during active combat"
                          onClick={() => void performCombatAction("defend", undefined, true)}
                          disabled={pending !== null}
                        >
                          defend
                        </button>
                        {quickUseItems.some((item) => item.consumable?.effect === "heal") ? (
                          <button
                            type="button"
                            className="focused-quick-command focused-combat-action"
                            aria-expanded={combatUseMenuOpen}
                            aria-controls="combat-usable-items"
                            onClick={() => setCombatUseMenuOpen((open) => !open)}
                            disabled={pending !== null}
                          >
                            use
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="focused-quick-command focused-combat-action"
                          aria-label="Flee from combat"
                          onClick={() => void performCombatAction("flee", undefined, true)}
                          disabled={pending !== null || !canFlee}
                          title={canFlee ? undefined : `Need ${FLEE_STAMINA_COST} stamina to flee`}
                        >
                          flee
                        </button>
                      </div>
                      <ClassAbilityList actions={availableClassActions} onUse={(abilityId) => void performClassAbility(abilityId)} disabled={pending !== null} label="Combat class abilities" />
                      {combatUseMenuOpen ? (
                        <div
                          id="combat-usable-items"
                          className="focused-terminal-combat__items"
                          role="group"
                          aria-label="Items available to use during combat"
                        >
                          {quickUseItems
                            .filter((item) => item.consumable?.effect === "heal")
                            .map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                className="focused-quick-command focused-combat-action"
                                aria-label={`Use ${item.label} during combat`}
                                onClick={() => {
                                  setCombatUseMenuOpen(false);
                                  void performCombatAction("use-item", undefined, true, item.id);
                                }}
                                disabled={pending !== null}
                              >
                                {item.label}
                              </button>
                            ))}
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                  {!isAnyCombatActive && !visiblePvp && (
                    <NavigationControls
                      exits={exits}
                      onMove={(exitId) => void move(exitId)}
                      onAmbiguousDirection={() => {
                        setQuickCommandPage(1);
                        setQuickCommandMode("choose-exit");
                      }}
                      disabled={!snapshot.character || pending !== null || snapshot.character.staminaRecovery.posture === "resting"}
                    />
                  )}
                  {!isAnyCombatActive && !visiblePvp && <section className="focused-quick-commands" aria-label="Quick commands">
                    {quickCommandMode !== "quick" && (
                      <span className="focused-quick-commands__label" aria-hidden="true">
                        {quickCommandMode === "choose-exit" ? "Choose destination"
                          : quickCommandMode === "look" ? "Look"
                            : quickCommandMode === "read" ? "Read"
                              : quickCommandMode === "drop" ? "Drop"
                                : quickCommandMode === "take" ? "Take"
                                  : quickCommandMode === "attack" ? "Attack"
                                  : quickCommandMode === "equip" ? "Equip"
                                    : quickCommandMode === "unequip" ? "Unequip"
                                    : quickCommandMode === "shop" ? "Shop"
                                      : quickCommandMode === "buy" ? "Buy"
                                        : quickCommandMode === "use" || quickCommandMode === "use-target" ? "Use" : "Talk"}
                      </span>
                    )}
                    <div
                      className="focused-quick-commands__actions"
                      role="group"
                      aria-label={
                        quickCommandMode === "quick"
                          ? `Quick commands, page ${visibleQuickCommandPage}`
                          : quickCommandMode === "choose-exit" ? "Choose a destination"
                            : quickCommandMode === "look" ? "Things to look at"
                              : quickCommandMode === "read" ? "Readable objects"
                                : quickCommandMode === "drop" ? "Items to drop"
                                : quickCommandMode === "talk" ? "People here"
                                  : quickCommandMode === "attack" ? "Available opponents"
                                : quickCommandMode === "equip" ? "Gear to equip"
                                  : quickCommandMode === "unequip" ? "Equipped gear"
                                    : quickCommandMode === "shop" ? "Merchants here"
                                      : quickCommandMode === "buy" ? "Items to buy"
                                        : quickCommandMode === "use" ? "Items to use"
                                          : quickCommandMode === "use-target" ? "Use target" : "Items to take"
                      }
                    >
                      {quickCommandMode === "equip" ? (
                        <>
                          <button type="button" className="focused-quick-command focused-quick-command--back" onClick={() => setQuickCommandMode("quick")} aria-label={quickReturnLabel} disabled={pending !== null}>‹</button>
                          {(snapshot.character?.inventory ?? []).filter((item) => item.equipment && (
                            item.equipment.slot === "weapon"
                              ? snapshot.character?.equipment.weaponItemId !== item.id
                              : snapshot.character?.equipment.armorItemId !== item.id
                          )).map((item) => (
                            <button key={item.id} type="button" className="focused-quick-command" onClick={() => submitQuickCommand(`equip ${item.label}`)} aria-label={`Equip ${item.label}`} disabled={pending !== null}>{item.label.toLocaleLowerCase()}</button>
                          ))}
                        </>
                      ) : quickCommandMode === "unequip" ? (
                        <>
                          <button type="button" className="focused-quick-command focused-quick-command--back" onClick={() => setQuickCommandMode("quick")} aria-label={quickReturnLabel} disabled={pending !== null}>‹</button>
                          {(["weapon", "armor"] as const).filter((slot) => slot === "weapon"
                            ? snapshot.character?.equipment.weaponItemId
                            : snapshot.character?.equipment.armorItemId).map((slot) => (
                            <button key={slot} type="button" className="focused-quick-command" onClick={() => submitQuickCommand(`unequip ${slot}`)} aria-label={`Unequip ${slot}`} disabled={pending !== null}>{slot}</button>
                          ))}
                        </>
                      ) : quickCommandMode === "choose-exit" ? (
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
                              aria-label={direction.label}
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
                          {snapshot?.dailyActivities?.boards[0] ||
                          (snapshot?.location?.objects ?? []).some((object) => object.readable) ? (
                            <>
                              {snapshot?.dailyActivities?.boards[0] && (
                                <button
                                  key={snapshot.dailyActivities.boards[0].id}
                                  type="button"
                                  className="focused-quick-command"
                                  onClick={() => submitQuickCommand("read bulletin")}
                                  aria-label={`Read ${snapshot.dailyActivities.boards[0].name}`}
                                  disabled={pending !== null}
                                >
                                  bulletin
                                </button>
                              )}
                              {(snapshot?.location?.objects ?? []).filter((object) => object.readable).map((object) => (
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
                              ))}
                            </>
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
                          {(snapshot.character?.inventory ?? []).filter((item) =>
                            item.questBound !== true &&
                            item.id !== snapshot.character?.equipment.weaponItemId &&
                            item.id !== snapshot.character?.equipment.armorItemId,
                          ).length ? (
                            (snapshot.character?.inventory ?? []).filter((item) =>
                              item.questBound !== true &&
                              item.id !== snapshot.character?.equipment.weaponItemId &&
                              item.id !== snapshot.character?.equipment.armorItemId,
                            ).map((item) => (
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
                      ) : quickCommandMode === "use" ? (
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
                          {quickUseItems.length ? (
                            quickUseItems.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                className="focused-quick-command"
                                onClick={() => {
                                  if (item.fishingRod) {
                                    void performFishingCast(item.id);
                                  } else if (item.woodcuttingAxe) {
                                    const tree = snapshot?.availableWoodcuttingTrees?.[0];
                                    if (tree) void performWoodcuttingStart(item.id, tree.id);
                                  } else if (item.consumable?.effect === "heal") {
                                    submitQuickCommand(`use ${item.label}`);
                                  } else {
                                    setQuickUseItemId(item.id);
                                    setQuickCommandMode("use-target");
                                  }
                                }}
                                aria-label={item.fishingRod
                                  ? `Use ${item.label} to fish at ${snapshot?.availableFishingSpots?.[0]?.label ?? "this spot"}`
                                  : item.woodcuttingAxe
                                    ? `Use ${item.label} to chop ${snapshot?.availableWoodcuttingTrees?.[0]?.label ?? "a tree"}`
                                  : item.consumable?.effect === "heal"
                                    ? `Use ${item.label}${isAnyCombatActive ? " during combat" : ""}`
                                    : `Choose ${item.label} to use`}
                                disabled={pending !== null}
                              >
                                {item.label.toLocaleLowerCase()}
                              </button>
                            ))
                          ) : <span className="focused-quick-commands__empty">
                            Nothing to use
                          </span>}
                        </>
                      ) : quickCommandMode === "use-target" ? (
                        <>
                          <button
                            type="button"
                            className="focused-quick-command focused-quick-command--back"
                            onClick={() => setQuickCommandMode("use")}
                            aria-label="Return to items to use"
                            disabled={pending !== null}
                          >
                            ‹
                          </button>
                          {(() => {
                            const item = snapshot.character?.inventory.find((candidate) => candidate.id === quickUseItemId);
                            const targets = (snapshot.location.objects ?? []).filter((object) => !object.readable && !object.takeable);
                            return item && targets.length ? targets.map((target) => (
                              <button
                                key={target.id}
                                type="button"
                                className="focused-quick-command"
                                onClick={() => submitQuickCommand(`use ${item.label} on ${target.label}`)}
                                aria-label={`Use ${item.label} on ${target.label}`}
                                disabled={pending !== null}
                              >
                                {target.label.toLocaleLowerCase()}
                              </button>
                            )) : <span className="focused-quick-commands__empty">
                              {item ? "No usable targets here" : "Choose an item to use"}
                            </span>;
                          })()}
                        </>
                      ) : quickCommandMode === "attack" ? (
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
                          {challengeableNpcs.length ? challengeableNpcs.map((npc) => (
                            <button
                              key={npc.id}
                              type="button"
                              className="focused-quick-command"
                              onClick={() => submitQuickCommand(`attack ${npc.name}`)}
                              aria-label={`Attack ${npc.name}`}
                              disabled={pending !== null}
                            >
                              {npc.name}
                            </button>
                          )) : <span className="focused-quick-commands__empty">No available opponents</span>}
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
                      ) : quickCommandMode === "shop" ? (
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
                          {quickShopNpcs.length ? quickShopNpcs.map((npc) => (
                            <button
                              key={npc.id}
                              type="button"
                              className="focused-quick-command"
                              onClick={() => submitQuickCommand(`shop ${npc.name}`)}
                              aria-label={`Shop with ${npc.name}`}
                              disabled={pending !== null}
                            >
                              {npc.name}
                            </button>
                          )) : <span className="focused-quick-commands__empty">No merchants here</span>}
                        </>
                      ) : quickCommandMode === "buy" ? (
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
                          {activeMerchantCatalog ? (
                            quickBuyListings.length ? quickBuyListings.map((listing) => (
                              <button
                                key={listing.id}
                                type="button"
                                className="focused-quick-command"
                                onClick={() => submitQuickCommand(`buy ${listing.item.label}`)}
                                aria-label={`Buy ${listing.item.label}`}
                                disabled={pending !== null}
                              >
                                {listing.item.label}
                              </button>
                            )) : <span className="focused-quick-commands__empty">Nothing left to buy</span>
                          ) : (
                            <>
                              <span className="focused-quick-commands__empty">Open a merchant catalog first</span>
                              <button
                                type="button"
                                className="focused-quick-command"
                                onClick={() => setQuickCommandMode("shop")}
                                disabled={pending !== null}
                              >
                                shop <span aria-hidden="true">›</span>
                              </button>
                            </>
                          )}
                        </>
                      ) : quickCommandMode === "quick" ? (
                        <>
                          {visibleQuickCommandPage > 1 && (
                            <button
                              type="button"
                              className="focused-quick-command focused-quick-command--back"
                              onClick={() => setQuickCommandPage(visibleQuickCommandPage - 1)}
                              aria-label={`Show quick actions page ${visibleQuickCommandPage - 1}`}
                              disabled={pending !== null}
                            >
                              ‹
                            </button>
                          )}
                          {visibleQuickCommandItems.map((action) => (
                            <button
                              key={action.id}
                              type="button"
                              className="focused-quick-command"
                              onClick={action.onSelect}
                              aria-label={action.ariaLabel}
                              disabled={pending !== null || action.disabled}
                            >
                              {action.label}{action.opensMenu && <span aria-hidden="true"> ›</span>}
                            </button>
                          ))}
                          {visibleQuickCommandPage < quickCommandPages.length && (
                            <button
                              type="button"
                              className="focused-quick-command focused-quick-command--next"
                              onClick={() => setQuickCommandPage(visibleQuickCommandPage + 1)}
                              aria-label={`Show quick actions page ${visibleQuickCommandPage + 1}`}
                              disabled={pending !== null}
                            >
                              ›
                            </button>
                          )}
                        </>
                      ) : null}
                    </div>
                  </section>}
                  {(displayedDailyBoard || dailyBoardLoading || dailyBoardError) && (
                    <DailyBoard
                      name={displayedDailyBoard?.name ?? snapshot?.dailyActivities?.boards[0]?.name ?? "Daily bulletin"}
                      cycle={displayedDailyBoard?.cycle ?? snapshot?.dailyActivities?.cycle ?? "today"}
                      resetsAt={displayedDailyBoard?.resetsAt}
                      jobs={(displayedDailyBoard?.jobs ?? []).map((job) => ({
                        ...job,
                        supplyLabel: snapshot.dailyActivities?.sources.find(
                          (source) => source.supply.typeId === job.supplyTypeId,
                        )?.supply.label,
                      }))}
                      pendingJobId={pendingDailyJobId}
                      busy={pending !== null}
                      loading={dailyBoardLoading}
                      error={dailyBoardError || undefined}
                      onRetry={() => {
                        const boardId = displayedDailyBoard?.boardId ?? snapshot?.dailyActivities?.boards[0]?.id;
                        if (boardId) void fetchDailyBoard(boardId).catch(() => undefined);
                      }}
                      onClose={closeDailyBoard}
                      onAccept={(jobId) => handleDailyJobAction(jobId, "accept")}
                      onDeliver={(jobId) => handleDailyJobAction(jobId, "deliver")}
                    />
                  )}
                  {activeInteractionTarget && (
                    <InteractionOptionsDialog
                      targetLabel={activeInteractionTarget.label}
                      options={activeInteractionTarget.actions ?? [{ id: "look", label: "Look" }]}
                      busy={pending !== null}
                      onSelect={(actionId) => performTerminalTargetAction(activeInteractionTarget, actionId)}
                      onClose={() => setActiveInteractionTarget(null)}
                    />
                  )}
                  {dialogueModalOpen && activeDialogue ? (
                    <NpcDialogueDialog
                      npcName={activeDialogue.npcName}
                      dialogue={activeDialogue.text}
                      choices={activeDialogue.choices}
                      busy={pending === "talk"}
                      onSelect={(choiceId) => void chooseDialogueReply(choiceId)}
                      onClose={() => setDialogueModalOpen(false)}
                    />
                  ) : null}
                  {isMobileViewport && (
                    <RoomChatPanel
                      realtimeClient={client}
                      actionPending={Boolean(pending)}
                      worldInstanceId={worldInstanceId}
                      roomId={snapshot.location.locationId}
                      fullscreen={chatFullscreen}
                      onFullscreenChange={handleChatFullscreenChange}
                      onTerminalEvent={addNpcTerminalEvent}
                      embedded
                    />
                  )}
                  {!isAnyCombatActive && !visiblePvp && <section
                    className={`focused-command ${mobileCommandInputOpen ? "focused-command--mobile-open" : "focused-command--mobile-hidden"}`}
                    aria-label="Text command"
                  >
                    <form className="focused-command-form" onSubmit={submitCommand}>
                      <TextInput
                        id="focused-world-command"
                        label="Enter a command"
                        placeholder="Type a command"
                        value={command}
                        onChange={(event) => setCommand(event.target.value)}
                        disabled={pending !== null}
                        autoComplete="off"
                        enterKeyHint="send"
                        spellCheck={false}
                      />
                      <Button type="submit" variant="secondary" disabled={!command.trim() || pending !== null}>
                        {pending === "look" ? "Looking" : pending === "read" ? "Reading" : pending === "take" ? "Taking" : pending === "drop" ? "Dropping" : pending === "move" ? "Moving" : pending === "talk" ? "Talking" : pending === "shop" ? "Browsing" : pending === "buy" ? "Buying" : pending === "combat" ? "Acting" : pending === "rest" ? "Resting" : pending === "equip" ? "Changing gear" : pending === "daily" ? "Updating jobs" : pending === "gather" ? "Gathering" : "Send"}
                      </Button>
                    </form>
                  </section>}
                </TerminalPanel>
                {!isMobileViewport && (
                  <RoomChatPanel
                    realtimeClient={client}
                    actionPending={Boolean(pending)}
                    worldInstanceId={worldInstanceId}
                    roomId={snapshot.location.locationId}
                    fullscreen={chatFullscreen}
                    onFullscreenChange={handleChatFullscreenChange}
                    onTerminalEvent={addNpcTerminalEvent}
                  />
                )}
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

          </div>
        )}

        {!isGameOver && screen === "vitals" && (
          <div className="focused-screen" aria-label="Vitals">
            {infoTabs}
            <div className="focused-screen-heading">
              <div><div className="focused-kicker">Character</div><h1 className="focused-screen-title">Vitals</h1></div>
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
                <div className="focused-vitals">
                  {[
                    { label: "Health", resource: snapshot.character?.health },
                    { label: "Stamina", resource: snapshot.character?.resources.stamina },
                    { label: "Mana", resource: snapshot.character?.resources.mana },
                  ].map(({ label, resource }) => (
                    <div className="focused-vital" key={label}>
                      <div className="focused-vital-heading">
                        <span>{label}</span>
                        <strong>{resource ? `${resource.current}/${resource.maximum}` : "Unavailable"}</strong>
                      </div>
                      {resource && (
                        <div
                          className="focused-vital-meter"
                          role="meter"
                          aria-label={`Character ${label.toLocaleLowerCase()}`}
                          aria-valuemin={0}
                          aria-valuemax={resource.maximum}
                          aria-valuenow={resource.current}
                        >
                          <span style={{
                            width: `${Math.max(0, Math.min(100, (resource.current / resource.maximum) * 100))}%`,
                          }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="focused-details">
                  <div className="focused-detail"><span>Posture</span><strong>{snapshot.character?.staminaRecovery.posture === "resting" ? "Resting · 6% of each vital every two seconds" : "Standing · 2% of each vital every two seconds"}</strong></div>
                  <div className="focused-detail"><span>Standing</span><strong>{snapshot.character?.health?.current === 0 ? "Down" : snapshot.character ? "Alive" : "Not started"}</strong></div>
                  <div className="focused-detail"><span>Wallet</span><strong>
                    {snapshot.character?.wallet && snapshot.currency
                      ? `${snapshot.character.wallet.balance} ${snapshot.currency.name}${snapshot.character.wallet.balance === 1 ? "" : "s"}`
                      : "—"}
                  </strong></div>
                  <div className="focused-detail focused-detail--wide"><span>Current location</span><strong>{snapshot.location?.title || "—"}</strong></div>
                  <div className="focused-detail focused-detail--wide">
                    <span>Advancement</span>
                    <strong>
                      {snapshot.character?.advancement
                        ? `Level ${snapshot.character.advancement.level} · ${snapshot.character.advancement.experience} XP`
                        : "No combat victories yet"}
                    </strong>
                  </div>
                </div>
                {snapshot.character && !snapshot.character.health && <p className="focused-note">Health has not been initialized for this character yet.</p>}
                {!snapshot.character && <p className="focused-note">Begin from Play to enter the world.</p>}
              </Panel>
            ) : (
               <Panel className="focused-card"><Text variant="muted">{loading ? "Traveler details are loading." : "Traveler details are unavailable."}</Text></Panel>
            )}
          </div>
        )}

        {!isGameOver && (screen === "items" || screen === "equipment") && (
          <div className="focused-screen" aria-label={screen === "items" ? "Items" : "Equipment"}>
            {infoTabs}
            <div className="focused-screen-heading">
              <div><div className="focused-kicker">Character inventory</div><h1 className="focused-screen-title">{screen === "items" ? "Items" : "Equipment"}</h1></div>
            </div>
            {snapshot ? (
              <Panel className="focused-card">
                {screen === "equipment" ? (
                  <div className="focused-details">
                    <div className="focused-detail focused-detail--wide">
                      <span>Equipped</span>
                      <div className="focused-equipment">
                        {(["weapon", "armor"] as const).map((slot) => {
                          const itemId = slot === "weapon"
                            ? snapshot.character?.equipment.weaponItemId
                            : snapshot.character?.equipment.armorItemId;
                          const item = snapshot.character?.inventory.find((candidate) => candidate.id === itemId);
                          return (
                            <div className="focused-equipment-slot" key={slot}>
                              <span>{slot}</span>
                              <strong>{item?.label ?? "None"}</strong>
                              {item && (
                                <button type="button" className="focused-inventory-item" aria-label={`Unequip ${slot}`} disabled={pending !== null || isAnyCombatActive} onClick={() => void changeEquipment("unequip", slot)}>
                                  Unequip
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="focused-detail focused-detail--wide">
                      <span>Available gear</span>
                      {snapshot.character?.inventory.some((item) => item.equipment) ? (
                        <div className="focused-inventory">
                          {snapshot.character.inventory.filter((item) => item.equipment).map((item) => {
                            const slotKey = item.equipment?.slot === "weapon" ? "weaponItemId" : "armorItemId";
                            const isEquipped = snapshot.character?.equipment[slotKey] === item.id;
                            return (
                              <div className="focused-inventory-entry" key={item.id}>
                                <span className="focused-inventory-label">{item.label}</span>
                                <button
                                  type="button"
                                  className="focused-inventory-item"
                                  aria-label={`${isEquipped ? "Equipped" : "Equip"} ${item.label}`}
                                  disabled={pending !== null || isAnyCombatActive || isEquipped}
                                  onClick={() => void changeEquipment("equip", item.id)}
                                >
                                  {isEquipped ? "Equipped" : `Equip ${item.equipment?.slot}`}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      ) : <strong>None</strong>}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="focused-detail focused-detail--wide">
                      <span>Carried items</span>
                      {snapshot.character?.inventory.length ? (
                        <div className="focused-inventory">
                          {snapshot.character.inventory.map((item) => (
                            <div className="focused-inventory-entry" key={item.id}>
                              <button
                                type="button"
                                className="focused-inventory-item"
                                aria-label={`Inspect ${item.label}${item.stackable && (item.quantity ?? 1) > 1 ? ` quantity ${item.quantity}` : ""}`}
                                disabled={pending !== null}
                                onClick={() => void inspectCarriedItem(item)}
                              >
                                {item.label}{item.stackable && (item.quantity ?? 1) > 1 ? ` ×${item.quantity}` : ""}
                              </button>
                              {item.equipment && (
                                <span className="focused-item-tag">
                                  {snapshot.character?.equipment[item.equipment.slot === "weapon" ? "weaponItemId" : "armorItemId"] === item.id ? "Equipped" : item.equipment.slot}
                                </span>
                              )}
                            </div>
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
                    {!snapshot.character && <p className="focused-note">Begin from Play to enter the world.</p>}
                  </>
                )}
              </Panel>
            ) : (
              <Panel className="focused-card"><Text variant="muted">{loading ? "Character details are loading." : "Character details are unavailable."}</Text></Panel>
            )}
          </div>
        )}

        {!isGameOver && screen === "stats" && (
          <div className="focused-screen" aria-label="Stats">
            {infoTabs}
            <div className="focused-screen-heading">
              <div><div className="focused-kicker">Character progression</div><h1 className="focused-screen-title">Stats</h1></div>
            </div>
            {snapshot ? (
              <Panel className="focused-card">
                <div className="focused-identity focused-stats-identity">
                  <span className="focused-avatar" aria-hidden="true">{(snapshot.character?.name || snapshot.player.displayName).trim().charAt(0).toUpperCase() || "G"}</span>
                  <div>
                    <h2 className="focused-identity-name">{snapshot.character?.name || "Guest"}</h2>
                    <p className="focused-identity-label">
                      {`Level ${snapshot.character?.advancement?.level ?? 1}`}
                    </p>
                  </div>
                </div>
                {currentCharacterClass ? (
                  <section className="focused-stat-section" aria-labelledby="character-class-title">
                    <h2 id="character-class-title">Class · {currentCharacterClass.label}</h2>
                    <p className="focused-note">{currentCharacterClass.description}</p>
                    <div className="focused-detail focused-detail--wide">
                      <span>Starting action</span>
                      <strong>{currentCharacterClass.coreAction.label}</strong>
                      <p>{currentCharacterClass.coreAction.description}</p>
                    </div>
                  </section>
                ) : classCatalogError ? <p role="alert" className="focused-note">{classCatalogError}</p> : !isAnyCombatActive && !visiblePvp && classCatalog?.classes.length ? (
                  <section className="focused-stat-section" aria-labelledby="class-adoption-title">
                    <h2 id="class-adoption-title">Choose your class</h2>
                    <p className="focused-note">This character predates class choices. You may adopt one class once, while outside combat. This choice is permanent.</p>
                    <ClassChoice
                      classes={classCatalog.classes}
                      value={classChoiceId || undefined}
                      onChange={(nextClassId) => {
                        setClassChoiceId(nextClassId);
                        setConfirmClassAdoption(false);
                      }}
                      disabled={pending !== null}
                      name="legacy-class-adoption"
                    />
                    {confirmClassAdoption && (
                      <p className="focused-note" role="status">
                        Confirm this class for {snapshot.character?.name ?? "your character"}. It cannot be changed later.
                      </p>
                    )}
                    <Button
                      type="button"
                      disabled={!classChoiceId || pending !== null}
                      onClick={() => void adoptCharacterClass()}
                    >
                      {pending === "combat" ? "Saving…" : confirmClassAdoption ? "Confirm permanent choice" : "Adopt this class"}
                    </Button>
                  </section>
                ) : null}
                <section className="focused-stat-section" aria-labelledby="primary-stats-title">
                  <h2 id="primary-stats-title">Stats</h2>
                  <div className="focused-stat-grid">
                    <div className="focused-stat"><span>Strength</span><strong>{snapshot.stats?.attributes.strength ?? "—"}</strong></div>
                    <div className="focused-stat"><span>Intelligence</span><strong>{snapshot.stats?.attributes.intelligence ?? "—"}</strong></div>
                    <div className="focused-stat"><span>Constitution</span><strong>{snapshot.stats?.attributes.constitution ?? "—"}</strong></div>
                    <div className="focused-stat"><span>Dexterity</span><strong>{snapshot.stats?.attributes.dexterity ?? "—"}</strong></div>
                  </div>
                </section>
                <section className="focused-stat-section" aria-labelledby="skills-title">
                  <h2 id="skills-title">Skills</h2>
                  <div className="focused-stat-grid">
                    <div className="focused-stat">
                      <span>Woodcutting</span>
                      <strong>
                        Level {snapshot.character?.woodcutting?.level ?? 1} · {snapshot.character?.woodcutting?.experience ?? 0} XP
                      </strong>
                    </div>
                  </div>
                </section>
                <section className="focused-stat-section" aria-labelledby="derived-stats-title">
                  <h2 id="derived-stats-title">Attributes</h2>
                  <div className="focused-stat-grid">
                    <div className="focused-stat"><span>Attack Power</span><strong>{snapshot.stats?.attackPower ?? "—"}</strong></div>
                    <div className="focused-stat"><span>Spell Power</span><strong>{snapshot.stats?.spellPower ?? "—"}</strong></div>
                    <div className="focused-stat"><span>Damage</span><strong>{snapshot.stats?.damage ?? "—"}</strong></div>
                    <div className="focused-stat"><span>Crit Chance</span><strong>{snapshot.stats ? `${snapshot.stats.critChancePercent.toFixed(1)}%` : "—"}</strong></div>
                    <div className="focused-stat"><span>Health Regen</span><strong>{snapshot.stats?.healthRegen ?? "—"}</strong></div>
                    <div className="focused-stat"><span>Mana Regen</span><strong>{snapshot.stats?.manaRegen ?? "—"}</strong></div>
                    <div className="focused-stat"><span>Stamina Regen</span><strong>{snapshot.stats?.staminaRegen ?? "—"}</strong></div>
                    <div className="focused-stat"><span>Armor</span><strong>{snapshot.stats ? `${snapshot.stats.armorPercent.toFixed(1)}%` : "—"}</strong></div>
                    <div className="focused-stat"><span>Resilience</span><strong>{snapshot.stats ? `${snapshot.stats.resiliencePercent.toFixed(1)}%` : "—"}</strong></div>
                    <div className="focused-stat"><span>Dodge</span><strong>{snapshot.stats ? `${snapshot.stats.dodgePercent.toFixed(1)}%` : "—"}</strong></div>
                  </div>
                </section>
                <section className="focused-stat-section" aria-labelledby="other-stats-title">
                  <h2 id="other-stats-title">Other</h2>
                  <div className="focused-stat-grid">
                    <div className="focused-stat"><span>Exp</span><strong>{snapshot.character?.advancement?.experience ?? 0}</strong></div>
                    <div className="focused-stat"><span>{snapshot.currency?.name ?? "Gold"}</span><strong>{snapshot.character?.wallet?.balance ?? 0}</strong></div>
                    <div className="focused-stat"><span>Glory</span><strong>{snapshot.character?.honors?.glory ?? 0}</strong></div>
                    <div className="focused-stat"><span>Medals</span><strong>{snapshot.character?.honors?.medals ?? 0}</strong></div>
                  </div>
                </section>
                <p className="focused-note">Strength, Constitution, weapons, and armor affect current combat. Spell power, regeneration, critical, avoidance, Glory, and Medals are tracked for future systems.</p>
                {!snapshot.character && <p className="focused-note">Begin from Play to enter the world.</p>}
              </Panel>
            ) : (
              <Panel className="focused-card"><Text variant="muted">{loading ? "Character details are loading." : "Character details are unavailable."}</Text></Panel>
            )}
          </div>
        )}

        {!isGameOver && screen === "notes" && (
          <div className="focused-screen" aria-label="Field notes">
            {infoTabs}
            <div className="focused-screen-heading">
              <div><div className="focused-kicker">Progress and session history</div><h1 className="focused-screen-title">Field notes</h1></div>
              <span className="focused-coordinate">{entries.length} {entries.length === 1 ? "entry" : "entries"}</span>
            </div>
            <div className="focused-notes-layout">
              <section className="focused-quest-journal" aria-labelledby="quest-journal-title">
                <h2 id="quest-journal-title">Quest journal</h2>
                {(["active", "completed"] as const).map((status) => {
                  const quests = snapshot?.questJournal?.filter((quest) => quest.status === status) ?? [];
                  const heading = status === "active" ? "Current quests" : "Completed quests";
                  const emptyMessage = status === "active" ? "No current quests." : "No completed quests yet.";
                  const collapsed = collapsedQuestGroups[status];
                  return (
                    <div className="focused-quest-group" key={status}>
                      <h3 className="focused-quest-group-title">
                        <DisclosureButton
                          controls={`quest-group-${status}`}
                          expanded={!collapsed}
                          className="focused-quest-group-toggle"
                          onClick={() => setCollapsedQuestGroups((current) => ({ ...current, [status]: !current[status] }))}
                        >
                          {heading}
                        </DisclosureButton>
                      </h3>
                      <div className="focused-quest-group-content" hidden={collapsed} id={`quest-group-${status}`}>
                        {quests.length ? (
                          <div className="focused-quest-list">
                            {quests.map((quest) => {
                              const collapsed = collapsedQuestCards.has(quest.questId);
                              const detailsId = `quest-details-${quest.questId}`;
                              return (
                                <article className="focused-quest-card" key={quest.questId}>
                                  <h4 className="focused-quest-item-heading">
                                    <DisclosureButton
                                      controls={detailsId}
                                      expanded={!collapsed}
                                      className="focused-quest-toggle"
                                      onClick={() => setCollapsedQuestCards((current) => {
                                        const next = new Set(current);
                                        if (collapsed) next.delete(quest.questId);
                                        else next.add(quest.questId);
                                        return next;
                                      })}
                                    >
                                      <span className="focused-quest-title">{quest.title}</span>
                                      <span className={`focused-quest-status focused-quest-status--${quest.status}`}>
                                        {quest.status === "completed" ? "Completed" : "Active"}
                                      </span>
                                    </DisclosureButton>
                                  </h4>
                                  <div className="focused-quest-content" hidden={collapsed} id={detailsId}>
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
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="focused-quest-empty">{emptyMessage}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </section>
              <section className="focused-quest-journal focused-daily-journal" aria-labelledby="daily-journal-title">
                <h2 id="daily-journal-title">Daily postings</h2>
                {(() => {
                  const character = snapshot?.character as (Omit<NonNullable<GameSnapshot["character"]>, "dailyJobs"> & {
                    dailyJobs?: Array<{
                      boardId: string;
                      cycle: string;
                      jobId: string;
                      title: string;
                      status: "active" | "completed";
                      details?: {
                        id: string;
                        poster: string;
                        title: string;
                        supplyTypeId: string;
                        quantity: number;
                        gold: number;
                        experience: number;
                      };
                    }>;
                  }) | undefined;
                  const jobs = character?.dailyJobs ?? [];
                  const today = new Date().toISOString().slice(0, 10);
                  if (!jobs.length) return <p className="focused-quest-empty">No daily postings accepted yet.</p>;
                  return (
                    <ul className="focused-daily-journal__list">
                      {jobs.map((job) => {
                        const expired = job.cycle < today && job.status === "active";
                        const status = expired ? "Expired" : job.status === "completed" ? "Completed" : "Active";
                        const carriedCount = job.details
                          ? (character?.inventory ?? []).filter((item) =>
                            item.typeId === job.details!.supplyTypeId &&
                            item.questBound !== true &&
                            item.id !== character?.equipment?.weaponItemId &&
                            item.id !== character?.equipment?.armorItemId
                          ).length
                          : 0;
                        return (
                          <li className="focused-daily-journal__item" key={`${job.boardId}:${job.cycle}:${job.jobId}`}>
                            <span className="focused-daily-journal__description">
                              {job.title}
                              <small>{job.cycle}{job.details ? ` · resets ${dailyCycleResetDate(job.cycle)}` : ""}</small>
                              {job.details && (
                                <>
                                  <small>Posted by {job.details.poster}</small>
                                  {job.status === "active" && (
                                    <small>Bring {job.details.quantity} {job.details.supplyTypeId} · carried {carriedCount}/{job.details.quantity}</small>
                                  )}
                                  <small>Reward: {job.details.gold} gold · {job.details.experience} XP</small>
                                </>
                              )}
                            </span>
                            <span className={`focused-quest-status focused-quest-status--${expired ? "expired" : job.status}`}>{status}</span>
                          </li>
                        );
                      })}
                    </ul>
                  );
                })()}
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

        {!isGameOver && screen === "codex" && (
          <div className="focused-screen focused-codex-screen" aria-label="Orraveth Codex">
            {infoTabs}
            <CodexScreen />
          </div>
        )}
      </section>

      {!isGameOver && (
        <nav
          className={`focused-bottom-nav${screen === "play" && snapshot?.location && !isAnyCombatActive && !visiblePvp ? " focused-bottom-nav--with-type" : ""}`}
          aria-label="Game screens"
        >
          <a href="#/play" className="focused-tab" aria-current={screen === "play" ? "page" : undefined} onClick={() => setMenuOpen(false)}><Compass aria-hidden="true" /><span>Play</span></a>
          <a href="#/info" className="focused-tab" aria-current={screen !== "play" ? "page" : undefined} onClick={() => setMenuOpen(false)}><InfoIcon aria-hidden="true" /><span>Info</span></a>
          {screen === "play" && snapshot?.location && !isAnyCombatActive && !visiblePvp && (
            <button
              className="focused-tab focused-type-tab"
              type="button"
              aria-pressed={mobileCommandInputOpen}
              onClick={() => {
                if (mobileCommandInputOpen) {
                  document.getElementById("focused-world-command")?.blur();
                  setMobileCommandInputOpen(false);
                  return;
                }
                setTerminalExpandRequest((request) => request + 1);
                setMenuOpen(false);
                setMobileCommandInputOpen(true);
              }}
            >
              <Keyboard aria-hidden="true" /><span>Type</span>
            </button>
          )}
          <div className="focused-nav-menu" ref={navMenuRef}>
            <button
              ref={navMenuTriggerRef}
              className="focused-tab focused-nav-menu__trigger"
              type="button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              aria-controls="focused-nav-menu-panel"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
              <span>Menu</span>
            </button>
            <div
              id="focused-nav-menu-panel"
              className="focused-nav-menu__panel"
              role="region"
              aria-label="Menu"
              hidden={!menuOpen}
            >
              <div className="focused-nav-menu__brand">
                <span className="focused-brand-mark" aria-hidden="true" />
                <span>MUDD</span>
              </div>
              <PwaInstallAction className="focused-nav-menu__action" />
              <Button
                type="button"
                variant="quiet"
                className="focused-nav-menu__action"
                onClick={() => {
                  setMenuOpen(false);
                  void handleLeaveWorld();
                }}
                disabled={leaving}
              >
                <Users size={18} aria-hidden="true" /><span>Characters</span>
              </Button>
              <Button
                type="button"
                variant="quiet"
                className="focused-nav-menu__action"
                onClick={toggleTheme}
                aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
                title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
              >
                {theme === "light" ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
                <span>{theme === "light" ? "Dark theme" : "Light theme"}</span>
              </Button>
            </div>
          </div>
        </nav>
      )}
    </main>
  );
}
