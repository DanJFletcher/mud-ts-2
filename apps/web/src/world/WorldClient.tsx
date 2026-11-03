import {
  MuddHttpClient,
  type CommandResponse,
  type GameSnapshot
} from "@mudd/client-sdk";
import {
  EQUIPMENT_SLOTS,
  equipmentItemIdForSlot,
  FLEE_STAMINA_COST
} from "@mudd/contracts";
import {
  Button,
  Panel,
  Text,
  type ActivityEntry,
  type ActivityLogAction,
  type ActivityLogTarget
} from "@mudd/ui";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type TouchEvent as ReactTouchEvent
} from "react";
import { type RoomChatMessage } from "./screens/panels/RoomChatPanel.js";
import { entityRef,intentContext,sameIntentContext,type ActionIntent,type EntityRef,type IntentContext } from "./commands/intents.js";
import { useActionDispatch } from "./commands/use-action-dispatch.js";
import { useWorldCommands } from "./commands/use-world-commands.js";
import { useCombatController } from "./features/combat/use-combat-controller.js";
import { useCommerceController } from "./features/commerce/use-commerce-controller.js";
import { useDailyController } from "./features/daily/use-daily-controller.js";
import { useDialogueController } from "./features/dialogue/use-dialogue-controller.js";
import { useFishingController } from "./features/gathering/use-fishing-controller.js";
import { useWoodcuttingController } from "./features/gathering/use-woodcutting-controller.js";
import { useActivityHistory } from "./features/history/use-activity-history.js";
import { selectItemActions,selectUsableAxes } from "./features/inventory/action-selectors.js";
import { useInventoryController } from "./features/inventory/use-inventory-controller.js";
import { useMovementShortcuts } from "./features/keyboard/use-movement-shortcuts.js";
import { useWorldNavigation } from "./features/navigation/world-navigation.js";
import { ForegroundExecution,type ExecutionToken } from "./session/foreground-execution.js";
import { useSocialController } from "./features/social/use-social-controller.js";
import { useTravelController } from "./features/travel/use-travel-controller.js";
import { CodexPage } from "./screens/CodexPage.js";
import { CombatPanel } from "./screens/CombatPanel.js";
import { FieldNotesScreen } from "./screens/FieldNotesScreen.js";
import { InfoTabs } from "./screens/InfoTabs.js";
import { InventoryScreen } from "./screens/InventoryScreen.js";
import { MerchantPanel } from "./screens/MerchantPanel.js";
import { PlayScreen } from "./screens/PlayScreen.js";
import { QuickCommands } from "./screens/QuickCommands.js";
import { StatsScreen } from "./screens/StatsScreen.js";
import { VitalsScreen } from "./screens/VitalsScreen.js";
import { WorldDialogs } from "./screens/WorldDialogs.js";
import { WorldNavigation } from "./screens/WorldNavigation.js";
import { useGameSession } from "./session/use-game-session.js";

type ClassCatalogSummary = NonNullable<Awaited<ReturnType<MuddHttpClient["getWorlds"]>>[number]["classCatalog"]>;

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

function makeEntry(kind: ActivityEntry["kind"], text: string, locationId?: string): ActivityEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind,
    text,
    ...(locationId ? { locationId } : {}),
  };
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

function WorldSession({ client: suppliedClient, ...props }: WorldClientProps & { worldInstanceId: string; }) {
  const [ownedClient] = useState(() => new MuddHttpClient({
    worldInstanceId: props.worldInstanceId,
    basePath: import.meta.env.BASE_URL,
    commandProjection: "game",
    readableActions: true,
  }));
  const client = suppliedClient ?? ownedClient;
  const session = useGameSession(client);
  // The first loaded character belongs to this entry. Later replacements dispose
  // all feature state, timers and subscriptions by replacing the composition.
  const identity = useRef<{ characterId?: string; generation: number; }>({ generation: 0 });
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
  const actionTiming = useRef<{ name: string; started: number; } | null>(null);
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
  const selectedReadAction = useRef<EntityRef["readAction"]>(undefined);
  const [activeInteractionTarget, setActiveInteractionTarget] = useState<(ActivityLogTarget & { context?: IntentContext; entityKind?: EntityRef["kind"]; }) | null>(null);
  const [leaving, setLeaving] = useState(false);
  const { screen, theme, menuOpen, setMenuOpen, contentRef, navMenuRef, navMenuTriggerRef, toggleTheme } = useWorldNavigation();
  const [mobileCommandInputOpen, setMobileCommandInputOpen] = useState(false);
  const [terminalExpandRequest, setTerminalExpandRequest] = useState(0);
  const [terminalCanScrollDown, setTerminalCanScrollDown] = useState(false);
  const [chatFullscreen, setChatFullscreen] = useState(false);
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const terminalHistoryRef = useRef<HTMLDivElement>(null);
  const terminalFollowsLatestRef = useRef(true);
  const [terminalFollowingLatest, setTerminalFollowingLatest] = useState(true);
  const [terminalReadingAnchor, setTerminalReadingAnchor] = useState<string>();
  const terminalReadingPosition = useRef<{ id: string; offset: number; } | undefined>(undefined);
  const lastRoomLookIdRef = useRef<string | null>(null);
  const knownQuestObjectiveCompletionsRef = useRef<Set<string>>(new Set());
  const swipeStartRef = useRef<{ x: number; y: number; } | null>(null);
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

  useEffect(() => { setMobileCommandInputOpen(false); }, [screen]);

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
    command?: { base: GameSnapshot; response: CommandResponse; },
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
    displayedDailyBoard, activeDailyBoardId, dailyBoardLoading, dailyBoardError, pendingDailyJobId,
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

  const { performCombatAction, performClassAbility, adoptCharacterClass, challengePlayer, respondToPlayerChallenge, performPvpAction, performStaminaPostureChange, performInnRest } = useCombatController({
    client, snapshot, beginForeground, finishForeground, reconcileCommand, setSnapshot, setConnectionError, addEntry, worldInstanceId, partyInfo, teamCombatInfo, interactionInbox, refreshPartyState, refreshTeamCombat, refreshInteractions, knownInteractionIds, classChoiceId, setClassChoiceId, confirmClassAdoption, setConfirmClassAdoption, pending: pending !== null,
  });

  const dispatchIntent = useActionDispatch({
    snapshot, pending: pending !== null, openDailyBoard,
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
  ) => submitQuickCommand({ kind, target: entityRef(id, label, targetKind,
    kind === "read" ? snapshot?.location?.objects.find((object) => object.id === id)?.readAction ?? null : undefined),
    context: intentContext(snapshot), display });

  const submitCommand = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!command.trim() || pending) return;
    const value = command;
    setCommand("");
    void executeCommand(value);
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
    modalOpen: Boolean(displayedDailyBoard || dailyBoardLoading || dailyBoardError) || dialogueModalOpen || Boolean(activeInteractionTarget || activeCraftingPrompt) ||
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
  const performTerminalTargetAction = (target: ActivityLogTarget & { context?: IntentContext; entityKind?: EntityRef["kind"]; }, actionId: string) => {
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
      submitQuickCommand({
        kind: "chop", context,
        item: entityRef(axe.id, axe.label, "inventory"), target: entityRef(tree.id, tree.label, "tree"),
        display: `use ${axe.label} on ${tree.label}`
      });
      return;
    }
    const inventoryId = target.id.startsWith("inventory:") ? target.id.slice("inventory:".length) : undefined;
    const item = snapshot?.character?.inventory.find((candidate) => candidate.id === inventoryId);
    if (actionId === "use" && inventoryId) {
      if (!item) { stale(); return; }
      if (item.fishingRod || item.consumable?.effect === "heal") {
        submitQuickCommand({
          kind: item.fishingRod ? "fish" : "heal", context,
          target: entityRef(item.id, target.label, "inventory"), display: `use ${target.label}`
        });
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
      target.entityKind ?? (inventoryId ? "inventory" : roomId ? "room" : npc ? "npc" : "object"),
      actionId === "read" ? selectedReadAction.current : undefined);
    const kind = (["look", "read", "take", "talk", "shop", "attack", "drop", "equip", "extinguish"] as const)
      .find((kind) => kind === actionId);
    if (kind) submitQuickCommand({
      kind, context, target: reference,
      display: kind === "look" && roomId ? "look" : `${kind} ${target.label}`
    });
  };
  const handleTerminalLookTarget = (target: ActivityLogTarget) => {
    const entityKind: EntityRef["kind"] = target.id.startsWith("inventory:") ? "inventory"
      : target.id.startsWith("room:") ? "room" : target.id.startsWith("woodcutting-tree:") ? "tree"
        : snapshot?.location?.npcs?.some((npc) => npc.id === target.id) ? "npc" : "object";
    const selection = { ...target, context: intentContext(snapshot), entityKind };
    selectedReadAction.current = entityKind === "object"
      ? snapshot?.location?.objects.find((object) => object.id === target.id)?.readAction ?? null : undefined;
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
    <InfoTabs
      view={{ screen, setMenuOpen }}
    />
  );

  const quickCommands = snapshot?.location ? (<QuickCommands
    selection={{ quickCommandMode, quickUseTargetIsTree, setQuickCommandMode, setQuickUseItemId, quickUseItemId, setQuickCommandPage }}
    targets={{ itemActions, quickDirections, quickLookTargets, quickLootableCorpses, quickTakeableObjects, quickUseItems, challengeableNpcs, quickShopNpcs, activeMerchantCatalog, quickBuyListings }}
    pagination={{ visibleQuickCommandPage, visibleQuickCommandItems, quickCommandPages }}
    actions={{ submitEntityAction, submitQuickCommand, performFishingCast }}
    view={{ quickReturnLabel, pending, snapshot, isAnyCombatActive }}
  />) : null;
  const combatPanel = snapshot?.location ? (<CombatPanel
    combat={{ visiblePvp, isPvpTurn, availableClassActions, activeTeamCombat, isTeamCombatTurn, canFlee, visibleCombat }}
    inventory={{ quickInventory, snapshot, quickUseItems }}
    actions={{ performPvpAction, performClassAbility, performCombatAction }}
    view={{ pending, combatUseMenuOpen, setCombatUseMenuOpen }}
  />) : null;
  const merchantPanel = activeMerchantCatalog && snapshot?.location ? (<MerchantPanel
    activeMerchantCatalog={activeMerchantCatalog} closeMerchant={closeMerchant} pending={pending} purchaseMerchantListing={purchaseMerchantListing}
  />) : null;
  const dialogs = <WorldDialogs
    interaction={{ activeInteractionTarget, performTerminalTargetAction, setActiveInteractionTarget }}
    crafting={{ activeCraftingPrompt, selectCraftingQuantity, closeCrafting }}
    dialogue={{ dialogueModalOpen, activeDialogue, chooseDialogueReply, closeNpcDialogue }}
    view={{ pending }}
  />;
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
          <PlayScreen
            session={{ loading, snapshot, connectionError, loadGame, handleLeaveWorld, leaving, optimisticTravel, pending, presenceStale, client, worldInstanceId }}
            history={{ terminalHistoryRef, terminalFollowsLatestRef, setTerminalFollowingLatest, terminalReadingPosition, setTerminalReadingAnchor, setTerminalCanScrollDown, entries, terminalFollowingLatest, terminalReadingAnchor, handleHistoryWindowChange, terminalLookTargets, handleTerminalLookTarget, terminalCanScrollDown, scrollTerminalToLatest }}
            gathering={{ activeWoodcutting, continueWoodcutting, cancelWoodcuttingAction, activeFishingCast, continueFishingCast, cancelFishingCast }}
            daily={{ displayedDailyBoard, activeDailyBoardId, dailyBoardLoading, dailyBoardError, pendingDailyJobId, fetchDailyBoard, closeDailyBoard, handleDailyJobAction }}
            slots={{ merchantPanel, combatPanel, quickCommands, dialogs }}
            view={{ terminalExpandRequest, isMobileViewport, isAnyCombatActive, visiblePvp, activeMerchantCatalog, foregroundPendingAction, mobileCommandInputOpen, exits, move, setQuickCommandPage, setQuickCommandMode, chatFullscreen, handleChatFullscreenChange, addNpcTerminalEvent, submitCommand, command, setCommand, mapFullscreen, handleMapFullscreenChange }}
          />
        )}

        {!isGameOver && screen === "vitals" && (
          <VitalsScreen
            infoTabs={infoTabs} snapshot={snapshot} loading={loading}
          />
        )}

        {!isGameOver && (screen === "items" || screen === "equipment") && (
          <InventoryScreen
            screen={screen} infoTabs={infoTabs} snapshot={snapshot} pending={pending} isAnyCombatActive={isAnyCombatActive} changeEquipment={changeEquipment} inspectCarriedItem={inspectCarriedItem} inspectedCarriedItem={inspectedCarriedItem} inventoryInspectError={inventoryInspectError} loading={loading}
          />
        )}

        {!isGameOver && screen === "stats" && (
          <StatsScreen
            infoTabs={infoTabs} snapshot={snapshot} currentCharacterClass={currentCharacterClass} classCatalogError={classCatalogError} isAnyCombatActive={isAnyCombatActive} visiblePvp={visiblePvp} classCatalog={classCatalog} classChoiceId={classChoiceId} setClassChoiceId={setClassChoiceId} setConfirmClassAdoption={setConfirmClassAdoption} pending={pending} confirmClassAdoption={confirmClassAdoption} adoptCharacterClass={adoptCharacterClass} loading={loading}
          />
        )}

        {!isGameOver && screen === "notes" && (
          <FieldNotesScreen
            infoTabs={infoTabs} entries={entries} snapshot={snapshot} collapsedQuestGroups={collapsedQuestGroups} setCollapsedQuestGroups={setCollapsedQuestGroups} collapsedQuestCards={collapsedQuestCards} setCollapsedQuestCards={setCollapsedQuestCards}
          />
        )}

        {!isGameOver && screen === "codex" && (
          <CodexPage
            infoTabs={infoTabs}
          />
        )}
      </section>

      {!isGameOver && (
        <WorldNavigation
          navigation={{ screen, setMenuOpen, navMenuRef, navMenuTriggerRef, menuOpen, toggleTheme, theme }}
          actions={{ handleLeaveWorld, leaving }}
          commandInput={{ mobileCommandInputOpen, setMobileCommandInputOpen, setTerminalExpandRequest }}
          view={{ snapshot, isAnyCombatActive, visiblePvp }}
        />
      )}
    </main>
  );
}
