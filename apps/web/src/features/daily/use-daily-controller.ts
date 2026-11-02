import { useCallback, useEffect, useRef, useState } from "react";
import type { MuddHttpClient, GameSnapshot, CommandResponse } from "@mudd/client-sdk";
import { type ControllerOptions, roomContext } from "../controller-options.js";
import { useRequestScope } from "../session/use-request-scope.js";
export type MutationRefresh = (
  message: string, command?: { base: GameSnapshot; response: CommandResponse },
  announceQuestObjectives?: boolean, traceId?: string, accepts?: () => boolean,
) => Promise<GameSnapshot>;

export function useDailyController({
  client, snapshot, pending, beginForeground, finishForeground, refreshGate, addEntry,
  worldInstanceId, refreshAfterMutation, loadGame,
}: ControllerOptions & { worldInstanceId: string; refreshAfterMutation: MutationRefresh; loadGame(): Promise<void> }) {
  const identity = roomContext(snapshot) + JSON.stringify(snapshot?.dailyActivities?.boards.map((board) => board.id));
  const scope = useRequestScope(identity, refreshGate, client);
  const mutationScope = useRequestScope(identity, refreshGate, client);
  const [dailyBoard, setDailyBoard] = useState<Awaited<ReturnType<MuddHttpClient["dailyBoard"]>> | null>(null);
  const [dailyBoardContext, setDailyBoardContext] = useState<{
    characterId: string;
    locationId: string;
    worldInstanceId: string;
  } | null>(null);
  const [dailyBoardLoading, setDailyBoardLoading] = useState(false);
  const [dailyBoardError, setDailyBoardError] = useState("");
  const [pendingDailyJobId, setPendingDailyJobId] = useState<string>();
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
    const accepts = scope.begin(true);
    if (!accepts) return null;
    const requestId = ++dailyBoardRequestIdRef.current;
    setDailyBoardLoading(true);
    setDailyBoardError("");
    try {
      const board = await client.dailyBoard(requestContext.characterId, boardId);
      if (!accepts()) return null;
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
      if (!accepts() || requestId !== dailyBoardRequestIdRef.current) return null;
      const message = error instanceof Error ? error.message : "The daily bulletin could not be reached.";
      setDailyBoardError(message);
      throw error;
    } finally {
      if (scope.alive && requestId === dailyBoardRequestIdRef.current) setDailyBoardLoading(false);
    }
  }, [client, scope]);

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
    const accepts = mutationScope.begin(true);
    if (!accepts) return null;
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
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : "The daily bulletin could not be reached.");
      return null;
    }
  }, [addEntry, fetchDailyBoard, snapshot?.character?.characterId, snapshot?.dailyActivities?.boards, snapshot?.dailyActivities?.sources, mutationScope]);

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
    const execution = beginForeground("daily");
    if (!execution) return;
    const accepts = mutationScope.begin(true);
    if (!accepts) { finishForeground(execution); return; }
    setPendingDailyJobId(jobId);
    try {
      const response = await client.dailyJob(snapshot.character.characterId, snapshot.character.revision, {
        boardId: board.boardId,
        cycle: board.cycle,
        jobId,
        action,
      });
      if (!accepts()) return;
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
      if (!accepts()) return;
      const updatedSnapshot = await refreshAfterMutation(message, { base: snapshot, response }, false, undefined, accepts);
      if (!accepts()) return;
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
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : `You could not ${action} that posting.`);
    } finally {
      if (accepts()) setPendingDailyJobId(undefined);
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, client, fetchDailyBoard, finishForeground, pending, refreshAfterMutation, snapshot, mutationScope]);

  const performSupplyGather = useCallback(async (sourceId: string, label: string) => {
    if (!snapshot?.character || pending) return;
    const cycle = snapshot.dailyActivities?.cycle;
    if (!cycle) {
      addEntry("error", "Daily supply gathering is not available right now.");
      return;
    }
    const execution = beginForeground("gather");
    if (!execution) return;
    const accepts = mutationScope.begin(true);
    if (!accepts) { finishForeground(execution); return; }
    try {
      const response = await client.gatherSupply(snapshot.character.characterId, snapshot.character.revision, sourceId, cycle);
      if (!accepts()) return;
      const updatedSnapshot = await refreshAfterMutation(`Gathered supplies at ${label}.`, { base: snapshot, response }, false, undefined, accepts);
      if (!accepts()) return;
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
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : "You could not gather that supply.");
    } finally {
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, client, dailyBoard, fetchDailyBoard, finishForeground, pending, refreshAfterMutation, snapshot, mutationScope]);

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
  }, [dailyBoardContext, displayedDailyBoard, fetchDailyBoard, loadGame]);

  const closeDailyBoard = useCallback(() => {
    scope.invalidate();
    mutationScope.invalidate();
    dailyBoardRequestIdRef.current += 1;
    setDailyBoard(null);
    setDailyBoardContext(null);
    setDailyBoardError("");
    setDailyBoardLoading(false);
    setPendingDailyJobId(undefined);
  }, [scope, mutationScope]);


  return { displayedDailyBoard, dailyBoardLoading, dailyBoardError, pendingDailyJobId,
    fetchDailyBoard, openDailyBoard, performDailyJob, performSupplyGather,
    handleDailyJobAction, closeDailyBoard };
}
