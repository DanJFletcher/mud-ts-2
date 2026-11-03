import type { CommandResponse, GameSnapshot } from "@mudd/client-sdk";
import type { Dispatch, SetStateAction } from "react";

export type CommandReconciliation = {
  snapshot: GameSnapshot;
  source: "command-response" | "snapshot-fallback";
};

export interface ActionRefreshControls {
  readonly busy: boolean;
  begin(): void;
  end(): void;
  capture(): number;
  accepts(epoch: number): boolean;
}

/** Session-owned operations consumed by feature controllers. */
export interface GameSessionOperations {
  reconcileCommand(base: GameSnapshot, response: CommandResponse, traceId?: string,
    accepts?: () => boolean): Promise<CommandReconciliation>;
  setSnapshot: Dispatch<SetStateAction<GameSnapshot | null>>;
  setConnectionError: Dispatch<SetStateAction<string>>;
  refreshGate: ActionRefreshControls;
}
