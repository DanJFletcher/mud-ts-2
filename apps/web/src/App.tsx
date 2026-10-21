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
import { MuddHttpClient, type CommandResponse, type GameSnapshot } from "@mudd/client-sdk";
import type { InteractionInbox } from "@mudd/contracts";
import {
  ActivityLog,
  Button,
  DisclosureButton,
  NavigationControls,
  Panel,
  Text,
  TextInput,
  type ActivityEntry,
} from "@mudd/ui";
import { ChevronDown, Compass, Info as InfoIcon, Keyboard, Menu, Moon, Sun, Users, X } from "lucide-react";
import { RoomChatPanel, type RoomChatMessage } from "./RoomChatPanel.js";
import { TerminalPanel } from "./TerminalPanel.js";
import { WorldMapPanel } from "./WorldMapPanel.js";

const client = new MuddHttpClient({ worldInstanceId: "mudd-demo-instance" });
type DialogueProjection = Awaited<ReturnType<MuddHttpClient["talk"]>>;
type MerchantCatalog = Awaited<ReturnType<MuddHttpClient["getMerchantCatalog"]>>;
type Screen = "play" | "vitals" | "items" | "equipment" | "stats" | "notes";
type WorldClientProps = { onLeaveWorld: () => Promise<void> };
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
    "Usage: read <object>",
    "Read written text on an object in the current room.",
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
    "Usage: use <item> on <target> | use <healing item>",
    "Use an item on a room object, or restore health during or between encounters.",
  ],
  rest: [
    "Usage: rest",
    "Restore your health for the inn’s listed price when you are below full health.",
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
    "End an active encounter and return to the room with your current health.",
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
  "talk <npc> [about <topic>] — Speak privately with someone in the current room.",
  "shop <merchant> — Browse a merchant’s goods and your balance.",
  "buy <item> — Purchase an item from the open merchant catalog.",
  "look [at] <object> — Describe the room or inspect an object here or in your inventory.",
  "go <direction> — Travel through an available exit.",
  "read <object> — Read text on an object in the current room.",
  "take <item> | take all — Pick up one or all items in the current room.",
  "equip <item> — Equip a carried weapon or armor item.",
  "unequip <weapon|armor> — Remove equipped gear from a slot.",
  "use <item> on <target> | use <healing item> — Use a room item or restore health during or between encounters.",
  "rest — Restore your health at an inn for its listed price.",
  "drop <item> — Put down an item you carry.",
  "attack <opponent> — Begin an encounter or attack during combat.",
  "defend — Guard against the opponent’s next strike.",
  "flee — End the current encounter.",
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
  const route = window.location.hash.slice(2);
  if (route === "notes" || route === "info/notes" || route === "info/field-notes") return "notes";
  if (route === "info/items") return "items";
  if (route === "info/equipment") return "equipment";
  if (route === "info/stats") return "stats";
  if (route === "traveler" || route === "info" || route === "info/traveler" || route === "info/vitals") return "vitals";
  return "play";
}

function makeEntry(kind: ActivityEntry["kind"], text: string): ActivityEntry {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, kind, text };
}

function completedQuestObjectiveKeys(snapshot: GameSnapshot): string[] {
  return (snapshot.questJournal ?? []).flatMap((quest) =>
    quest.objectives
      .filter((objective) => objective.completed)
      .map((objective) => `${quest.questId}\u0000${objective.id}`),
  );
}

export function WorldClient({ onLeaveWorld }: WorldClientProps) {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [interactionInbox, setInteractionInbox] = useState<InteractionInbox | null>(null);
  const [partyInfo, setPartyInfo] = useState<Awaited<ReturnType<MuddHttpClient["getPartyInfo"]>> | null>(null);
  const [teamCombatInfo, setTeamCombatInfo] = useState<Awaited<ReturnType<MuddHttpClient["getTeamCombatInfo"]>> | null>(null);
  const [presenceStale, setPresenceStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"look" | "read" | "take" | "use" | "drop" | "move" | "talk" | "shop" | "buy" | "combat" | "rest" | "equip" | "party" | null>(null);
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
  const [activeMerchantCatalog, setActiveMerchantCatalog] = useState<MerchantCatalog | null>(null);
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
  const terminalFollowsLatestRef = useRef(true);
  const lastRoomLookIdRef = useRef<string | null>(null);
  const knownQuestObjectiveCompletionsRef = useRef<Set<string>>(new Set());
  const knownInteractionStatusesRef = useRef<Map<string, string>>(new Map());
  const knownPvpUpdateRef = useRef<string | null>(null);
  const knownPartyRevisionRef = useRef<number | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

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
  ) => {
    terminalFollowsLatestRef.current = !preserveScroll;
    setEntries((current) => [...current, makeEntry(kind, text)]);
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
    addEntry("narration", location.description);
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
      if (!active || document.visibilityState === "hidden" || requestRunning) return;
      requestRunning = true;
      try {
        const presence = await client.heartbeatWorldSession();
        if (!active) return;
        setSnapshot((current) => {
          if (
            !current?.location ||
            current.location.worldInstanceId !== presence.worldInstanceId ||
            current.location.locationId !== presence.locationId
          ) return current;
          const unchanged = current.location.occupants.length === presence.occupants.length &&
            current.location.occupants.every((occupant, index) =>
              occupant.id === presence.occupants[index]?.id &&
              occupant.displayName === presence.occupants[index]?.displayName
            );
          return unchanged
            ? current
            : { ...current, location: { ...current.location, occupants: [...presence.occupants] } };
        });
        setPresenceStale(false);
      } catch {
        if (active) setPresenceStale(true);
      } finally {
        requestRunning = false;
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void sendHeartbeat();
    };

    void sendHeartbeat();
    const interval = window.setInterval(() => void sendHeartbeat(), 30_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("pageshow", refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
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
      if (!active || document.visibilityState === "hidden" || requestRunning) return;
      requestRunning = true;
      try {
        const inbox = await client.getInteractionInbox();
        if (!active) return;
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
    const interval = window.setInterval(() => void refreshInteractions(), 3_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshInteractions();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [addEntry, presenceCharacterId]);

  const refreshPartyState = useCallback(async (preserveTerminalScroll = false) => {
    if (!presenceCharacterId) return null;
    const previousRevision = knownPartyRevisionRef.current;
    const next = await client.getPartyInfo(presenceCharacterId, previousRevision ?? undefined);
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
    const poll = async () => {
      if (!active || requestRunning || document.visibilityState === "hidden") return;
      requestRunning = true;
      try {
        const next = await client.getTeamCombatInfo(presenceCharacterId);
        if (active) setTeamCombatInfo(next);
      } catch {
        // Keep the last known encounter while the connection recovers.
      } finally {
        requestRunning = false;
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 2_000);
    return () => {
      active = false;
      window.clearInterval(interval);
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
    const interval = window.setInterval(() => void pollParty(), 3_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void pollParty();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [presenceCharacterId, refreshPartyState]);

  const refreshAfterMutation = useCallback(async (message: string, announceQuestObjectives = false) => {
    addEntry("system", message);
    const nextSnapshot = await client.getGame();
    setSnapshot(nextSnapshot);
    setConnectionError("");
    addDefaultLook(nextSnapshot.location);
    if (announceQuestObjectives) announceNewQuestObjectives(nextSnapshot);
    else rememberCompletedQuestObjectives(nextSnapshot);
    return nextSnapshot;
  }, [addDefaultLook, addEntry, announceNewQuestObjectives, rememberCompletedQuestObjectives]);

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
      rememberCompletedQuestObjectives(nextSnapshot);
      setSnapshot(nextSnapshot);
      setConnectionError("");
      setActiveDialogue(dialogue.choices.length ? dialogue : null);
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
    setPending("move");
    try {
      const response = exit.roadId
        ? await client.roadStep(snapshot.character.characterId, exit.id, snapshot.location.revision)
        : await client.move(snapshot.character.characterId, exit.id, snapshot.location.revision);
      const partyAmbush = response.events?.some((event) => event.type === "team.road_encounter_started");
      const nextSnapshot = await refreshAfterMutation(
        partyAmbush
          ? "A roadside ambush interrupts your travel."
          : `You travel ${exit.direction || exit.label}.`,
        true,
      );
      if (partyAmbush) {
        const nextTeamInfo = await refreshTeamCombat();
        if (nextTeamInfo?.encounter) {
          addEntry("narration", `${nextTeamInfo.encounter.lastNarration} Round ${nextTeamInfo.encounter.round}.`);
        }
      } else if (response.events?.some((event) => event.type === "character.combat_encounter_started")) {
        addEntry("narration", nextSnapshot.character?.combat?.lastNarration ?? "A roadside opponent blocks your way.");
      }
      setActiveDialogue(null);
      setActiveMerchantCatalog(null);
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "Unable to move.");
    } finally {
      setPending(null);
    }
  }, [addEntry, pending, refreshAfterMutation, refreshTeamCombat, snapshot]);

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

  const performInnRest = useCallback(async () => {
    if (!snapshot?.character || !snapshot.location?.inn || pending) return;
    const inn = snapshot.location.inn;
    const previousHealth = snapshot.character.health;
    setPending("rest");
    try {
      await client.restAtInn(snapshot.character.characterId, inn.id, snapshot.character.revision);
      const nextSnapshot = await client.getGame();
      setSnapshot(nextSnapshot);
      setConnectionError("");
      const nextHealth = nextSnapshot.character?.health;
      const nextWallet = nextSnapshot.character?.wallet;
      const healthRestored = nextHealth
        ? nextHealth.current - (previousHealth?.current ?? nextHealth.maximum)
        : 0;
      addEntry(
        "narration",
        `You rest at ${inn.name}, restore ${healthRestored} health, and pay ${inn.restPrice} ${inn.currency.name}${inn.restPrice === 1 ? "" : "s"}. Health: ${nextHealth?.current ?? "—"}/${nextHealth?.maximum ?? "—"}. Balance: ${nextWallet?.balance ?? "—"}.`,
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
        addEntry("error", "Rest at the inn in this location; no target is needed.");
        return;
      }
      if (!snapshot?.location?.inn) {
        addEntry("error", "There is no inn here where you can rest.");
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
        const itemMatches = findObjectMatches(itemTarget, snapshot?.character?.inventory ?? []);
        if (itemMatches.length > 1) {
          addEntry("error", `Which item do you mean: ${itemMatches.map((item) => item.label).join(", ")}?`);
          return;
        }
        const item = itemMatches[0];
        if (item?.consumable?.effect === "heal") {
          await performCombatAction("use-item", undefined, false, item.id);
          return;
        }
        addEntry("error", "Use a healing item by name, or use a carried item on a room target.");
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
  }, [addEntry, browseMerchant, changeEquipment, dropObject, inspect, move, pending, purchaseMerchantListing, readObject, snapshot, takeAllObjects, takeObject, talkToNpc, performItemUse, activeMerchantCatalog, performCombatAction, performInnRest, interactionInbox, respondToPlayerChallenge, challengePlayer, partyInfo, refreshPartyState, teamCombatInfo]);

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
  const canHealOutsideCombat = Boolean(
    outsideCombatHealth && outsideCombatHealth.current < outsideCombatHealth.maximum,
  );
  const quickUseItems = quickInventory.filter((item) => {
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
  const quickCommandItems = useMemo(() => {
    type QuickAction = {
      id: string;
      label: string;
      ariaLabel: string;
      opensMenu: boolean;
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

    addMode("look", "look", "Show look targets");
    if (readableObjects.length > 0) addMode("read", "read", "Show readable objects");
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
      actions.push({
        id: "flee",
        label: "flee",
        ariaLabel: "Flee",
        opensMenu: false,
        onSelect: () => submitQuickCommand("flee"),
      });
    } else if (challengeableNpcs.length > 0) {
      addMode("attack", "attack", "Show opponents to attack");
    }
    const health = snapshot?.character?.health;
    const needsRest = Boolean(health && health.current < health.maximum);
    if (
      visibleCombat?.status !== "active" &&
      snapshot?.location?.inn &&
      needsRest
    ) {
      const inn = snapshot.location.inn;
      actions.push({
        id: "rest",
        label: "rest",
        ariaLabel: `Rest at ${inn.name} for ${inn.restPrice} ${inn.currency.name}${inn.restPrice === 1 ? "" : "s"}`,
        opensMenu: false,
        onSelect: () => submitQuickCommand("rest"),
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
    quickBuyListings.length,
    quickShopNpcs.length,
    quickTakeableObjects.length,
    quickUseItems.length,
    setQuickCommandMode,
    snapshot?.character?.inventory,
    snapshot?.character?.equipment,
    snapshot?.location?.npcs,
    snapshot?.location?.objects,
    snapshot?.location?.inn,
    snapshot?.character?.health,
    submitQuickCommand,
    visibleCombat,
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
                      <div className="focused-terminal-health" aria-label="Character health">
                        Health {snapshot.character.health.current}/{snapshot.character.health.maximum}
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
                        {entries.length > 0 && <ActivityLog entries={entries} label="Terminal transcript" />}
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
                  {!isAnyCombatActive && !visiblePvp && activeDialogue?.choices.length ? (
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
                        <div className="focused-terminal-combat__actions" role="group" aria-label="Cooperative combat actions">
                          <button type="button" className="focused-quick-command focused-combat-action" onClick={() => void performCombatAction("attack", undefined, true)} disabled={pending !== null}>attack</button>
                          <button type="button" className="focused-quick-command focused-combat-action" onClick={() => void performCombatAction("defend", undefined, true)} disabled={pending !== null}>defend</button>
                          {quickUseItems.some((item) => item.consumable?.effect === "heal") ? (
                            <button type="button" className="focused-quick-command focused-combat-action" aria-expanded={combatUseMenuOpen} onClick={() => setCombatUseMenuOpen((open) => !open)} disabled={pending !== null}>use</button>
                          ) : null}
                          <button type="button" className="focused-quick-command focused-combat-action" onClick={() => void performCombatAction("flee", undefined, true)} disabled={pending !== null}>flee</button>
                        </div>
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
                          disabled={pending !== null}
                        >
                          flee
                        </button>
                      </div>
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
                      disabled={!snapshot.character || pending !== null}
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
                                  if (item.consumable?.effect === "heal") {
                                    submitQuickCommand(`use ${item.label}`);
                                  } else {
                                    setQuickUseItemId(item.id);
                                    setQuickCommandMode("use-target");
                                  }
                                }}
                                aria-label={item.consumable?.effect === "heal"
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
                              disabled={pending !== null}
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
                  {isMobileViewport && (
                    <RoomChatPanel
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
                        {pending === "look" ? "Looking" : pending === "read" ? "Reading" : pending === "take" ? "Taking" : pending === "drop" ? "Dropping" : pending === "move" ? "Moving" : pending === "talk" ? "Talking" : pending === "shop" ? "Browsing" : pending === "buy" ? "Buying" : pending === "combat" ? "Acting" : pending === "rest" ? "Resting" : pending === "equip" ? "Changing gear" : "Send"}
                      </Button>
                    </form>
                  </section>}
                </TerminalPanel>
                {!isMobileViewport && (
                  <RoomChatPanel
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

            {connectionError && snapshot && (
              <div className="focused-feedback focused-feedback--error" role="status" aria-live="polite">
                <i aria-hidden="true" /><p>{connectionError} <button type="button" onClick={() => void loadGame()}>Retry</button></p>
              </div>
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
                  <div className="focused-vital">
                    <div className="focused-vital-heading">
                      <span>Health</span>
                      <strong>{snapshot.character?.health ? `${snapshot.character.health.current}/${snapshot.character.health.maximum}` : "Unavailable"}</strong>
                    </div>
                    {snapshot.character?.health && (
                      <div
                        className="focused-vital-meter"
                        role="meter"
                        aria-label="Character health"
                        aria-valuemin={0}
                        aria-valuemax={snapshot.character.health.maximum}
                        aria-valuenow={snapshot.character.health.current}
                      >
                        <span style={{
                          width: `${Math.max(0, Math.min(100, (snapshot.character.health.current / snapshot.character.health.maximum) * 100))}%`,
                        }} />
                      </div>
                    )}
                  </div>
                </div>
                <div className="focused-details">
                  <div className="focused-detail"><span>Standing</span><strong>{snapshot.character?.health?.current === 0 ? "Down" : snapshot.character ? "Alive" : "Not started"}</strong></div>
                  <div className="focused-detail"><span>Wallet</span><strong>{snapshot.character?.wallet ? `${snapshot.character.wallet.balance} moss marks` : "—"}</strong></div>
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
                                aria-label={`Inspect ${item.label}`}
                                disabled={pending !== null}
                                onClick={() => void inspectCarriedItem(item)}
                              >
                                {item.label}
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
                      {snapshot.character?.advancement
                        ? `Level ${snapshot.character.advancement.level}`
                        : "No combat victories yet"}
                    </p>
                  </div>
                </div>
                <div className="focused-details">
                  <div className="focused-detail"><span>Level</span><strong>{snapshot.character?.advancement?.level ?? "—"}</strong></div>
                  <div className="focused-detail"><span>Experience</span><strong>{snapshot.character?.advancement?.experience ?? "—"}</strong></div>
                  <div className="focused-detail"><span>Health capacity</span><strong>{snapshot.character?.health?.maximum ?? "—"}</strong></div>
                  <div className="focused-detail"><span>Weapon bonus</span><strong>+{snapshot.character?.inventory.find((item) => item.id === snapshot.character?.equipment.weaponItemId)?.equipment?.attackBonus ?? 0}</strong></div>
                  <div className="focused-detail"><span>Armor bonus</span><strong>+{snapshot.character?.inventory.find((item) => item.id === snapshot.character?.equipment.armorItemId)?.equipment?.defenseBonus ?? 0}</strong></div>
                </div>
                <p className="focused-note">Character attributes such as Strength and Dexterity are not tracked yet.</p>
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
