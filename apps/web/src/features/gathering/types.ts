import type { MuddHttpClient, GameSnapshot } from "@mudd/client-sdk";
import type { ActivityEntry } from "@mudd/ui";
import type { useGameSession } from "../../use-game-session.js";
import type { ExecutionToken } from "../session/foreground-execution.js";
type Session = ReturnType<typeof useGameSession>;
export interface GatheringControllerOptions {
  client: MuddHttpClient;
  snapshot: GameSnapshot | null;
  pending: boolean;
  beginForeground(label: "use"): ExecutionToken | undefined;
  finishForeground(token: ExecutionToken): void;
  reconcileCommand: Session["reconcileCommand"];
  setSnapshot: Session["setSnapshot"];
  setConnectionError: Session["setConnectionError"];
  refreshGate: Session["refreshGate"];
  addEntry(kind: ActivityEntry["kind"], text: string): string;
}
