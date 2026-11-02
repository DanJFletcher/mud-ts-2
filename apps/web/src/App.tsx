import { readableObjectsForQuickActions, selectItemActions, selectUsableAxes } from "./features/inventory/action-selectors.js";
import { useActivityHistory } from "./features/history/use-activity-history.js";
import { useWorldCommands } from "./commands/use-world-commands.js";
import { useActionDispatch } from "./commands/use-action-dispatch.js";
import { type ActionIntent, type EntityRef, type IntentContext, entityRef, intentContext, sameIntentContext } from "./commands/intents.js";
import { useMovementShortcuts } from "./features/keyboard/use-movement-shortcuts.js";
import { useDailyController } from "./features/daily/use-daily-controller.js";
import { useInventoryController } from "./features/inventory/use-inventory-controller.js";
import { useDialogueController } from "./features/dialogue/use-dialogue-controller.js";
import { useCommerceController } from "./features/commerce/use-commerce-controller.js";
import { useSocialController } from "./features/social/use-social-controller.js";
import { useFishingController } from "./features/gathering/use-fishing-controller.js";
import { useWoodcuttingController } from "./features/gathering/use-woodcutting-controller.js";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  lazy,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  Suspense,
  type FormEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import {
  MuddCommandError,
  MuddHttpClient,
  MuddHttpError,
  type CommandResponse,
  type GameSnapshot,
  type PendingAction,
} from "@mudd/client-sdk";
import {
  characterHasEquippedItem,
  EQUIPMENT_SLOTS,
  equipmentItemIdForSlot,
  FLEE_STAMINA_COST,
} from "@mudd/contracts";
import {
  ActivityHistoryWindow,
  Button,
  ClassAbilityList,
  ClassChoice,
  CraftingQuantityDialog,
  DailyBoard,
  DisclosureButton,
  InteractionOptionsDialog,
  NavigationControls,
  NpcDialogueDialog,
  Panel,
  PendingActionStatus,
  Skeleton,
  Text,
  TextInput,
  type ActivityEntry,
  type ActivityLogAction,
  type ActivityLogTarget,
} from "@mudd/ui";
import { ChevronDown, Coins, Compass, Heart, Info as InfoIcon, Keyboard, Menu, Moon, Sparkles, Sun, Users, X, Zap } from "lucide-react";
import { RoomChatPanel, type RoomChatMessage } from "./RoomChatPanel.js";
import { traceFirstFeedbackPaint } from "./features/session/action-feedback.js";
import { useTravelController } from "./features/travel/use-travel-controller.js";
import { ForegroundExecution, type ExecutionToken } from "./features/session/foreground-execution.js";
import { useGameSession } from "./use-game-session.js";
import { TerminalPanel } from "./TerminalPanel.js";
import { WorldMapPanel } from "./WorldMapPanel.js";
import { PwaInstallAction } from "./lobby/PwaInstallAction.js";
import { getNpcFarewellLabel } from "./npc-farewell.js";

const CodexScreen = lazy(() => import("./codex/CodexScreen.js"));

function ProjectedVitalReadout({ snapshot, client }: { snapshot: GameSnapshot; client: MuddHttpClient }) {
  const [clientNow, setClientNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setClientNow(new Date()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const character = snapshot.character;
  const projected = client.projectVitals(snapshot, clientNow);
  const health = projected?.health ?? character?.health;
  const stamina = projected?.stamina ?? character?.resources.stamina;
  const mana = projected?.mana ?? character?.resources.mana;
  return (
    <div className="focused-terminal-vitals" role="group" aria-label="Quick info" aria-live="off">
      {health && stamina && mana && (
        <>
          <span className="focused-terminal-vital" role="group" aria-label="Character health" title="Health">
            <Heart size={14} aria-hidden="true" />
            {health.current}/{health.maximum}
          </span>
          <span className="focused-terminal-vital" role="group" aria-label="Character stamina" title="Stamina">
            <Zap size={14} aria-hidden="true" />
            {stamina.current}/{stamina.maximum}
          </span>
          <span className="focused-terminal-vital" role="group" aria-label="Character mana" title="Mana">
            <Sparkles size={14} aria-hidden="true" />
            {mana.current}/{mana.maximum}
          </span>
        </>
      )}
      {character?.wallet && snapshot.currency && (
        <span
          className="focused-terminal-vital"
          role="group"
          aria-label={`Character currency balance: ${character.wallet.balance} ${snapshot.currency.name}`}
          title={snapshot.currency.name}
        >
          <Coins size={14} aria-hidden="true" />
          {character.wallet.balance} {snapshot.currency.symbol}
        </span>
      )}
    </div>
  );
}

type ClassCatalogSummary = NonNullable<Awaited<ReturnType<MuddHttpClient["getWorlds"]>>[number]["classCatalog"]>;

function isRejectedAction(error: unknown): boolean {
  return error instanceof MuddCommandError ||
    (error instanceof MuddHttpError && error.status >= 400 && error.status < 500);
}

function pendingActionPresentation(action: PendingAction) {
  const state = action.state === "acknowledged" || action.state === "uncertain"
    ? action.state
    : "sending";
  if (action.details.kind === "pvp.challenge") {
    return {
      state,
      label: state === "sending" ? `Sending challenge to ${action.details.recipientName}…`
        : state === "acknowledged" ? "Challenge sent; confirming the request…"
          : "Challenge status is unconfirmed.",
      detail: state === "uncertain"
        ? "Repeat the same challenge command to safely retry with the same command ID."
        : undefined,
    } as const;
  }
  if (action.details.kind === "pvp.respond") {
    return {
      state,
      label: state === "sending" ? `Sending your ${action.details.response}…`
        : state === "acknowledged" ? "Response sent; confirming the result…"
          : "Response status is unconfirmed.",
      detail: state === "uncertain"
        ? "Repeat the same response command to safely retry with the same command ID."
        : undefined,
    } as const;
  }
  return {
    state,
    label: state === "sending" ? "Sending message…"
      : state === "acknowledged" ? "Message sent; confirming…"
        : "Message delivery is unconfirmed.",
  } as const;
}


type Screen = "play" | "vitals" | "items" | "equipment" | "stats" | "notes" | "codex";
type WorldClientProps = {
  onLeaveWorld: () => Promise<void>;
  worldInstanceId?: string;
  characterId?: string;
  client?: MuddHttpClient;
  historyLimit?: number;
};
type OptimisticNpcDepartureFallback = Readonly<{
  worldInstanceId: string;
  locationId: string;
  npcName: string;
  entryId: string;
  expiresAt: number;
}>;
type RecentNpcDepartureAnnouncement = Readonly<{
  worldInstanceId: string;
  locationId: string;
  npcName: string;
  expiresAt: number;
}>;
type RoomLookPreview = Pick<
  NonNullable<GameSnapshot["location"]>,
  "locationId" | "title" | "description"
>;

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

/** Own one immutable SDK client per world/character entry, including re-entry. */
export function WorldClient({
  worldInstanceId = window.localStorage.getItem("mudd-world-instance-id") ?? "mudd-demo-instance",
  ...props
}: WorldClientProps) {
  return <WorldSession key={JSON.stringify([worldInstanceId, props.characterId])}
    {...props} worldInstanceId={worldInstanceId} />;
}

function WorldSession({ client: suppliedClient, ...props }: WorldClientProps & { worldInstanceId: string }) {
  const [ownedClient] = useState(() => new MuddHttpClient({
    worldInstanceId: props.worldInstanceId,
    basePath: import.meta.env.BASE_URL,
    commandProjection: "game",
  }));
  const client = suppliedClient ?? ownedClient;
  const session = useGameSession(client);
  // The first loaded character belongs to this entry. Later replacements dispose
  // all feature state, timers and subscriptions by replacing the composition.
  const identity = useRef<{ characterId?: string; generation: number }>({ generation: 0 });
  const characterId = session.snapshot?.character?.characterId;
  if (characterId && identity.current.characterId !== characterId) {
    if (identity.current.characterId) identity.current.generation++;
    identity.current.characterId = characterId;
  }
  return <WorldFeatures key={identity.current.generation} {...props} client={client} session={session} />;
}

function WorldFeatures({
  onLeaveWorld, worldInstanceId, client, session, historyLimit,
}: WorldClientProps & {
  worldInstanceId: string;
  client: MuddHttpClient;
  session: ReturnType<typeof useGameSession>;
}) {
  const {
    snapshot, setSnapshot, loading, connectionError, setConnectionError,
    loadGame: loadSession, reconcileCommand, presenceStale, refreshGate,
  } = session;
  const optimisticNpcDepartureFallbacksRef = useRef<OptimisticNpcDepartureFallback[]>([]);
  const recentNpcDepartureAnnouncementsRef = useRef<RecentNpcDepartureAnnouncement[]>([]);
  const recentNpcTerminalEventIdsRef = useRef<Set<string>>(new Set());
  const terminalRoomRefreshTimerRef = useRef<number | undefined>(undefined);
  const activeCharacterIdRef = useRef<string | undefined>(snapshot?.character?.characterId);
  activeCharacterIdRef.current = snapshot?.character?.characterId;
  const activeLocationIdRef = useRef<string | undefined>(snapshot?.location?.locationId);
  activeLocationIdRef.current = snapshot?.location?.locationId;
  const [classCatalog, setClassCatalog] = useState<ClassCatalogSummary | undefined>();
  const [classCatalogError, setClassCatalogError] = useState<string>();
  const [classChoiceId, setClassChoiceId] = useState("");
  const [confirmClassAdoption, setConfirmClassAdoption] = useState(false);
  const [pending, setPendingState] = useState<"look" | "read" | "take" | "use" | "drop" | "put" | "move" | "talk" | "shop" | "buy" | "craft" | "combat" | "rest" | "stand" | "equip" | "party" | "daily" | "gather" | null>(null);
  const pendingActionSnapshot = useSyncExternalStore(
    client.pendingActions.subscribe,
    client.pendingActions.getSnapshot,
    client.pendingActions.getSnapshot,
  );
  const foregroundPendingAction = pendingActionSnapshot.filter((action) =>
    action.scope.worldInstanceId === worldInstanceId &&
    action.scope.characterId === snapshot?.character?.characterId &&
    action.details.kind !== "chat.send" &&
    action.details.kind !== "character.move" &&
    (action.state === "sending" || action.state === "acknowledged" || action.state === "uncertain")
  ).at(-1);
  const actionTiming = useRef<{ name: string; started: number } | null>(null);
  const executionCoordinator = useMemo(() => new ForegroundExecution(refreshGate), [refreshGate]);
  const beginForeground = useCallback((label: NonNullable<typeof pending>) => {
    const token = executionCoordinator.begin(label);
    if (!token) return;
    actionTiming.current = { name: label, started: performance.now() };
    setPendingState(label);
    return token;
  }, [executionCoordinator]);
  const finishForeground = useCallback((token: ExecutionToken, keepFeedback = false) => {
    if (executionCoordinator.finish(token, keepFeedback) && !keepFeedback) setPendingState(null);
  }, [executionCoordinator]);
  const clearTravelFeedback = useCallback((token: ExecutionToken | undefined) => {
    if (executionCoordinator.clearFeedback(token)) setPendingState(null);
  }, [executionCoordinator]);
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
  const [quickCommandMode, setQuickCommandMode] = useState<"quick" | "choose-exit" | "look" | "read" | "drop" | "take" | "loot" | "talk" | "attack" | "shop" | "buy" | "use" | "use-target" | "equip" | "unequip">("quick");
  const [quickUseItemId, setQuickUseItemId] = useState<string | null>(null);
  const [combatUseMenuOpen, setCombatUseMenuOpen] = useState(false);
  const { entries, announcement, history: activityHistory } = useActivityHistory(historyLimit);
  const [collapsedQuestGroups, setCollapsedQuestGroups] = useState({ active: false, completed: false });
  const [collapsedQuestCards, setCollapsedQuestCards] = useState<Set<string>>(() => new Set());
  const [activeInteractionTarget, setActiveInteractionTarget] = useState<(ActivityLogTarget & { context?: IntentContext; entityKind?: EntityRef["kind"] }) | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    window.localStorage.getItem("mudd-theme") === "light" ? "light" : "dark"
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
  const [terminalFollowingLatest, setTerminalFollowingLatest] = useState(true);
  const [terminalReadingAnchor, setTerminalReadingAnchor] = useState<string>();
  const terminalReadingPosition = useRef<{ id: string; offset: number } | undefined>(undefined);
  const lastRoomLookIdRef = useRef<string | null>(null);
  const knownQuestObjectiveCompletionsRef = useRef<Set<string>>(new Set());
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
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
  }, [client, worldInstanceId]);

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
    _preserveScroll = false,
    locationId = activeLocationIdRef.current,
  ) => {
    // Receiving activity never changes the player's reading mode.
    const entry = makeEntry(kind, text, locationId);
    activityHistory.append(entry);
    return entry.id;
  }, [activityHistory]);

  const {
    partyInfo, teamCombatInfo, interactionInbox, refreshPartyState, refreshTeamCombat,
    refreshInteractions, knownInteractionIds,
  } = useSocialController({ client, snapshot, refreshGate, addEntry });
  const addNpcTerminalEvent = useCallback((message: RoomChatMessage) => {
    if (Number.isSafeInteger(message.id)) {
      const eventKey = `${worldInstanceId}:${message.id}`;
      if (recentNpcTerminalEventIdsRef.current.has(eventKey)) return;
      if (recentNpcTerminalEventIdsRef.current.size >= 256) {
        const oldest = recentNpcTerminalEventIdsRef.current.values().next().value;
        if (oldest) recentNpcTerminalEventIdsRef.current.delete(oldest);
      }
      recentNpcTerminalEventIdsRef.current.add(eventKey);
    }
    if (message.roomId === activeLocationIdRef.current && activeCharacterIdRef.current) {
      window.clearTimeout(terminalRoomRefreshTimerRef.current);
      terminalRoomRefreshTimerRef.current = window.setTimeout(() => {
        const characterId = activeCharacterIdRef.current;
        if (!characterId || activeLocationIdRef.current !== message.roomId || refreshGate.busy) return;
        const epoch = refreshGate.capture();
        void client.look(characterId, undefined, { includeNpcDescriptions: true }).then((location) => {
          if (!refreshGate.accepts(epoch)) return;
          setSnapshot((current) => {
            if (
              !refreshGate.accepts(epoch) || !current ||
              current.character?.characterId !== characterId ||
              current.location?.locationId !== message.roomId ||
              location.locationId !== message.roomId
            ) return current;
            return {
              ...current,
              location: { ...location, occupants: current.location.occupants },
            };
          });
        }).catch(() => undefined);
      }, 100);
    }
    const isDeparture = /\b(?:leave|leaves|leaving|depart|departs|departed|departing)\b/i.test(message.text);
    const now = Date.now();
    if (isDeparture) {
      recentNpcDepartureAnnouncementsRef.current = [
        ...recentNpcDepartureAnnouncementsRef.current.filter((announcement) => announcement.expiresAt >= now),
        {
          worldInstanceId,
          locationId: message.roomId,
          npcName: message.speakerName,
          expiresAt: now + 30_000,
        },
      ].slice(-32);
    }
    const fallbackIndex = isDeparture
      ? optimisticNpcDepartureFallbacksRef.current.findIndex((fallback) =>
        fallback.worldInstanceId === worldInstanceId &&
        fallback.locationId === message.roomId &&
        fallback.npcName.toLocaleLowerCase() === message.speakerName.toLocaleLowerCase() &&
        fallback.expiresAt >= now)
      : -1;
    if (fallbackIndex >= 0) {
      const [fallback] = optimisticNpcDepartureFallbacksRef.current.splice(fallbackIndex, 1);
      if (fallback) {
        const entry = activityHistory.getSnapshot().entries.find((entry) => entry.id === fallback.entryId);
        if (entry) activityHistory.replace(entry.id, { ...entry, text: `${message.speakerName}: ${message.text}` });
        return;
      }
    }
    addEntry("narration", `${message.speakerName}: ${message.text}`, true, message.roomId);
  }, [activityHistory, addEntry, client, refreshGate, setSnapshot, worldInstanceId]);
  useEffect(() => () => window.clearTimeout(terminalRoomRefreshTimerRef.current), []);
  useEffect(() => {
    optimisticNpcDepartureFallbacksRef.current = [];
    recentNpcDepartureAnnouncementsRef.current = [];
    recentNpcTerminalEventIdsRef.current.clear();
  }, [worldInstanceId]);
  useEffect(() => {
    const characterId = snapshot?.character?.characterId;
    if (!characterId) return;
    client.pendingActions.clearOutsideScope({ worldInstanceId, characterId });
  }, [client.pendingActions, snapshot?.character?.characterId, worldInstanceId]);

  useEffect(() => {
    const characterId = snapshot?.character?.characterId;
    const locationId = snapshot?.location?.locationId;
    if (!characterId || !locationId) return;
    pendingActionSnapshot.forEach((action) => {
      if (
        action.details.kind === "character.move" &&
        action.scope.worldInstanceId === worldInstanceId &&
        action.scope.characterId === characterId &&
        action.details.fromLocationId !== locationId &&
        (action.state === "acknowledged" || action.state === "uncertain")
      ) client.pendingActions.confirm(action.id);
    });
  }, [client.pendingActions, pendingActionSnapshot, snapshot?.character?.characterId, snapshot?.location?.locationId, worldInstanceId]);

  useEffect(() => {
    const characterId = snapshot?.character?.characterId;
    if (!characterId || !interactionInbox) return;
    pendingActionSnapshot.forEach((action) => {
      if (
        action.scope.worldInstanceId !== worldInstanceId ||
        action.scope.characterId !== characterId ||
        (action.state !== "sending" && action.state !== "acknowledged" && action.state !== "uncertain")
      ) return;

      const details = action.details;
      if (details.kind === "pvp.challenge") {
        const priorIds = new Set(details.priorRequestIds);
        const request = interactionInbox.requests.find((candidate) =>
          !priorIds.has(candidate.requestId) &&
          candidate.initiatorCharacterId === characterId &&
          candidate.recipientCharacterId === details.recipientCharacterId
        );
        if (!request) return;
        client.pendingActions.confirm(action.id);
        addEntry("system", request.status === "pending"
          ? `Challenge sent to ${request.recipientName}. Waiting for a response.`
          : request.status === "accepted"
            ? `${request.recipientName} accepted your challenge.`
            : request.status === "declined"
              ? `${request.recipientName} declined your challenge.`
              : `The challenge to ${request.recipientName} ${request.status}.`, true);
      } else if (
        details.kind === "pvp.respond" &&
        interactionInbox.requests.some((request) =>
          request.requestId === details.requestId &&
          request.status === (details.response === "accept" ? "accepted" : "declined")
        )
      ) {
        client.pendingActions.confirm(action.id);
      }
    });
  }, [addEntry, client.pendingActions, interactionInbox, pendingActionSnapshot, snapshot?.character?.characterId, worldInstanceId]);

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

  const addDefaultLook = useCallback((location: RoomLookPreview | null | undefined): string[] => {
    if (!location || lastRoomLookIdRef.current === location.locationId) return [];
    lastRoomLookIdRef.current = location.locationId;
    return [
      addEntry("system", "> look", false, location.locationId),
      addEntry("location", location.title, false, location.locationId),
      addEntry("narration", location.description, false, location.locationId),
    ];
  }, [addEntry]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("mudd-theme", theme);
  }, [theme]);

  useLayoutEffect(() => {
    const history = terminalHistoryRef.current;
    if (screen !== "play" || !history) {
      setTerminalCanScrollDown(false);
      return;
    }
    if (terminalFollowsLatestRef.current) history.scrollTop = history.scrollHeight;
    else if (terminalReadingPosition.current) {
      const anchor = terminalReadingPosition.current;
      const row = [...history.querySelectorAll<HTMLElement>("[data-activity-entry]")]
        .find((row) => row.dataset.activityEntry === anchor.id);
      if (row) history.scrollTop += row.getBoundingClientRect().top - history.getBoundingClientRect().top - anchor.offset;
    }
    setTerminalCanScrollDown(history.scrollHeight - history.scrollTop - history.clientHeight > 32);
  }, [entries, screen, terminalReadingAnchor, terminalCanScrollDown]);

  const handleHistoryWindowChange = useCallback((latest: boolean) => {
    terminalFollowsLatestRef.current = latest;
    setTerminalFollowingLatest(latest);
    terminalReadingPosition.current = undefined;
    setTerminalReadingAnchor(undefined);
    setTerminalCanScrollDown(!latest);
    const history = terminalHistoryRef.current;
    if (history) history.scrollTop = latest ? history.scrollHeight : 0;
    if (latest) requestAnimationFrame(() => {
      const current = terminalHistoryRef.current;
      if (current && terminalFollowsLatestRef.current) current.scrollTop = current.scrollHeight;
    });
  }, []);
  const scrollTerminalToLatest = useCallback(() => {
    const history = terminalHistoryRef.current;
    if (!history) return;
    terminalFollowsLatestRef.current = true;
    setTerminalFollowingLatest(true);
    terminalReadingPosition.current = undefined;
    setTerminalReadingAnchor(undefined);
    history.scrollTop = history.scrollHeight;
    setTerminalCanScrollDown(false);
    requestAnimationFrame(() => {
      const current = terminalHistoryRef.current;
      if (current && terminalFollowsLatestRef.current) current.scrollTop = current.scrollHeight;
    });
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
    const result = await loadSession();
    if ("error" in result) {
      addEntry("error", result.error);
      return;
    }
    rememberCompletedQuestObjectives(result.snapshot);
    addDefaultLook(result.snapshot.location);
  }, [addDefaultLook, addEntry, loadSession, rememberCompletedQuestObjectives]);

  useEffect(() => {
    void loadGame();
  }, [loadGame]);



  const {
    activeDialogue, dialogueModalOpen, talkToNpc, chooseDialogueReply, closeNpcDialogue,
    dismissForTravel: dismissDialogueForTravel,
  } = useDialogueController({
    client, snapshot, pending: pending !== null, beginForeground, finishForeground,
    reconcileCommand, setSnapshot, setConnectionError, refreshGate, addEntry,
    rememberCompletedQuestObjectives,
  });
  const {
    activeMerchantCatalog, activeCraftingPrompt, browseMerchant, purchaseMerchantListing,
    craftingCommand, selectCraftingQuantity, closeMerchant, closeCrafting,
  } = useCommerceController({
    client, snapshot, pending: pending !== null, beginForeground, finishForeground,
    reconcileCommand, setSnapshot, setConnectionError, refreshGate, addEntry,
  });

  const travelHistory = useMemo(() => ({
    remove(ids: readonly string[]) {
      activityHistory.remove(ids);
    },
    resetLook(locationId: string) { lastRoomLookIdRef.current = locationId; },
    beginOptimistic: (owner: string) => activityHistory.beginOptimistic(owner),
    endOptimisticCreation: () => activityHistory.endOptimisticCreation(),
    settle: (owner: string) => activityHistory.settle(owner),
  }), [activityHistory]);
  const travelNpcNarration = useMemo(() => ({
    wasAnnounced(name: string, locationId: string, now: number) {
      return recentNpcDepartureAnnouncementsRef.current.some((item) =>
        item.expiresAt >= now && item.worldInstanceId === worldInstanceId &&
        item.locationId === locationId && item.npcName.toLocaleLowerCase() === name.toLocaleLowerCase());
    },
    recordFallback(fallback: OptimisticNpcDepartureFallback) {
      optimisticNpcDepartureFallbacksRef.current = [
        ...optimisticNpcDepartureFallbacksRef.current.filter((item) => item.expiresAt >= Date.now()),
        fallback,
      ].slice(-32);
    },
  }), [worldInstanceId]);
  const dismissTravelRoomFeatures = useCallback(() => {
    dismissDialogueForTravel();
    closeMerchant();
  }, [dismissDialogueForTravel, closeMerchant]);
  const { optimisticTravel, move } = useTravelController({
    client, worldInstanceId, snapshot, pending: pending !== null,
    beginForeground, finishForeground, clearTravelFeedback, setPendingState,
    reconcileCommand, setSnapshot, setConnectionError, refreshTeamCombat,
    announceNewQuestObjectives, dismissRoomFeatures: dismissTravelRoomFeatures,
    addDefaultLook, addEntry, history: travelHistory, npcNarration: travelNpcNarration,
  });


  const refreshAfterMutation = useCallback(async (
    message: string,
    command?: { base: GameSnapshot; response: CommandResponse },
    announceQuestObjectives = false,
    traceId?: string,
    accepts: () => boolean = () => true,
  ) => {
    if (accepts()) addEntry("system", message);
    const nextSnapshot = command
      ? (await reconcileCommand(command.base, command.response, traceId, accepts)).snapshot
      : await client.getGame(traceId);
    if (!accepts()) return nextSnapshot;
    if (!command) setSnapshot(nextSnapshot);
    setConnectionError("");
    addDefaultLook(nextSnapshot.location);
    if (announceQuestObjectives) announceNewQuestObjectives(nextSnapshot);
    else rememberCompletedQuestObjectives(nextSnapshot);
    return nextSnapshot;
  }, [addDefaultLook, addEntry, announceNewQuestObjectives, client, reconcileCommand, rememberCompletedQuestObjectives, setConnectionError, setSnapshot]);

  const {
    displayedDailyBoard, dailyBoardLoading, dailyBoardError, pendingDailyJobId,
    fetchDailyBoard, openDailyBoard, performDailyJob, performSupplyGather,
    handleDailyJobAction, closeDailyBoard,
  } = useDailyController({
    client, snapshot, pending: pending !== null, beginForeground, finishForeground,
    reconcileCommand, setSnapshot, setConnectionError, refreshGate, addEntry,
    worldInstanceId, refreshAfterMutation, loadGame,
  });
  const inventoryController = useInventoryController({
    client, snapshot, pending: pending !== null, beginForeground, finishForeground,
    reconcileCommand, setSnapshot, setConnectionError, refreshGate, addEntry,
    announceNewQuestObjectives, refreshAfterMutation,
  });
  const {
    inspect, inspectCarriedItem, readObject, takeObject, takeAllObjects, lootCorpse,
    extinguishCampfire, dropObject, putObject, changeEquipment, performItemUse,
    inspectedCarriedItem, inventoryInspectError,
  } = inventoryController;

  const { performFishingCast, cancelFishingCast,
    continueAction: continueFishingCast,
    active: activeFishingCast } = useFishingController({
    client, snapshot, pending: pending !== null, beginForeground, finishForeground,
    reconcileCommand, setSnapshot, setConnectionError, refreshGate, addEntry,
  });

  const { performWoodcuttingStart, cancelWoodcuttingAction,
    continueAction: continueWoodcutting,
    active: activeWoodcutting } = useWoodcuttingController({
    client, snapshot, pending: pending !== null, beginForeground, finishForeground,
    reconcileCommand, setSnapshot, setConnectionError, refreshGate, addEntry,
  });

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
    const execution = beginForeground("combat");
    if (!execution) return;
    try {
      let playerHasParty = Boolean(partyInfo?.party);
      if (!activeTeamEncounter && !activeEncounter && action === "attack" && targetNpcId) {
        const currentParty = await refreshPartyState();
        if (!currentParty) return;
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
        const startedInfo = await refreshTeamCombat();
        if (!startedInfo) return;
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
      const [reconciliation, nextTeamInfo] = await Promise.all([
        reconcileCommand(snapshot, result),
        refreshTeamCombat(),
      ]);
      const nextSnapshot = reconciliation.snapshot;

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
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, client, finishForeground, partyInfo?.party, pending, reconcileCommand, refreshPartyState, refreshTeamCombat, setConnectionError, snapshot, teamCombatInfo?.encounter]);

  const performClassAbility = useCallback(async (abilityId: string) => {
    const game = snapshot;
    const character = game?.character;
    if (!game?.character || !character || !game.location || pending) return;
    const teamEncounter = teamCombatInfo?.encounter?.status === "active" ? teamCombatInfo.encounter : undefined;
    const soloEncounter = game.character.combat?.status === "active" ? game.character.combat : undefined;
    const pvpEncounter = interactionInbox?.encounter?.status === "active" &&
      interactionInbox.encounter.participants.some((participant) => participant.characterId === game.character!.characterId)
      ? interactionInbox.encounter : undefined;
    if (!teamEncounter && !soloEncounter && !pvpEncounter) return;
    const execution = beginForeground("combat");
    if (!execution) return;
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
      const [reconciliation, nextTeamInfo, nextInbox] = await Promise.all([
        reconcileCommand(game, result),
        refreshTeamCombat(),
        pvpEncounter ? refreshInteractions() : Promise.resolve(interactionInbox),
      ]);
      const nextSnapshot = reconciliation.snapshot;


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
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, client, finishForeground, interactionInbox, pending, reconcileCommand, refreshInteractions, refreshTeamCombat, setConnectionError, snapshot, teamCombatInfo?.encounter]);

  const adoptCharacterClass = useCallback(async () => {
    const game = snapshot;
    const character = game?.character;
    if (!game?.character || !character || character.characterClass || !classChoiceId || pending) return;
    if (snapshot?.character?.combat?.status === "active" || teamCombatInfo?.encounter?.status === "active" || interactionInbox?.encounter?.status === "active") {
      addEntry("error", "Class adoption is available only outside combat.");
      return;
    }
    if (!confirmClassAdoption) {
      setConfirmClassAdoption(true);
      return;
    }
    const execution = beginForeground("combat");
    if (!execution) return;
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
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, classChoiceId, client, confirmClassAdoption, finishForeground, interactionInbox?.encounter?.status, pending, setSnapshot, snapshot, teamCombatInfo?.encounter?.status]);

  const challengePlayer = useCallback(async (recipientCharacterId: string, recipientName: string) => {
    if (!snapshot?.character || pending) return;
    const characterId = snapshot.character.characterId;
    const retryAction = client.pendingActions.getSnapshot().filter((action) =>
      action.scope.worldInstanceId === worldInstanceId &&
      action.scope.characterId === characterId &&
      action.details.kind === "pvp.challenge" &&
      action.details.recipientCharacterId === recipientCharacterId &&
      (action.state === "uncertain" || action.state === "acknowledged")
    ).at(-1);
    const commandId = (retryAction?.id ?? crypto.randomUUID()) as ReturnType<Crypto["randomUUID"]>;
    const traceId = new URLSearchParams(window.location.search).get("muddTrace") === "1"
      ? commandId
      : undefined;
    const actionStartedAt = performance.now();
    addEntry("system", `> attack ${recipientName}`);
    client.pendingActions.begin({
      id: commandId,
      scope: { worldInstanceId, characterId: snapshot.character.characterId },
      details: retryAction?.details ?? {
        kind: "pvp.challenge",
        recipientCharacterId,
        recipientName,
        priorRequestIds: [...new Set([
          ...knownInteractionIds(),
          ...(interactionInbox?.requests.map((request) => request.requestId) ?? []),
        ])],
      },
    });
    const execution = beginForeground("combat");
    if (!execution) return;
    traceFirstFeedbackPaint(traceId, "interaction.request", actionStartedAt);
    try {
      await client.requestInteraction(snapshot.character.characterId, recipientCharacterId, "pvp.challenge", commandId);
      client.pendingActions.acknowledge(commandId);
      await refreshInteractions();
    } catch (error) {
      const message = error instanceof Error ? error.message : "The challenge could not be sent.";
      if (isRejectedAction(error)) {
        client.pendingActions.reject(commandId, message);
        addEntry("error", message);
      } else {
        client.pendingActions.markUncertain(commandId, "Challenge status is not confirmed yet.");
      }
    } finally {
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, client, finishForeground, interactionInbox?.requests, knownInteractionIds, pending, refreshInteractions, snapshot?.character, worldInstanceId]);

  const respondToPlayerChallenge = useCallback(async (requestId: string, response: "accept" | "decline") => {
    if (!snapshot?.character || pending) return;
    const characterId = snapshot.character.characterId;
    const retryAction = client.pendingActions.getSnapshot().filter((action) =>
      action.scope.worldInstanceId === worldInstanceId &&
      action.scope.characterId === characterId &&
      action.details.kind === "pvp.respond" &&
      action.details.requestId === requestId &&
      action.details.response === response &&
      (action.state === "uncertain" || action.state === "acknowledged")
    ).at(-1);
    const commandId = (retryAction?.id ?? crypto.randomUUID()) as ReturnType<Crypto["randomUUID"]>;
    const traceId = new URLSearchParams(window.location.search).get("muddTrace") === "1"
      ? commandId
      : undefined;
    const actionStartedAt = performance.now();
    const requestBefore = interactionInbox?.requests.find((candidate) => candidate.requestId === requestId);
    client.pendingActions.begin({
      id: commandId,
      scope: { worldInstanceId, characterId: snapshot.character.characterId },
      details: retryAction?.details ?? {
        kind: "pvp.respond",
        requestId,
        response,
        otherCharacterName: requestBefore?.initiatorName ?? "the other player",
      },
    });
    const execution = beginForeground("combat");
    if (!execution) return;
    traceFirstFeedbackPaint(traceId, "interaction.respond", actionStartedAt);
    try {
      await client.respondToInteraction(snapshot.character.characterId, requestId, response, commandId);
      client.pendingActions.acknowledge(commandId);
      const inbox = await refreshInteractions();
      if (!inbox) return;
      const request = inbox.requests.find((candidate) => candidate.requestId === requestId);
      if (request?.status === (response === "accept" ? "accepted" : "declined")) {
        client.pendingActions.confirm(commandId);
        addEntry("system", response === "accept"
          ? `You accept ${request.initiatorName}’s challenge.`
          : `You decline ${request.initiatorName}’s challenge.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "You could not respond to that challenge.";
      if (isRejectedAction(error)) {
        client.pendingActions.reject(commandId, message);
        addEntry("error", message);
      } else {
        client.pendingActions.markUncertain(commandId, "Your response status is not confirmed yet.");
      }
    } finally {
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, client, finishForeground, interactionInbox?.requests, pending, refreshInteractions, snapshot?.character, worldInstanceId]);

  const performPvpAction = useCallback(async (
    action: "attack" | "defend" | "flee" | "use-item",
    itemId?: string,
  ) => {
    const encounter = interactionInbox?.encounter;
    if (!snapshot?.character || !encounter || pending) return;
    const execution = beginForeground("combat");
    if (!execution) return;
    try {
      const result = await client.performPvpAction(snapshot.character.characterId, encounter.encounterId, action, itemId);
      const [inbox, reconciliation] = await Promise.all([
        refreshInteractions(),
        reconcileCommand(snapshot, result),
      ]);
      const nextSnapshot = reconciliation.snapshot;
      if (!inbox) return;
      const nextEncounter = inbox.encounter;
      if (nextEncounter) {
        addEntry("narration", nextEncounter.lastNarration);
      }
      const notice = respawnNotice(result.events, nextSnapshot.location?.title ?? "the fountain");
      if (notice) addEntry("narration", notice);
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "The combat action could not be completed.");
    } finally {
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, client, finishForeground, interactionInbox?.encounter, pending, reconcileCommand, refreshInteractions, snapshot]);

  const performStaminaPostureChange = useCallback(async (posture: "rest" | "stand") => {
    if (!snapshot?.character || pending) return;
    const execution = beginForeground(posture);
    if (!execution) return;
    try {
      const response = posture === "rest"
        ? await client.rest(snapshot.character.characterId, snapshot.character.revision)
        : await client.stand(snapshot.character.characterId, snapshot.character.revision);
      await reconcileCommand(snapshot, response);
      setConnectionError("");
      addEntry("narration", posture === "rest"
        ? "You ease into a resting posture. The surface beneath you feels cool and firm; your breathing slows as nearby sounds soften."
        : "You rise, stretching the stiffness from your limbs. Your clothes rustle as your feet find steady ground.");
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "You could not change your resting posture.");
    } finally {
      finishForeground(execution);
    }
  }, [snapshot, pending, beginForeground, client, reconcileCommand, setConnectionError, addEntry, finishForeground]);

  const performInnRest = useCallback(async () => {
    if (!snapshot?.character || !snapshot.location?.inn || pending) return;
    const inn = snapshot.location.inn;
    const previousHealth = snapshot.character.health;
    const previousResources = snapshot.character.resources;
    const execution = beginForeground("rest");
    if (!execution) return;
    try {
      const response = await client.restAtInn(snapshot.character.characterId, inn.id, snapshot.character.revision);
      const { snapshot: nextSnapshot } = await reconcileCommand(snapshot, response);
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
      finishForeground(execution);
    }
  }, [snapshot, pending, beginForeground, client, reconcileCommand, setConnectionError, addEntry, finishForeground]);

  const dispatchIntent = useActionDispatch({
    snapshot, pending: pending !== null,
    listingIds: activeMerchantCatalog?.listings.map((listing) => listing.id) ?? [],
    inventory: inventoryController, talk: talkToNpc, shop: browseMerchant,
    buy: purchaseMerchantListing, fish: performFishingCast, chop: performWoodcuttingStart, move,
    attack: (id) => performCombatAction("attack", id),
    heal: (id) => performCombatAction("use-item", undefined, false, id), addEntry,
  });

  const executeCommand = useWorldCommands({
    dispatchIntent,
    addEntry,
    interactionInbox,
    respondToPlayerChallenge,
    snapshot,
    craftingCommand,
    activeDialogue,
    chooseDialogueReply,
    openDailyBoard,
    displayedDailyBoard,
    fetchDailyBoard,
    performDailyJob,
    performSupplyGather,
    beginForeground,
    client,
    refreshPartyState,
    partyInfo,
    finishForeground,
    performStaminaPostureChange,
    performInnRest,
    teamCombatInfo,
    performCombatAction,
    challengePlayer,
    talkToNpc,
    browseMerchant,
    activeMerchantCatalog,
    purchaseMerchantListing,
    changeEquipment,
    inspect,
    extinguishCampfire,
    readObject,
    lootCorpse,
    takeObject,
    takeAllObjects,
    putObject,
    performItemUse,
    performFishingCast,
    performWoodcuttingStart,
    dropObject,
    move,
    pending: pending !== null,
  });

  const submitQuickCommand = useCallback((rawCommand: string | ActionIntent) => {
    setQuickCommandMode("quick");
    setQuickCommandPage(1);
    setQuickUseItemId(null);
    if (typeof rawCommand === "string") void executeCommand(rawCommand);
    else void dispatchIntent(rawCommand);
  }, [executeCommand, dispatchIntent]);
  const submitEntityAction = (
    kind: Exclude<ActionIntent["kind"], "put" | "use" | "chop" | "unequip">,
    id: string, label: string, targetKind: EntityRef["kind"],
    display = `${kind} ${label}`,
  ) => submitQuickCommand({ kind, target: entityRef(id, label, targetKind), context: intentContext(snapshot), display });


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
      return { id: exit.id, target, label: isAmbiguous ? exit.label.trim() : direction.toLowerCase() };
    });
  }, [exits]);
  const quickLookTargets = useMemo(() => {
    return [
      ...(snapshot?.location?.objects ?? []).map(({ id, label }) => ({ id, label, kind: "object" as const })),
      ...(snapshot?.location?.npcs ?? []).map(({ id, name }) => ({ id, label: name, kind: "npc" as const })),
    ];
  }, [snapshot?.location?.npcs, snapshot?.location?.objects]);
  const itemActions = useMemo(() => selectItemActions(snapshot), [snapshot]);
  const { takeable: quickTakeableObjects, lootable: quickLootableCorpses } = itemActions;
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
  const availableClassActions = snapshot?.character?.availableClassActions ?? [];
  const currentCharacterClass = snapshot?.character?.characterClass;
  const chooseKeyboardExit = useCallback(() => {
    setQuickCommandPage(1);
    setQuickCommandMode("choose-exit");
  }, []);
  useMovementShortcuts({
    enabled: screen === "play" && !pending && !isAnyCombatActive && !hasVisiblePvp &&
      snapshot?.character?.staminaRecovery.posture !== "resting",
    modalOpen: dialogueModalOpen || Boolean(activeInteractionTarget || activeCraftingPrompt) ||
      chatFullscreen || mapFullscreen || confirmClassAdoption,
    snapshot, move, chooseExit: chooseKeyboardExit,
  });
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
  const quickUseTargetItem = quickInventory.find((item) => item.id === quickUseItemId);
  const quickUseTargetIsTree = Boolean(quickUseTargetItem?.woodcuttingAxe);
  const terminalLookTargets = useMemo<ActivityLogTarget[]>(() => {
    const location = snapshot?.location;
    if (!location) return [];
    const look: ActivityLogAction = { id: "look", label: "Look" };
    const inventory = snapshot?.character?.inventory ?? [];
    const equipment = snapshot?.character?.equipment;
    const usableItemIds = new Set(quickUseItems.map((item) => item.id));
    const usableAxes = selectUsableAxes(snapshot, quickUseItems);

    return [
      ...location.objects.map((object) => ({
        id: object.id,
        label: object.label,
        actions: [
          look,
          ...(object.label.toLocaleLowerCase() === "campfire"
            ? [{ id: "extinguish", label: "Extinguish" }]
            : []),
          ...(object.readable ? [{ id: "read", label: "Read" }] : []),
          ...(object.takeable ? [{ id: "take", label: "Take" }] : []),
        ],
      })),
      ...(snapshot?.availableWoodcuttingTrees ?? []).flatMap((tree) => {
        const treeName = tree.label.trim()
          .replace(/^(?:a|an|the)\s+/i, "")
          .replace(/\s+tree$/i, "");
        if (!treeName || !usableAxes.length) return [];
        const treeLabel = `A ${treeName} tree`;
        return [{
          id: `woodcutting-tree:${tree.id}`,
          label: treeLabel,
          actionDialogTitle: `Choose an item to use on ${treeLabel}`,
          actions: usableAxes.map((axe) => ({
            id: `use-tree:${axe.id}`,
            label: axe.label,
          })),
        }];
      }),
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
        const equippedSlot = EQUIPMENT_SLOTS.find((slot) =>
          equipment && equipmentItemIdForSlot(equipment, slot) === item.id);
        const actions: ActivityLogAction[] = [{ id: "look", label: "Look" }];
        if (item.questBound !== true && !equippedSlot) actions.push({ id: "drop", label: "Drop" });
        if (item.equipment && !equippedSlot) actions.push({ id: "equip", label: "Equip" });
        if (equippedSlot) actions.push({ id: `unequip-${equippedSlot}`, label: `Unequip ${equippedSlot}` });
        if (usableItemIds.has(item.id)) actions.push({ id: "use", label: "Use" });
        return { id: `inventory:${item.id}`, label: item.label, actions };
      }),
      { id: `room:${location.locationId}`, label: location.title, actions: [look] },
    ];
  }, [quickUseItems, snapshot]);
  const performTerminalTargetAction = (target: ActivityLogTarget & { context?: IntentContext; entityKind?: EntityRef["kind"] }, actionId: string) => {
    setActiveInteractionTarget(null);
    const context = target.context ?? intentContext(snapshot);
    const stale = () => addEntry("error", "That selection is no longer available. Choose it again.");
    if (!sameIntentContext(context, snapshot)) { stale(); return; }
    if (target.id.startsWith("woodcutting-tree:") && actionId.startsWith("use-tree:")) {
      const treeId = target.id.slice("woodcutting-tree:".length);
      const axeId = actionId.slice("use-tree:".length);
      const axe = snapshot?.character?.inventory.find((candidate) => candidate.id === axeId);
      const tree = snapshot?.availableWoodcuttingTrees?.find((candidate) => candidate.id === treeId);
      if (!axe || !tree) { stale(); return; }
      submitQuickCommand({ kind: "chop", context,
        item: entityRef(axe.id, axe.label, "inventory"), target: entityRef(tree.id, tree.label, "tree"),
        display: `use ${axe.label} on ${tree.label}` });
      return;
    }
    const inventoryId = target.id.startsWith("inventory:") ? target.id.slice("inventory:".length) : undefined;
    const item = snapshot?.character?.inventory.find((candidate) => candidate.id === inventoryId);
    if (actionId === "use" && inventoryId) {
      if (!item) { stale(); return; }
      if (item.fishingRod || item.consumable?.effect === "heal") {
        submitQuickCommand({ kind: item.fishingRod ? "fish" : "heal", context,
          target: entityRef(item.id, target.label, "inventory"), display: `use ${target.label}` });
      } else {
        setQuickUseItemId(item.id);
        setQuickCommandMode("use-target");
      }
      return;
    }
    if (actionId.startsWith("unequip-")) {
      const slot = EQUIPMENT_SLOTS.find((slot) => actionId === `unequip-${slot}`);
      if (slot && item) submitQuickCommand({ kind: "unequip", context, slot, itemId: item.id, display: `unequip ${slot}` });
      else stale();
      return;
    }
    const roomId = target.id.startsWith("room:") ? target.id.slice("room:".length) : undefined;
    const npc = snapshot?.location?.npcs?.find((npc) => npc.id === target.id);
    const reference = entityRef(inventoryId ?? roomId ?? target.id, target.label,
      target.entityKind ?? (inventoryId ? "inventory" : roomId ? "room" : npc ? "npc" : "object"));
    const kind = (["look", "read", "take", "talk", "shop", "attack", "drop", "equip", "extinguish"] as const)
      .find((kind) => kind === actionId);
    if (kind) submitQuickCommand({ kind, context, target: reference,
      display: kind === "look" && roomId ? "look" : `${kind} ${target.label}` });
  };
  const handleTerminalLookTarget = (target: ActivityLogTarget) => {
    const entityKind: EntityRef["kind"] = target.id.startsWith("inventory:") ? "inventory"
      : target.id.startsWith("room:") ? "room" : target.id.startsWith("woodcutting-tree:") ? "tree"
      : snapshot?.location?.npcs?.some((npc) => npc.id === target.id) ? "npc" : "object";
    const selection = { ...target, context: intentContext(snapshot), entityKind };
    if (target.actionDialogTitle || (target.actions?.length ?? 1) > 1) {
      setActiveInteractionTarget(selection);
      return;
    }
    performTerminalTargetAction(selection, target.actions?.[0]?.id ?? "look");
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
      mode: "look" | "read" | "drop" | "take" | "loot" | "talk" | "use" | "shop" | "buy" | "attack" | "equip" | "unequip",
      ariaLabel: string,
    ) => actions.push({ id, label: id, ariaLabel, opensMenu: true, onSelect: () => setQuickCommandMode(mode) });
    const equipment = snapshot?.character?.equipment;
    const { droppable: unequippedInventory, equipable: gearToEquip, readable: readableObjects } = itemActions;
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
    if (quickLootableCorpses.length > 0) addMode("loot", "loot", "Show corpses to loot");
    if (quickUseItems.length > 0) {
      addMode("use", "use", "Show items to use");
    }
    if ((snapshot?.location?.npcs?.length ?? 0) > 0) addMode("talk", "talk", "Show people to talk to");
    if (quickShopNpcs.length > 0) addMode("shop", "shop", "Show merchants");
    if (quickBuyListings.length > 0) addMode("buy", "buy", "Show items to buy");
    if (gearToEquip.length > 0 && visibleCombat?.status !== "active") addMode("equip", "equip", "Show gear to equip");
    if (equipment && Object.values(equipment).some(Boolean) && visibleCombat?.status !== "active") {
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
  }, [snapshot, itemActions, challengeableNpcs.length, hasVisiblePvp, isAnyCombatActive, quickBuyListings.length, quickShopNpcs.length, quickTakeableObjects.length, quickLootableCorpses, quickUseItems.length, setQuickCommandMode, canFlee, submitQuickCommand, visibleCombat, performSupplyGather]);
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
      <div className="mudd-visually-hidden" role="status" aria-label="New activity" aria-live="polite" aria-atomic="true">
        {announcement && <span key={announcement.sequence}>New activity received.</span>}
      </div>
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
                <Skeleton variant="text" width="27%" />
                <Skeleton variant="block" width="67%" height="32px" />
                <Skeleton variant="text" width="90%" />
                <Skeleton variant="text" width="61%" />
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
                  title={optimisticTravel?.preview.title ?? snapshot.location.title}
                  busy={pending !== null}
                  expandRequest={terminalExpandRequest}
                  mobileViewport={isMobileViewport}
                >
                    <div
                      className="focused-room-presence"
                      role="group"
                      aria-label="Players in this room"
                      aria-busy={Boolean(optimisticTravel)}
                    >
                      <Users size={14} aria-hidden="true" />
                      <span>
                        {!optimisticTravel && snapshot.location.occupants.length > 0
                          ? `Here now: ${snapshot.location.occupants.map((occupant) => occupant.displayName).join(", ")}`
                          : "No other players here"}
                      </span>
                      {!optimisticTravel && presenceStale && (
                        <span className="focused-room-presence__status" role="status">
                          Presence may be out of date.
                        </span>
                      )}
                    </div>
                    {(snapshot.character?.health || (snapshot.character?.wallet && snapshot.currency)) && (
                      <ProjectedVitalReadout snapshot={snapshot} client={client} />
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
                          setTerminalFollowingLatest(terminalFollowsLatestRef.current);
                          if (!terminalFollowsLatestRef.current) {
                            const rows = [...history.querySelectorAll<HTMLElement>("[data-activity-entry]")];
                            const top = history.getBoundingClientRect().top;
                            const row = rows.find((row) => row.getBoundingClientRect().bottom > top) ?? rows[0];
                            if (row?.dataset.activityEntry) {
                              terminalReadingPosition.current = { id: row.dataset.activityEntry,
                                offset: row.getBoundingClientRect().top - top };
                              setTerminalReadingAnchor(row.dataset.activityEntry);
                            }
                          } else {
                            terminalReadingPosition.current = undefined;
                            setTerminalReadingAnchor(undefined);
                          }
                          setTerminalCanScrollDown(distanceFromLatest > 32);
                        }}
                      >
                        {entries.length > 0 && (
                          <ActivityHistoryWindow
                            entries={entries}
                            label="Terminal transcript"
                            followLatest={terminalFollowingLatest}
                            readingAnchorId={terminalReadingAnchor}
                            onWindowChange={handleHistoryWindowChange}
                            currentLocationId={optimisticTravel?.preview.locationId ?? snapshot.location?.locationId}
                            lookTargets={optimisticTravel ? [] : terminalLookTargets}
                            onLookTarget={handleTerminalLookTarget}
                            actionsDisabled={pending !== null || optimisticTravel !== null}
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
                          onClick={closeMerchant}
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
                              !characterHasEquippedItem(snapshot.character!.equipment, item.id) &&
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
                  {foregroundPendingAction && (
                    <div className="focused-pending-action" data-optimistic-feedback>
                      <PendingActionStatus
                        {...pendingActionPresentation(foregroundPendingAction)}
                        className="focused-pending-action__status"
                      />
                    </div>
                  )}
                  {activeWoodcutting && (
                    <section className="focused-timed-action" aria-label="Woodcutting in progress">
                      <span role="status">
                        Chopping · {activeWoodcutting.ticksCompleted}/10
                      </span>
                      <button
                        type="button"
                        className="focused-quick-command focused-timed-action__button"
                        onClick={() => continueWoodcutting(activeWoodcutting.actionId)}
                        disabled={pending !== null}
                      >
                        Continue
                      </button>
                      <button
                        type="button"
                        className="focused-quick-command focused-timed-action__button"
                        onClick={() => void cancelWoodcuttingAction(activeWoodcutting.actionId)}
                        disabled={pending !== null}
                      >
                        Stop
                      </button>
                    </section>
                  )}
                  {activeFishingCast && (
                    <section className="focused-timed-action" aria-label="Fishing in progress">
                      <span role="status">Fishing · {activeFishingCast.ticksCompleted} seconds</span>
                      <button
                        type="button"
                        className="focused-quick-command focused-timed-action__button"
                        onClick={() => continueFishingCast(activeFishingCast.castId)}
                        disabled={pending !== null}
                      >
                        Continue
                      </button>
                      <button
                        type="button"
                        className="focused-quick-command focused-timed-action__button"
                        onClick={() => void cancelFishingCast(activeFishingCast.castId)}
                        disabled={pending !== null}
                      >
                        Stop
                      </button>
                    </section>
                  )}
                  {!mobileCommandInputOpen && !isAnyCombatActive && !visiblePvp && (
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
                  {!mobileCommandInputOpen && !isAnyCombatActive && !visiblePvp && <section className="focused-quick-commands" aria-label="Quick commands">
                    {quickCommandMode !== "quick" && (
                      <span className="focused-quick-commands__label" aria-hidden="true">
                        {quickCommandMode === "choose-exit" ? "Choose destination"
                          : quickCommandMode === "look" ? "Look"
                            : quickCommandMode === "read" ? "Read"
                              : quickCommandMode === "drop" ? "Drop"
                          : quickCommandMode === "take" ? "Take"
                            : quickCommandMode === "loot" ? "Loot"
                                  : quickCommandMode === "attack" ? "Attack"
                                  : quickCommandMode === "equip" ? "Equip"
                                    : quickCommandMode === "unequip" ? "Unequip"
                                    : quickCommandMode === "shop" ? "Shop"
                                      : quickCommandMode === "buy" ? "Buy"
                                          : quickCommandMode === "talk" ? "Talk"
                                      : quickCommandMode === "use-target" && quickUseTargetIsTree ? "Choose tree"
                                        : quickCommandMode === "use" || quickCommandMode === "use-target" ? "Use" : ""}
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
                                     : quickCommandMode === "loot" ? "Corpses to loot"
                                  : quickCommandMode === "talk" ? "People here"
                                  : quickCommandMode === "attack" ? "Available opponents"
                                : quickCommandMode === "equip" ? "Gear to equip"
                                  : quickCommandMode === "unequip" ? "Equipped gear"
                                    : quickCommandMode === "shop" ? "Merchants here"
                                      : quickCommandMode === "buy" ? "Items to buy"
                                        : quickCommandMode === "use" ? "Items to use"
                                          : quickCommandMode === "use-target"
                                            ? quickUseTargetIsTree ? "Choose a tree" : "Use target"
                                            : "Items to take"
                      }
                    >
                      {quickCommandMode === "equip" ? (
                        <>
                          <button type="button" className="focused-quick-command focused-quick-command--back" onClick={() => setQuickCommandMode("quick")} aria-label={quickReturnLabel} disabled={pending !== null}>‹</button>
                          {itemActions.equipable
                            .map((item) => (
                            <button key={item.id} type="button" className="focused-quick-command" onClick={() => submitEntityAction("equip", item.id, item.label, "inventory")} aria-label={`Equip ${item.label}`} disabled={pending !== null}>{item.label.toLocaleLowerCase()}</button>
                          ))}
                        </>
                      ) : quickCommandMode === "unequip" ? (
                        <>
                          <button type="button" className="focused-quick-command focused-quick-command--back" onClick={() => setQuickCommandMode("quick")} aria-label={quickReturnLabel} disabled={pending !== null}>‹</button>
                          {EQUIPMENT_SLOTS.filter((slot) =>
                            equipmentItemIdForSlot(snapshot.character!.equipment, slot),
                          ).map((slot) => (
                            <button key={slot} type="button" className="focused-quick-command" onClick={() => submitQuickCommand({ kind: "unequip", slot, itemId: equipmentItemIdForSlot(snapshot.character!.equipment, slot)!, context: intentContext(snapshot), display: `unequip ${slot}` })} aria-label={`Unequip ${slot}`} disabled={pending !== null}>{slot}</button>
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
                              onClick={() => submitEntityAction("go", direction.id, direction.target, "exit")}
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
                              onClick={() => submitEntityAction("look", target.id, target.label, target.kind, `look at ${target.label}`)}
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
                                  aria-label="Read bulletin"
                                  disabled={pending !== null}
                                >
                                  bulletin
                                </button>
                              )}
                              {readableObjectsForQuickActions(snapshot).map((object) => (
                                <button
                                  key={object.id}
                                  type="button"
                                  className="focused-quick-command"
                                  onClick={() => submitEntityAction("read", object.id, object.label, "object")}
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
                          {itemActions.droppable.length ? (
                            itemActions.droppable.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                className="focused-quick-command"
                                onClick={() => submitEntityAction("drop", item.id, item.label, "inventory")}
                                aria-label={`Drop ${item.label}`}
                                disabled={pending !== null}
                              >
                                {item.label.toLocaleLowerCase()}
                              </button>
                            ))
                          ) : <span className="focused-quick-commands__empty">Nothing to drop</span>}
                        </>
                      ) : quickCommandMode === "loot" ? (
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
                          {quickLootableCorpses.length ? (
                            quickLootableCorpses.map((corpse) => (
                              <button
                                key={corpse.id}
                                type="button"
                                className="focused-quick-command"
                                onClick={() => submitEntityAction("loot", corpse.id, corpse.label, "object")}
                                aria-label={`Loot ${corpse.label}`}
                                disabled={pending !== null}
                              >
                                {corpse.label.toLocaleLowerCase()}
                              </button>
                            ))
                          ) : <span className="focused-quick-commands__empty">No lootable corpses here</span>}
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
                                  onClick={() => submitEntityAction("take", object.id, object.label, "object")}
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
                                    setQuickUseItemId(item.id);
                                    setQuickCommandMode("use-target");
                                  } else if (item.consumable?.effect === "heal") {
                                    submitEntityAction(item.fishingRod ? "fish" : "heal", item.id, item.label, "inventory", `use ${item.label}`);
                                  } else {
                                    setQuickUseItemId(item.id);
                                    setQuickCommandMode("use-target");
                                  }
                                }}
                                aria-label={item.fishingRod
                                  ? `Use ${item.label} to fish at ${snapshot?.availableFishingSpots?.[0]?.label ?? "this spot"}`
                                  : item.woodcuttingAxe
                                    ? `Choose a tree for ${item.label}`
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
                            const targets = item?.woodcuttingAxe
                              ? snapshot.availableWoodcuttingTrees ?? []
                              : (snapshot.location.objects ?? []).filter((object) => !object.readable && !object.takeable);
                            return item && targets.length ? targets.map((target) => (
                              <button
                                key={target.id}
                                type="button"
                                className="focused-quick-command"
                                onClick={() => submitQuickCommand({
                                  kind: item.woodcuttingAxe ? "chop" : "use", context: intentContext(snapshot),
                                  item: entityRef(item.id, item.label, "inventory"),
                                  target: entityRef(target.id, target.label, item.woodcuttingAxe ? "tree" : "object"),
                                  display: item.woodcuttingAxe ? `use ${item.label} ${target.label}`
                                    : `use ${item.label} on ${target.label}`,
                                })}
                                aria-label={`Use ${item.label} on ${target.label}`}
                                disabled={pending !== null}
                              >
                                {target.label.toLocaleLowerCase()}
                              </button>
                            )) : <span className="focused-quick-commands__empty">
                              {item?.woodcuttingAxe
                                ? "No trees here"
                                : item ? "No usable targets here" : "Choose an item to use"}
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
                              onClick={() => submitEntityAction("attack", npc.id, npc.name, "npc")}
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
                                onClick={() => submitEntityAction("talk", npc.id, npc.name, "npc")}
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
                              onClick={() => submitEntityAction("shop", npc.id, npc.name, "npc")}
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
                                onClick={() => submitEntityAction("buy", listing.id, listing.item.label, "listing")}
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
                      title={activeInteractionTarget.actionDialogTitle}
                      options={activeInteractionTarget.actions ?? [{ id: "look", label: "Look" }]}
                      busy={pending !== null}
                      onSelect={(actionId) => performTerminalTargetAction(activeInteractionTarget, actionId)}
                      onClose={() => setActiveInteractionTarget(null)}
                    />
                  )}
                  {activeCraftingPrompt && (
                    <CraftingQuantityDialog
                      itemLabel={activeCraftingPrompt.outputLabel}
                      choices={([1, 5, 10] as const).map((quantity) => ({
                        quantity,
                        disabled: quantity > activeCraftingPrompt.maxCraftable,
                      }))}
                      busy={pending !== null}
                      onSelect={(quantity) => void selectCraftingQuantity(quantity)}
                      onClose={closeCrafting}
                    />
                  )}
                  {dialogueModalOpen && activeDialogue ? (
                    <NpcDialogueDialog
                      npcName={activeDialogue.npcName}
                      dialogue={activeDialogue.text}
                      choices={activeDialogue.choices}
                      farewellLabel={getNpcFarewellLabel(activeDialogue.npcId)}
                      busy={pending === "talk"}
                      onSelect={(choiceId) => void chooseDialogueReply(choiceId)}
                      onClose={() => void closeNpcDialogue()}
                    />
                  ) : null}
                  {isMobileViewport && (
                    <RoomChatPanel
                      realtimeClient={client}
                      actionPending={Boolean(pending)}
                      worldInstanceId={worldInstanceId}
                      characterId={snapshot.character?.characterId}
                      characterName={snapshot.character?.name || "You"}
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
                        {pending === "look" ? "Looking" : pending === "read" ? "Reading" : pending === "take" ? "Taking" : pending === "drop" ? "Dropping" : pending === "move" ? "Send" : pending === "talk" ? "Talking" : pending === "shop" ? "Browsing" : pending === "buy" ? "Buying" : pending === "combat" ? "Acting" : pending === "rest" ? "Resting" : pending === "equip" ? "Changing gear" : pending === "daily" ? "Updating jobs" : pending === "gather" ? "Gathering" : "Send"}
                      </Button>
                    </form>
                  </section>}
                </TerminalPanel>
                {!isMobileViewport && (
                  <RoomChatPanel
                    realtimeClient={client}
                    actionPending={Boolean(pending || optimisticTravel)}
                    worldInstanceId={worldInstanceId}
                    characterId={snapshot.character?.characterId}
                    characterName={snapshot.character?.name || "You"}
                    roomId={snapshot.location.locationId}
                    fullscreen={chatFullscreen}
                    onFullscreenChange={handleChatFullscreenChange}
                    onTerminalEvent={addNpcTerminalEvent}
                  />
                )}
                <WorldMapPanel
                  map={optimisticTravel && snapshot.map
                    ? { ...snapshot.map, currentLocationId: optimisticTravel.preview.locationId }
                    : snapshot.map}
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
                        {EQUIPMENT_SLOTS.map((slot) => {
                          const itemId = snapshot.character
                            ? equipmentItemIdForSlot(snapshot.character.equipment, slot)
                            : null;
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
                            const isEquipped = Boolean(snapshot.character &&
                              item.equipment && equipmentItemIdForSlot(
                                snapshot.character.equipment,
                                item.equipment.slot,
                              ) === item.id);
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
                        <div className="focused-inventory focused-inventory--compact">
                          {snapshot.character.inventory.map((item) => (
                            <div className="focused-inventory-entry focused-inventory-entry--compact" key={item.id}>
                              <button
                                type="button"
                                className="focused-inventory-item focused-inventory-item--compact"
                                aria-label={`Inspect ${item.label}${item.stackable && (item.quantity ?? 1) > 1 ? ` quantity ${item.quantity}` : ""}${item.usesRemaining !== undefined ? `, ${item.usesRemaining} uses remaining` : ""}`}
                                disabled={pending !== null}
                                onClick={() => void inspectCarriedItem(item)}
                              >
                                <span className="focused-inventory-name">{item.label}</span>
                                <span className="focused-inventory-meta">
                                  {item.stackable && (item.quantity ?? 1) > 1
                                    ? `×${item.quantity}`
                                    : item.usesRemaining !== undefined
                                      ? `${item.usesRemaining} uses`
                                      : <span aria-hidden="true">›</span>}
                                </span>
                              </button>
                              {item.equipment && (
                                <span className="focused-item-tag focused-item-tag--compact">
                                  {equipmentItemIdForSlot(snapshot.character!.equipment, item.equipment.slot) === item.id ? "Equipped" : item.equipment.slot}
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
                    <div className="focused-stat">
                      <span>Crafting</span>
                      <strong>
                        Level {snapshot.character?.crafting?.level ?? 1} · {((snapshot.character?.crafting?.experienceHundredths ?? 0) / 100).toFixed(2).replace(/\.?0+$/, "")} XP
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
                                    {quest.branch ? (
                                      <div className="focused-quest-branch">
                                        <p className="focused-quest-summary">
                                          <strong>{quest.outcome ? "Outcome: " : "Current path: "}</strong>
                                          {quest.outcome ? quest.outcome.label : quest.branch.label}
                                        </p>
                                        {quest.outcome ? <p className="focused-quest-summary">{quest.outcome.summary}</p> : null}
                                        {quest.decisions?.length ? (
                                          <p className="focused-quest-summary">
                                            <strong>Your decisions: </strong>
                                            {quest.decisions.map((decision) => decision.label).join("; ")}
                                          </p>
                                        ) : null}
                                        {quest.availableChoices?.length ? (
                                          <>
                                            <p className="focused-quest-summary"><strong>Decisions you can make now:</strong></p>
                                            <ul className="focused-quest-objectives">
                                              {quest.availableChoices.map((choice) => (
                                                <li className="focused-quest-objective" key={choice.choiceId}>
                                                  <span>{choice.label}{choice.npcName ? ` — speak with ${choice.npcName}` : ""}</span>
                                                </li>
                                              ))}
                                            </ul>
                                          </>
                                        ) : null}
                                        {quest.worldOutcomes?.map((outcome) => (
                                          <p className="focused-quest-summary" key={outcome.key}>
                                            <strong>Settled in this world: </strong>{outcome.label}
                                          </p>
                                        ))}
                                      </div>
                                    ) : null}
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
                  const character = snapshot?.character;
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
                            (!character?.equipment || !characterHasEquippedItem(character.equipment, item.id))
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
                  <ActivityHistoryWindow entries={entries} reverse label="Field notes" />
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
            <Suspense fallback={<p role="status">Loading the Codex…</p>}>
              <CodexScreen />
            </Suspense>
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
