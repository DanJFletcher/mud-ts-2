import type { useCommerceController } from "../features/commerce/use-commerce-controller.js";
import {
  MuddHttpClient,
  type GameSnapshot,
  type PendingAction
} from "@mudd/client-sdk";
import type { InteractionInbox } from "@mudd/contracts";
import {
  ActivityHistoryWindow,
  Button,
  DailyBoard,
  NavigationControls,
  Panel,
  PendingActionStatus,
  Skeleton,
  Text,
  TextInput,
  type ActivityEntry,
  type ActivityLogTarget
} from "@mudd/ui";
import { ChevronDown, Coins, Heart, Sparkles, Users, Zap } from "lucide-react";
import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import {
  useEffect,
  useState,
  type FormEvent
} from "react";
import { RoomChatPanel, type RoomChatMessage } from "./panels/RoomChatPanel.js";
import { TerminalPanel } from "./panels/TerminalPanel.js";
import { WorldMapPanel } from "./panels/WorldMapPanel.js";
import type { useDailyController } from "../features/daily/use-daily-controller.js";
import type { useTravelController } from "../features/travel/use-travel-controller.js";
import type { QuickMode } from "./view-types.js";

function ProjectedVitalReadout({ snapshot, client }: { snapshot: GameSnapshot; client: MuddHttpClient; }) {
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
export interface PlayScreenProps {
  session: {
    loading: boolean;
    snapshot: GameSnapshot | null;
    connectionError: string;
    loadGame: () => Promise<void>;
    handleLeaveWorld: () => Promise<void>;
    leaving: boolean;
    optimisticTravel: ReturnType<typeof useTravelController>["optimisticTravel"];
    pending: string | null;
    presenceStale: boolean;
    client: MuddHttpClient;
    worldInstanceId: string;
  };
  history: {
    terminalHistoryRef: RefObject<HTMLDivElement | null>;
    terminalFollowsLatestRef: RefObject<boolean>;
    setTerminalFollowingLatest: Dispatch<SetStateAction<boolean>>;
    terminalReadingPosition: RefObject<{ id: string; offset: number ;} | undefined>;
    setTerminalReadingAnchor: Dispatch<SetStateAction<string | undefined>>;
    setTerminalCanScrollDown: Dispatch<SetStateAction<boolean>>;
    entries: readonly ActivityEntry[];
    terminalFollowingLatest: boolean;
    terminalReadingAnchor: string | undefined;
    handleHistoryWindowChange: (latest: boolean) => void;
    terminalLookTargets: ActivityLogTarget[];
    handleTerminalLookTarget: (target: ActivityLogTarget) => void;
    terminalCanScrollDown: boolean;
    scrollTerminalToLatest: () => void;
  };
  gathering: {
    activeWoodcutting: NonNullable<GameSnapshot["character"]>["activeWoodcutting"];
    continueWoodcutting: (id: string) => void;
    cancelWoodcuttingAction: (actionId: string) => Promise<void>;
    activeFishingCast: NonNullable<GameSnapshot["character"]>["activeFishing"];
    continueFishingCast: (id: string) => void;
    cancelFishingCast: (castId: string) => Promise<void>;
  };
  daily: {
    displayedDailyBoard: ReturnType<typeof useDailyController>["displayedDailyBoard"];
    activeDailyBoardId?: string;
    dailyBoardLoading: boolean;
    dailyBoardError: string;
    pendingDailyJobId: string | undefined;
    fetchDailyBoard: ReturnType<typeof useDailyController>["fetchDailyBoard"];
    closeDailyBoard: () => void;
    handleDailyJobAction: (jobId: string, action: "accept" | "deliver") => void;
  };
  slots: {
    merchantPanel: ReactNode;
    combatPanel: ReactNode;
    quickCommands: ReactNode;
    dialogs: ReactNode;
  };
  view: {
    terminalExpandRequest: number;
    isMobileViewport: boolean;
    isAnyCombatActive: boolean;
    visiblePvp: InteractionInbox["encounter"] | undefined;
    activeMerchantCatalog: ReturnType<typeof useCommerceController>["activeMerchantCatalog"];
    foregroundPendingAction: PendingAction | undefined;
    mobileCommandInputOpen: boolean;
    exits: NonNullable<GameSnapshot["location"]>["exits"];
    move: (exitId: string) => Promise<void>;
    setQuickCommandPage: Dispatch<SetStateAction<number>>;
    setQuickCommandMode: Dispatch<SetStateAction<QuickMode>>;
    chatFullscreen: boolean;
    handleChatFullscreenChange: (fullscreen: boolean) => void;
    addNpcTerminalEvent: (message: RoomChatMessage) => void;
    submitCommand: (event: FormEvent<HTMLFormElement>) => void;
    command: string;
    setCommand: Dispatch<SetStateAction<string>>;
    mapFullscreen: boolean;
    handleMapFullscreenChange: (fullscreen: boolean) => void;
  };
}
export function PlayScreen({ session, history, gathering, daily, slots, view }: PlayScreenProps) {
  const { loading, snapshot, connectionError, loadGame, handleLeaveWorld, leaving, optimisticTravel, pending, presenceStale, client, worldInstanceId } = session;
  const { terminalHistoryRef, terminalFollowsLatestRef, setTerminalFollowingLatest, terminalReadingPosition, setTerminalReadingAnchor, setTerminalCanScrollDown, entries, terminalFollowingLatest, terminalReadingAnchor, handleHistoryWindowChange, terminalLookTargets, handleTerminalLookTarget, terminalCanScrollDown, scrollTerminalToLatest } = history;
  const { activeWoodcutting, continueWoodcutting, cancelWoodcuttingAction, activeFishingCast, continueFishingCast, cancelFishingCast } = gathering;
  const { displayedDailyBoard, activeDailyBoardId, dailyBoardLoading, dailyBoardError, pendingDailyJobId, fetchDailyBoard, closeDailyBoard, handleDailyJobAction } = daily;
  const { merchantPanel, combatPanel, quickCommands, dialogs } = slots;
  const { terminalExpandRequest, isMobileViewport, isAnyCombatActive, visiblePvp, activeMerchantCatalog, foregroundPendingAction, mobileCommandInputOpen, exits, move, setQuickCommandPage, setQuickCommandMode, chatFullscreen, handleChatFullscreenChange, addNpcTerminalEvent, submitCommand, command, setCommand, mapFullscreen, handleMapFullscreenChange } = view;
  return (<div className="focused-screen focused-screen--play" aria-label="Play">
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
                    terminalReadingPosition.current = {
                      id: row.dataset.activityEntry,
                      offset: row.getBoundingClientRect().top - top
                    };
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
            <>{merchantPanel}</>
          ) : null}
          {<>{combatPanel}</>}
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
          {!mobileCommandInputOpen && !isAnyCombatActive && !visiblePvp && <>{quickCommands}</>}
          {(displayedDailyBoard || dailyBoardLoading || dailyBoardError) && (
            <DailyBoard
              name={displayedDailyBoard?.name ?? snapshot?.dailyActivities?.boards.find((board) => board.id === activeDailyBoardId)?.name ?? "Daily bulletin"}
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
                const boardId = displayedDailyBoard?.boardId ?? activeDailyBoardId;
                if (boardId) void fetchDailyBoard(boardId).catch(() => undefined);
              }}
              onClose={closeDailyBoard}
              onAccept={(jobId) => handleDailyJobAction(jobId, "accept")}
              onDeliver={(jobId) => handleDailyJobAction(jobId, "deliver")}
            />
          )}
          {dialogs}
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
                readOnly={pending !== null}
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

  </div>);
}
