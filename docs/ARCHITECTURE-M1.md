# MUDD Architecture — Current Monorepo

## Vertical slice

One TypeScript monorepo runs a server and a mobile-first PWA. Account identity comes from Clerk; an account can manage several characters but may hold only one active character session per world instance. The server validates input, derives the player from the authenticated account, authorizes character ownership, and commits domain events before returning projections. Reloading rebuilds character state from its event stream.

## Package boundaries

- `engine-contracts` — versioned Zod command, event and projection shapes; existing design bundle is adopted selectively.
- `packages/engine-core` — plugin registry/lifecycle, command pipeline, event-store port, replay, projections, and in-memory test adapter.
- `packages/plugins` — first-party character, movement, and NPC dialogue handlers.
- `packages/client-sdk` — typed HTTP client; no React dependencies.
- `packages/ui` — presentation-only accessible components and Storybook stories/tests.
- `packages/world-demo` — validated original three-room content.
- `apps/server` — composition root, Clerk account/session integration, Drizzle/PostgreSQL adapter, room chat, HTTP transport and migrations.
- `apps/web` — React PWA, SDK feature adapter, installable shell, character management, and responsive gameplay.

## Decisions

1. **Modular monolith, not services.** The single server owns plugin composition and persistence; the PWA is an independent client.
2. **Events are authoritative.** Character creation, movement, inventory, dialogue progress, and quest progress append versioned facts to one character stream. Reads replay that stream; no client-side state writes are allowed.
3. **Explicit optimistic concurrency and idempotency.** Every mutation supplies an expected character revision and stable command ID. PostgreSQL serializes a stream commit and stores the receipt atomically; the in-memory adapter follows the same port.
4. **Account identity is server-derived.** Clerk authenticates the account; the server resolves its player record and derives actor identity. Actor identity is never accepted from request JSON.
5. **Room definitions are immutable content.** The fixture is Zod-validated at startup, and movement destination is selected from the server's exit graph.
6. **UI package is state-agnostic.** Components take presentation props and emit callbacks; Stories and unit tests exercise them without an engine or SDK.
7. **One active character per world session.** A player can keep multiple character records but cannot join a world with more than one character at once.
8. **No plugin sandbox is implied.** Plugins are trusted in-process code. Zod validates contracts but does not isolate or safely execute third-party code.
9. **Items are currently character-instanced.** Shared physical item ownership is explicitly deferred; see [ADR 0002](adr/0002-world-item-aggregate-ownership.md).
10. **Room chat is a separate public feed.** Chat posts and reads revalidate room membership at the same character-stream lock boundary used by movement; see [ADR 0003](adr/0003-room-chat-persistence-boundary.md).
11. **Room presence is a read-only online projection.** A fresh 90-second world-session heartbeat makes a character visible to others in the same room; movement remains authoritative in the character stream. See [ADR 0010](adr/0010-active-room-presence.md).

## Dependencies

- Runtime: TypeScript, Zod, Express, PostgreSQL `pg`, Drizzle ORM.
- Web: React, Vite, Tailwind CSS v4, Lucide icons, `vite-plugin-pwa`.
- UI development: Storybook for Vite, Vitest, Testing Library, jsdom.
- Tooling: npm workspaces, `tsx`, `drizzle-kit`, `concurrently`, ESLint with TypeScript rules.

## Verification

Run contract, engine/plugin, SDK, UI, server, and PWA tests; type checks; lint; migration application against an isolated PostgreSQL database; production builds; and a Storybook build. CI provisions PostgreSQL for the real event-store integration tests.
