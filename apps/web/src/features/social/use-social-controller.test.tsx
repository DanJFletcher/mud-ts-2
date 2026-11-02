import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GameSnapshotSchema, MuddHttpClient } from "@mudd/client-sdk";
import { ActionRefreshGate } from "../../action-refresh-gate.js";
import { useSocialController } from "./use-social-controller.js";

function fixture() {
  const snapshot = GameSnapshotSchema.parse({
    player: { id: "player", displayName: "Player" },
    character: { characterId: "character", worldInstanceId: "world", name: "Arin", locationId: "room", revision: 1 },
  });
  const client = new MuddHttpClient({ worldInstanceId: "world" });
  vi.spyOn(client, "getPartyInfo").mockResolvedValue({ party: null, revision: 1, activity: [] });
  vi.spyOn(client, "getTeamCombatInfo").mockResolvedValue({ encounter: null });
  vi.spyOn(client, "getInteractionInbox").mockResolvedValue({ requests: [], encounter: null });
  vi.spyOn(client, "watchRealtime").mockReturnValue(() => {});
  return { client, snapshot, refreshGate: new ActionRefreshGate(), addEntry: vi.fn(() => "entry") };
}
type Party = Awaited<ReturnType<MuddHttpClient["getPartyInfo"]>>;
describe("social refresh ownership", () => {
  it("accepts only the newest party read and does not narrate an older result", async () => {
    const options = fixture();
    const { result } = renderHook(() => useSocialController(options));
    await act(async () => {});
    let old!: (value: Party) => void;
    let recent!: (value: Party) => void;
    vi.mocked(options.client.getPartyInfo)
      .mockImplementationOnce(() => new Promise((resolve) => { old = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { recent = resolve; }));
    let a!: ReturnType<typeof result.current.refreshPartyState>;
    let b!: typeof a;
    act(() => { a = result.current.refreshPartyState(); b = result.current.refreshPartyState(); });
    await act(async () => { recent({ party: null, revision: 3, activity: [] }); await b; });
    await act(async () => {
      old({ party: null, revision: 2, activity: [{ type: "joined", groupId: "group", displayName: "Obsolete", revision: 2 }] });
      expect(await a).toBeNull();
    });
    expect(result.current.partyInfo?.revision).toBe(3);
    expect(options.addEntry).not.toHaveBeenCalled();
  });

  it("rejects direct reads crossing a foreground epoch and deferred reads after cleanup", async () => {
    const options = fixture();
    const { result, unmount } = renderHook(() => useSocialController(options));
    await act(async () => {});
    let finish!: (value: Party) => void;
    vi.mocked(options.client.getPartyInfo).mockImplementation(() =>
      new Promise((resolve) => { finish = resolve; }));
    let read!: ReturnType<typeof result.current.refreshPartyState>;
    act(() => { read = result.current.refreshPartyState(); options.refreshGate.begin(); options.refreshGate.end(); });
    await act(async () => { finish({ party: null, revision: 2, activity: [] }); expect(await read).toBeNull(); });
    expect(result.current.partyInfo?.revision).toBe(1);
    act(() => { read = result.current.refreshPartyState(); });
    unmount();
    await act(async () => { finish({ party: null, revision: 9, activity: [] }); expect(await read).toBeNull(); });
    expect(options.addEntry).not.toHaveBeenCalled();
  });

  it("keeps team and PvP reads scoped to the active generation", async () => {
    const options = fixture();
    const { result, unmount } = renderHook(() => useSocialController(options));
    await act(async () => {});
    let team!: (value: { encounter: null }) => void;
    let inbox!: (value: { encounter: null; requests: [] }) => void;
    vi.mocked(options.client.getTeamCombatInfo).mockImplementation(() => new Promise((done) => { team = done; }));
    vi.mocked(options.client.getInteractionInbox).mockImplementation(() => new Promise((done) => { inbox = done; }));
    let a!: ReturnType<typeof result.current.refreshTeamCombat>;
    let b!: ReturnType<typeof result.current.refreshInteractions>;
    act(() => { a = result.current.refreshTeamCombat(); b = result.current.refreshInteractions(); });
    unmount();
    team({ encounter: null }); inbox({ encounter: null, requests: [] });
    expect(await a).toBeNull(); expect(await b).toBeNull();
    expect(options.addEntry).not.toHaveBeenCalled();
  });
});
