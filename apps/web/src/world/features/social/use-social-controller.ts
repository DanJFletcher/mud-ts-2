import { useCallback, useEffect, useRef, useState } from "react";
import type { MuddHttpClient, GameSnapshot } from "@mudd/client-sdk";
import type { InteractionInbox } from "@mudd/contracts";
import type { ActivityEntry } from "@mudd/ui";
import type { useGameSession } from "../../session/use-game-session.js";
import { useRequestScope } from "../../session/use-request-scope.js";

type Options = {
  client: MuddHttpClient;
  snapshot: GameSnapshot | null;
  refreshGate: ReturnType<typeof useGameSession>["refreshGate"];
  addEntry(kind: ActivityEntry["kind"], text: string, preserveScroll?: boolean): string;
};
export function useSocialController({ client, snapshot, refreshGate, addEntry }: Options) {
  const playerId = snapshot?.player.id;
  const identity = JSON.stringify([snapshot?.character?.worldInstanceId, snapshot?.character?.characterId]);
  const partyScope = useRequestScope(identity, refreshGate, client);
  const teamScope = useRequestScope(identity, refreshGate, client);
  const interactionScope = useRequestScope(identity, refreshGate, client);
  const [interactionInbox, setInteractionInbox] = useState<InteractionInbox | null>(null);
  const [partyInfo, setPartyInfo] = useState<Awaited<ReturnType<MuddHttpClient["getPartyInfo"]>> | null>(null);
  const partyPollingIntervalRef = useRef(partyInfo?.party ? 3_000 : 9_000);
  partyPollingIntervalRef.current = partyInfo?.party ? 3_000 : 9_000;
  const [teamCombatInfo, setTeamCombatInfo] = useState<Awaited<ReturnType<MuddHttpClient["getTeamCombatInfo"]>> | null>(null);
  const teamPollingActive = useRef(false);
  teamPollingActive.current = Boolean(partyInfo?.party || teamCombatInfo?.encounter?.status === "active");
  const knownInteractionStatusesRef = useRef<Map<string, string>>(new Map());
  const knownPvpUpdateRef = useRef<string | null>(null);
  const knownPartyRevisionRef = useRef<number | null>(null);
  const presenceCharacterId = snapshot?.character &&
    snapshot.character.health?.current !== 0 &&
    snapshot.character.combat?.status !== "defeat"
    ? snapshot.character.characterId
    : null;

  const refreshInteractions = useCallback(async (background = false) => {
    if (!presenceCharacterId) return null;
    const accepts = interactionScope.begin(!background);
    if (!accepts) return null;
    try {
      const inbox = await client.getInteractionInbox();
      if (!accepts()) return null;
        for (const request of inbox.requests) {
          const previous = knownInteractionStatusesRef.current.get(request.requestId);
          if (background && previous === undefined) {
            if (request.status === "pending" && request.recipientCharacterId === presenceCharacterId) {
              addEntry("system", `${request.initiatorName} challenges you. Use “accept ${request.requestId}” or “decline ${request.requestId}”.`, true);
            }
          } else if (background && previous !== request.status) {
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
        if (background && encounter && pvpUpdateKey !== knownPvpUpdateRef.current) {
          addEntry("narration", encounter.lastNarration, true);
        }
        knownPvpUpdateRef.current = pvpUpdateKey;
        setInteractionInbox(inbox);
      return inbox;
    } catch (error) {
      if (!accepts() || background) return null;
      throw error;
    }
  }, [client, presenceCharacterId, interactionScope, addEntry]);
  useEffect(() => {
    if (!presenceCharacterId) { setInteractionInbox(null); knownInteractionStatusesRef.current.clear(); return; }
    let active = true;
    let running = false;
    const refresh = async () => {
      if (!active || running || document.visibilityState === "hidden") return;
      running = true;
      try { await refreshInteractions(true); } finally { running = false; }
    };
    void refresh();
    const stop = client.watchRealtime("interactions", refresh, 3_000, () => !refreshGate.busy);
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; stop(); document.removeEventListener("visibilitychange", visible); };
  }, [client, presenceCharacterId, refreshInteractions, refreshGate]);
  const refreshPartyState = useCallback(async (preserveTerminalScroll = false) => {
    if (!presenceCharacterId) return null;
    if (preserveTerminalScroll && refreshGate.busy) return null;
    const accepts = partyScope.begin(!preserveTerminalScroll);
    if (!accepts) return null;
    const previousRevision = knownPartyRevisionRef.current;
    let next: Awaited<ReturnType<MuddHttpClient["getPartyInfo"]>>;
    try { next = await client.getPartyInfo(presenceCharacterId, previousRevision ?? undefined); }
    catch (error) { if (!accepts()) return null; throw error; }
    if (!accepts()) return null;
    if (previousRevision !== null) {
      for (const activity of next.activity) {
        if (activity.playerId === playerId) continue;
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
  }, [addEntry, client, presenceCharacterId, refreshGate, playerId, partyScope]);

  const refreshTeamCombat = useCallback(async (background = false) => {
    if (!presenceCharacterId) return null;
    const accepts = teamScope.begin(!background);
    if (!accepts) return null;
    let next: Awaited<ReturnType<MuddHttpClient["getTeamCombatInfo"]>>;
    try { next = await client.getTeamCombatInfo(presenceCharacterId); }
    catch (error) { if (!accepts()) return null; throw error; }
    if (!accepts()) return null;
    setTeamCombatInfo(next);
    return next;
  }, [client, presenceCharacterId, teamScope]);

  useEffect(() => {
    if (!presenceCharacterId) {
      setTeamCombatInfo(null);
      return;
    }
    let active = true;
    let requestRunning = false;
    let lastChecked = 0;
    const poll = async () => {
      if (!active || requestRunning || document.visibilityState === "hidden" || refreshGate.busy) return;
      if (!teamPollingActive.current && Date.now() - lastChecked < 6_000) return;
      lastChecked = Date.now();
      requestRunning = true;
      try {
        await refreshTeamCombat(true);
      } catch {
        // Keep the last known encounter while the connection recovers.
      } finally {
        requestRunning = false;
      }
    };
    void poll();
    const stopTeam = client.watchRealtime("team", () => { lastChecked = 0; return poll(); }, 2_000,
      () => !refreshGate.busy);
    return () => {
      active = false;
      stopTeam();
    };
  }, [client, presenceCharacterId, refreshGate, refreshTeamCombat]);

  useEffect(() => {
    if (!presenceCharacterId) {
      setPartyInfo(null);
      knownPartyRevisionRef.current = null;
      return;
    }
    knownPartyRevisionRef.current = null;
    let active = true;
    let requestRunning = false;
    let lastChecked = 0;
    const pollParty = async (force = false) => {
      if (!active || document.visibilityState === "hidden" || requestRunning) return;
      if (
        !force &&
        client.realtimeConnectionState !== "connected" &&
        Date.now() - lastChecked < partyPollingIntervalRef.current
      ) return;
      requestRunning = true;
      lastChecked = Date.now();
      try {
        await refreshPartyState(true);
      } catch {
        // Party notifications are optional; keep the last known terminal state.
      } finally {
        requestRunning = false;
      }
    };
    void pollParty(true);
    const stopParty = client.watchRealtime("party", pollParty, 3_000,
      () => !refreshGate.busy);
    const onVisible = () => {
      if (document.visibilityState === "visible") void pollParty(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      stopParty();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [client, presenceCharacterId, refreshGate, refreshPartyState]);


  const knownInteractionIds = useCallback(() => [...knownInteractionStatusesRef.current.keys()], []);

  return {
    partyInfo, teamCombatInfo, interactionInbox, refreshPartyState, refreshTeamCombat,
    refreshInteractions,
    knownInteractionIds,
  };
}
