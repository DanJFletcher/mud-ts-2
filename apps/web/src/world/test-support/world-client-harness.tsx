import { render, type RenderResult } from "@testing-library/react";
import {
  GameSnapshotSchema,
  MuddHttpClient,
  type GameSnapshot,
  type WorldSummary,
} from "@mudd/client-sdk";
import { WorldClient } from "../WorldClient.js";

export type WorldClientHarnessRequest = Readonly<{
  path: string;
  method: string;
  query: URLSearchParams;
  body: unknown;
  headers: Headers;
}>;

export type WorldClientRoute = (
  request: WorldClientHarnessRequest,
) => Response | Promise<Response>;

export type WorldClientHarnessOptions = Readonly<{
  worldInstanceId?: string;
  snapshot?: GameSnapshot;
  worlds?: WorldSummary[];
  routes?: Readonly<Record<string, WorldClientRoute>>;
}>;

export type WorldClientHarness = Readonly<{
  client: MuddHttpClient;
  worldInstanceId: string;
  requests: WorldClientHarnessRequest[];
}>;

const defaultSnapshot = {
  player: { id: "player-one", displayName: "Player" },
  character: {
    characterId: "character-one",
    worldInstanceId: "world-one",
    name: "Arin",
    locationId: "room-one",
    revision: 1,
    health: { current: 10, maximum: 10 },
    resources: {
      stamina: { current: 10, maximum: 10 },
      mana: { current: 10, maximum: 10 },
    },
  },
  location: {
    worldInstanceId: "world-one",
    locationId: "room-one",
    revision: 1,
    title: "Test room",
    shortName: "Test room",
    qualifiedName: "Test room",
    locationGroups: [],
    description: "A test room.",
    exits: [],
    objects: [],
    occupants: [],
  },
};

// eslint-disable-next-line max-lines-per-function -- The fixture snapshot stays schema-parsed and is the shared base for scenario overrides.
export function createWorldClientSnapshot(
  overrides: Readonly<{ worldInstanceId?: string; locationId?: string }> = {},
): GameSnapshot {
  const worldInstanceId = overrides.worldInstanceId ?? "world-one";
  const locationId = overrides.locationId ?? "room-one";
  return GameSnapshotSchema.parse({
    ...defaultSnapshot,
    character: { ...defaultSnapshot.character, worldInstanceId, locationId },
    location: { ...defaultSnapshot.location, worldInstanceId, locationId },
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url, "http://mudd.test");
}

function parseRequestBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string") return undefined;
  try { return JSON.parse(body) as unknown; } catch { return body; }
}

function buildRequest(input: RequestInfo | URL, init: RequestInit | undefined): WorldClientHarnessRequest {
  const url = requestUrl(input);
  return { path: url.pathname, method: (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(), query: new URLSearchParams(url.searchParams), body: parseRequestBody(init?.body), headers: new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)) };
}

function heartbeatResponse(worldInstanceId: string, snapshot: GameSnapshot): Response { return jsonResponse({ worldInstanceId, locationId: snapshot.location?.locationId ?? "room-one", occupants: [] }); }

// eslint-disable-next-line max-lines-per-function -- The small default-route table keeps unconfigured endpoints failing explicitly.
function defaultResponse(
  request: WorldClientHarnessRequest,
  snapshot: GameSnapshot,
  worlds: WorldSummary[],
  worldInstanceId: string,
): Response {
  if (request.path === "/api/worlds") return jsonResponse(worlds);
  if (request.path === "/api/game") return jsonResponse(snapshot);
  if (request.path === "/api/world-session/heartbeat") return heartbeatResponse(worldInstanceId, snapshot);
  return jsonResponse({ message: `No test route for ${request.method} ${request.path}.` }, 404);
}

type FetcherSetup = Readonly<{
  options: WorldClientHarnessOptions;
  snapshot: GameSnapshot;
  worlds: WorldSummary[];
  worldInstanceId: string;
  requests: WorldClientHarnessRequest[];
}>;

// eslint-disable-next-line max-lines-per-function -- The fetch adapter records every request before dispatching explicit routes or defaults.
function createFetcher(setup: FetcherSetup): typeof fetch {
  // eslint-disable-next-line max-lines-per-function -- Request recording and route dispatch must use the same normalized request.
  return async (input, init) => {
    const request = buildRequest(input, init);
    setup.requests.push(request);
    return setup.options.routes?.[request.path]?.(request)
      ?? defaultResponse(request, setup.snapshot, setup.worlds, setup.worldInstanceId);
  };
}

// eslint-disable-next-line max-lines-per-function -- A fresh fixture assembles one scenario's defaults, transport, and request log.
export function createWorldClientHarness(options: WorldClientHarnessOptions = {}): WorldClientHarness {
  const snapshot = options.snapshot ?? createWorldClientSnapshot({ worldInstanceId: options.worldInstanceId });
  const worldInstanceId = options.worldInstanceId
    ?? snapshot.character?.worldInstanceId
    ?? snapshot.location?.worldInstanceId
    ?? "world-one";
  const worlds = options.worlds ?? [{
    worldInstanceId, packId: "test-pack", name: "Test World", summary: "A world for a focused test.",
  }];
  const requests: WorldClientHarnessRequest[] = [];
  const fetcher = createFetcher({ options, snapshot, worlds, worldInstanceId, requests });
  return {
    client: new MuddHttpClient({ worldInstanceId, fetcher, commandProjection: "game", readableActions: true }),
    worldInstanceId,
    requests,
  };
}

export function renderWorldClient(harness: WorldClientHarness, options: Readonly<{ onLeaveWorld?: () => Promise<void>; historyLimit?: number }> = {}): RenderResult {
  return render(<WorldClient client={harness.client} worldInstanceId={harness.worldInstanceId} onLeaveWorld={options.onLeaveWorld ?? (async () => undefined)} historyLimit={options.historyLimit} />);
}
