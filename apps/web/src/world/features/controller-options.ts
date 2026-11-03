import type { MuddHttpClient, GameSnapshot } from "@mudd/client-sdk";
import type { ActivityEntry } from "@mudd/ui";
import type { GameSessionOperations as Session } from "../session/session-contract.js";
import type { ExecutionToken } from "../session/foreground-execution.js";

export type ForegroundLabel = "look" | "read" | "take" | "use" | "drop" | "put" | "move" |
  "talk" | "shop" | "buy" | "craft" | "combat" | "rest" | "stand" | "equip" | "party" | "daily" | "gather";
export interface ControllerOptions {
  client: MuddHttpClient;
  snapshot: GameSnapshot | null;
  pending: boolean;
  beginForeground(label: ForegroundLabel): ExecutionToken | undefined;
  finishForeground(token: ExecutionToken): void;
  reconcileCommand: Session["reconcileCommand"];
  setSnapshot: Session["setSnapshot"];
  setConnectionError: Session["setConnectionError"];
  refreshGate: Session["refreshGate"];
  addEntry(kind: ActivityEntry["kind"], text: string, preserveScroll?: boolean, locationId?: string): string;
}
export function roomContext(snapshot: GameSnapshot | null) {
  return JSON.stringify([snapshot?.character?.worldInstanceId, snapshot?.character?.characterId, snapshot?.location?.locationId]);
}
