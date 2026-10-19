# Engine developer experience proposal

- **Status:** Proposal only; no public API changes are implemented here.
- **Reviewed:** 2026-10-19

## Goal

Make the supported path for adding a world pack, plugin, or client feature easier to discover without hiding authority, persistence, validation, or optimistic-concurrency rules. Keep the engine contracts independent from React and keep all current server and client behavior working.

## Current public surface

- `engine-contracts` exports versioned Zod contracts for commands, events, queries, projections, sessions, and plugin manifests.
- `packages/engine-core` exports `EngineHost`, store/authorization ports, replay, and the live `EnginePlugin`/`PluginContext` interfaces.
- `packages/core-plugins` exports first-party gameplay plugins.
- `packages/client-sdk` exports `MuddHttpClient`; it sends typed operations and validates response bodies with Zod.
- `packages/world-demo` is code-authored content validated against contracts.

There is a second `GamePlugin` interface in `engine-contracts/src/plugins.ts`, explicitly marked as a design proposal. The live host uses the `EnginePlugin` contract in `packages/engine-core/src/types.ts`. Public examples should say which one is executable today; the proposed interface must not be marketed as a supported runtime API.

## Proposed developer-facing layers

### 1. Keep the low-level typed client as the stable base

Continue exposing the current `MuddHttpClient` methods and schemas as the explicit transport layer. Add no automatic mutation or hidden retry behavior to these operations.

### 2. Add an optional character-scoped facade

After the shared-state decision is accepted, add a small facade over the current client methods. The facade should bind the world instance and one selected character, carry the latest known expected revision, and return discriminated success/conflict/failure results. Builders should execute only when explicitly awaited or run; constructing a command must not send it.

Illustrative API (proposal, not current code):

```ts
const world = client.world({ id: worldInstanceId });
const traveler = world.character(activeCharacterId);

const view = await traveler.snapshot();
const move = await traveler.move.to("glasswater-bridge").run();

if (!move.ok && move.code === "VERSION_CONFLICT") {
  const latest = await traveler.snapshot();
  // The caller decides whether to present or re-issue the player's intent.
}
```

```ts
const result = await traveler.combat.attack("reedbank-sentry").run();
```

This is intended to shorten routine client code, not to let a client choose actor identity, fabricate destinations, or bypass a plugin contract. The server still resolves authoritative state, validates IDs and permissions, and commits a command receipt before returning.

### 3. Make retry rules explicit

- Generate one command ID per player intent and reuse that same ID only when retrying the exact same request.
- Do not transparently retry a `VERSION_CONFLICT`; refresh and ask the caller/player to reconcile.
- Treat duplicate receipts as successful replay of the original outcome.
- Preserve `retryable` and correlation/request IDs in structured SDK errors.
- Keep player-safe rule messages separate from generic internal errors.

### 4. Offer one clear plugin authoring contract

Before inviting third-party plugins, either retain the live `EnginePlugin` model or deliberately migrate to a revised API. Do not maintain two apparently public contracts indefinitely.

The eventual helper should:

- infer command payload types from Zod schemas;
- require event/effect schemas and versions at registration;
- validate manifest-declared capabilities against registered providers;
- make dependency ranges and lifecycle order explicit;
- expose capability requests as trusted in-process dependency injection;
- clearly state that permissions are descriptive metadata, not a security sandbox.

Illustrative registration (proposal):

```ts
const plugin = defineEnginePlugin({
  manifest,
  register(api) {
    api.command(MoveCommandSchema, async (command, context) => {
      // Validate intent, load authoritative state, and return a versioned plan.
      return context.plan({ streamId: command.characterId, events: [] });
    });
  },
});
```

The exact handler model should be chosen only after reconciling it with the current `CommandPlan`, `PluginContext`, capabilities, and host-owned append transaction. This example is not a claim that `defineEnginePlugin` currently exists.

### 5. Make world-pack validation a first-class authoring step

Keep authored content as data and validate references before runtime. A future public authoring helper can infer IDs and report unresolved exits, NPC references, quest targets, and item interactions without changing the immutable-content/runtime-state boundary. Import, provenance, content migrations, and live hot reload should be separate scoped work.

## Error and response contract

For each public client operation, return a validated success shape or a typed error with:

- stable error code;
- safe user-facing message;
- `retryable` only where retrying the same command ID is safe;
- request/correlation ID for support;
- optional structured conflict details that do not disclose private server data.

All SDK response bodies should be parsed by Zod. Feature-specific requests outside `MuddHttpClient`, especially room chat, should either move behind the SDK or use exported response schemas. TypeScript casts alone are not runtime validation.

## Migration sequence

1. Publish current API examples and mark proposed-only contracts clearly.
2. Add a response schema for any direct client request that stays outside the SDK.
3. Add a facade as an optional wrapper over existing SDK methods; do not replace them.
4. Reconcile plugin contract types and manifest checks before supporting external packages.
5. Only add multi-aggregate conveniences after the shared-world ADR is accepted and the transaction boundary is designed.

This preserves current wire contracts, monorepo boundaries, one active character per session, and the independent React/Storybook layer.
