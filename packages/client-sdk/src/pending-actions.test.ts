import { afterEach, describe, expect, it, vi } from "vitest";
import { MuddHttpClient } from "./index.js";
import { PendingActionCoordinator } from "./pending-actions.js";

const movement = (id: string, worldInstanceId = "world-a", characterId = "character-a") => ({
  id,
  scope: { worldInstanceId, characterId, roomId: "room-a" },
  details: {
    kind: "character.move" as const,
    fromLocationId: "room-a",
    exitId: "north-exit",
    direction: "north",
  },
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("PendingActionCoordinator", () => {
  it("validates IDs and scopes and rejects changed details for a reused ID", () => {
    const coordinator = new PendingActionCoordinator();
    expect(() => coordinator.begin({ ...movement("blank"), id: " " }))
      .toThrow("Pending actions require an ID and world scope.");
    expect(() => coordinator.begin({
      ...movement("missing-world"),
      scope: { ...movement("missing-world").scope, worldInstanceId: " " },
    })).toThrow("Pending actions require an ID and world scope.");

    const first = coordinator.begin(movement("same-id"));
    expect(coordinator.begin(movement("same-id"))).toBe(first);
    expect(() => coordinator.begin({
      ...movement("same-id"),
      details: { ...movement("same-id").details, direction: "south" },
    })).toThrow("A pending action ID cannot be reused for different action details.");
    coordinator.clearWhere(() => true);
  });

  it("publishes the sending, acknowledged, and confirmed lifecycle without mutating projections", () => {
    const coordinator = new PendingActionCoordinator();
    const listener = vi.fn();
    coordinator.subscribe(listener);

    const initialSnapshot = coordinator.getSnapshot();
    coordinator.begin(movement("command-1"));
    const sending = coordinator.getSnapshot()[0]!;
    expect(sending.state).toBe("sending");
    expect(coordinator.getSnapshot()).not.toBe(initialSnapshot);

    coordinator.acknowledge("command-1");
    expect(coordinator.getSnapshot()[0]?.state).toBe("acknowledged");
    coordinator.begin(movement("command-1"));
    expect(coordinator.getSnapshot()[0]?.state).toBe("sending");
    coordinator.confirm("command-1");
    expect(coordinator.getSnapshot()[0]?.state).toBe("confirmed");
    expect(listener).toHaveBeenCalledTimes(4);

    coordinator.clearWhere(() => true);
  });

  it("reuses an uncertain action ID on an explicit safe retry and rejects cross-scope reuse", () => {
    const coordinator = new PendingActionCoordinator();
    coordinator.begin(movement("command-2"));
    coordinator.markUncertain("command-2", "Not confirmed");

    const retried = coordinator.begin(movement("command-2"));
    expect(retried.id).toBe("command-2");
    expect(retried.state).toBe("sending");
    expect(coordinator.getSnapshot()).toHaveLength(1);

    expect(() => coordinator.begin(movement("command-2", "world-b"))).toThrow(/another scope/i);
    coordinator.clearWhere(() => true);
  });

  it("isolates current-session actions when clearing stale world or character scope", () => {
    const coordinator = new PendingActionCoordinator();
    coordinator.begin(movement("current"));
    coordinator.begin(movement("other-world", "world-b"));
    coordinator.begin(movement("other-character", "world-a", "character-b"));

    coordinator.clearOutsideScope({ worldInstanceId: "world-a", characterId: "character-a" });

    expect(coordinator.getSnapshot().map((action) => action.id)).toEqual(["current"]);
    coordinator.clearWhere(() => true);
  });

  it("converts a stuck sending action to uncertain and expires it within a bounded lifetime", () => {
    vi.useFakeTimers();
    const coordinator = new PendingActionCoordinator();
    coordinator.begin(movement("slow-command"));

    vi.advanceTimersByTime(30_000);
    expect(coordinator.getSnapshot()[0]?.state).toBe("uncertain");

    vi.advanceTimersByTime(120_000);
    expect(coordinator.getSnapshot()).toEqual([]);
  });

  it("publishes rejected and failed terminal states and reschedules an early cleanup pass", () => {
    vi.useFakeTimers();
    const coordinator = new PendingActionCoordinator({ now: () => 1_000 });
    coordinator.begin(movement("rejected"));
    expect(coordinator.reject("rejected", "Not allowed")?.state).toBe("rejected");
    coordinator.begin(movement("failed"));
    expect(coordinator.fail("failed", "Request failed")?.state).toBe("failed");

    const fresh = coordinator.begin(movement("still-sending"));
    (coordinator as any).expire();
    expect(coordinator.getSnapshot()).toContain(fresh);
    coordinator.clearWhere(() => true);
  });

  it("keeps the published snapshot referentially stable between updates and enforces a size bound", () => {
    const coordinator = new PendingActionCoordinator({ maxActions: 2 });
    coordinator.begin(movement("first"));
    const snapshot = coordinator.getSnapshot();
    expect(coordinator.getSnapshot()).toBe(snapshot);

    coordinator.begin(movement("second"));
    coordinator.begin(movement("third"));
    expect(coordinator.getSnapshot()).toHaveLength(2);
    coordinator.clearWhere(() => true);
  });

  it("forwards stable idempotency IDs for PvP request and response commands", async () => {
    const sentCommands: Array<{ commandId: string }> = [];
    const fetcher: typeof fetch = async (_input, init) => {
      const command = JSON.parse(String(init?.body)) as { commandId: string };
      sentCommands.push(command);
      return Response.json({
        receipt: {
          ok: true,
          commandId: command.commandId,
          eventIds: [`event-${sentCommands.length}`],
          newAggregateVersion: sentCommands.length,
        },
        events: [],
      });
    };
    const client = new MuddHttpClient({ worldInstanceId: "world-a", fetcher });

    await client.requestInteraction("character-a", "character-b", "pvp.challenge", "challenge-command");
    await client.respondToInteraction("character-a", "request-1", "accept", "response-command");

    expect(sentCommands.map((command) => command.commandId)).toEqual([
      "challenge-command",
      "response-command",
    ]);
  });
});
