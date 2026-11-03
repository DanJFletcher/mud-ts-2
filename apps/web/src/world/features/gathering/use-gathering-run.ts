import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { MuddHttpClient, GameSnapshot } from "@mudd/client-sdk";
import { GatheringRun, browserGatheringTiming, type GatheringRunPorts } from "./gathering-run.js";

/** Shares lifecycle mechanics only; feature adapters own commands and narration. */
export function useGatheringRun(
  client: MuddHttpClient,
  snapshot: GameSnapshot | null,
  ports: GatheringRunPorts,
) {
  const characterId = snapshot?.character?.characterId;
  const locationId = snapshot?.location?.locationId;
  const owner = useMemo(() => ({ active: true, client, characterId, locationId }), [client, characterId, locationId]);
  const latest = useRef(ports);
  latest.current = ports;
  const run = useRef<GatheringRun | undefined>(undefined);
  const actionId = snapshot ? ports.select(snapshot)?.id : undefined;
  useLayoutEffect(() => {
    owner.active = true;
    return () => {
      owner.active = false;
      run.current?.dispose();
      run.current = undefined;
    };
  }, [owner]);
  useLayoutEffect(() => {
    run.current?.dispose();
    run.current = undefined;
    return () => { run.current?.dispose(); run.current = undefined; };
  }, [owner, actionId]);
  useLayoutEffect(() => {
    if (!snapshot || !owner.active) return;
    const state = latest.current.select(snapshot);
    if (!state) return;
    if (!run.current) {
      const adapter: GatheringRunPorts = {
        read: () => latest.current.read(),
        select: (value) => latest.current.select(value),
        advance: (value, id) => latest.current.advance(value, id),
        reconcile: (value, response, accepts) => latest.current.reconcile(value, response, accepts),
        apply: (value) => latest.current.apply(value),
        narrate: (response, before) => latest.current.narrate(response, before),
        report: (error) => latest.current.report(error),
        get gate() { return latest.current.gate; },
      };
      run.current = new GatheringRun(state.id, adapter, browserGatheringTiming);
    }
    run.current.schedule(state);
  }, [snapshot, owner]);
  const stop = useCallback(() => { run.current?.dispose(); run.current = undefined; }, []);
  const capture = useCallback(() => () => owner.active, [owner]);
  const continueAction = useCallback((id: string) => {
    if (!owner.active || !snapshot) return;
    const state = latest.current.select(snapshot);
    if (state?.id === id) run.current?.schedule(state);
  }, [owner, snapshot]);
  return { stop, capture, continueAction };
}
