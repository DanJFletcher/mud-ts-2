import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import {
  createWorldClientHarness,
  createWorldClientSnapshot,
  renderWorldClient,
} from "./world-client-harness.js";

describe("WorldClient test harness", () => {
  it("keeps requests and clients isolated between scenario instances", async () => {
    const first = createWorldClientHarness({ worldInstanceId: "world-one" });
    const second = createWorldClientHarness({ worldInstanceId: "world-two" });

    await first.client.getWorlds();
    await first.client.getGame();

    expect(first.requests.map(({ path }) => path)).toEqual(["/api/worlds", "/api/game"]);
    expect(second.requests).toEqual([]);
    expect((await first.client.getGame()).character?.worldInstanceId).toBe("world-one");
    expect((await second.client.getGame()).character?.worldInstanceId).toBe("world-two");
  });

  it("renders the scenario snapshot through the real WorldClient composition", async () => {
    const harness = createWorldClientHarness();

    renderWorldClient(harness);

    expect(await screen.findByRole("heading", { name: "Test room" })).toBeVisible();
    expect(harness.requests.some(({ path }) => path === "/api/game")).toBe(true);
  });

  it("applies typed snapshot and route overrides to one scenario", async () => {
    const snapshot = createWorldClientSnapshot({
      worldInstanceId: "custom-world",
      locationId: "custom-room",
    });
    const harness = createWorldClientHarness({
      snapshot,
      routes: {
        "/api/worlds": (request) => new Response(JSON.stringify([{
          worldInstanceId: request.headers.get("x-mudd-world-instance"),
          packId: "scenario-pack",
          name: "Scenario World",
          summary: "A scenario-specific world.",
        }]), { headers: { "content-type": "application/json" } }),
      },
    });

    expect((await harness.client.getGame()).location?.locationId).toBe("custom-room");
    expect((await harness.client.getWorlds())[0]?.name).toBe("Scenario World");
    expect(harness.requests[0]?.headers.get("x-mudd-world-instance")).toBe("custom-world");
  });

  it("supports deferred routes and explicit HTTP failures", async () => {
    let resolveResponse!: (response: Response) => void;
    const deferred = createWorldClientHarness({
      routes: {
        "/api/game": () => new Promise<Response>((resolve) => { resolveResponse = resolve; }),
      },
    });

    const pendingSnapshot = deferred.client.getGame();
    resolveResponse(new Response(JSON.stringify(createWorldClientSnapshot()), {
      headers: { "content-type": "application/json" },
    }));
    await expect(pendingSnapshot).resolves.toMatchObject({
      location: { locationId: "room-one" },
    });

    const failure = createWorldClientHarness({
      routes: {
        "/api/game": () => new Response(JSON.stringify({ message: "Snapshot unavailable." }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      },
    });
    await expect(failure.client.getGame()).rejects.toThrow("Snapshot unavailable.");
  });
});
