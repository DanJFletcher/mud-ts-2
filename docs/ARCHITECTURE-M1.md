# MUDD Milestone 1 — Architecture Plan

## Vertical slice

One TypeScript monorepo runs a single server and a mobile-first PWA. A guest receives a persistent, HTTP-only session cookie, creates one character, inspects the current location, and moves only through exits returned by the server. The server validates all input, derives the player from the session, authorizes character ownership, and commits domain events before returning a projection. Reloading fetches the event-derived character state again.

## Package boundaries

- `engine-contracts` — versioned Zod command, event and projection shapes; existing design bundle is adopted selectively.
- `packages/engine-core` — plugin registry/lifecycle, command pipeline, event-store port, replay and in-memory test adapter.
- `packages/plugins` — only character creation and room movement handlers needed for this slice.
- `packages/client-sdk` — typed HTTP client; no React dependencies.
- `packages/ui` — presentation-only accessible components and Storybook stories/tests.
- `packages/world-demo` — validated original three-room content.
- `apps/server` — composition root, guest sessions, Drizzle/PostgreSQL adapter, HTTP transport and migrations.
- `apps/web` — React PWA, SDK feature adapter, installable shell and responsive exploration screen.

## Decisions

1. **Modular monolith, not services.** The single server owns plugin composition and persistence; the PWA is an independent client.
2. **Events are authoritative.** Character creation and movement append versioned facts to one character stream. Reads replay that stream; no client-side location writes are allowed.
3. **Explicit optimistic concurrency and idempotency.** Every mutation supplies an expected character revision and stable command ID. PostgreSQL serializes a stream commit and stores the receipt atomically; the in-memory adapter follows the same port.
4. **Guest identity is server-issued.** An opaque random token is stored only as a hash in PostgreSQL and delivered in an HTTP-only, SameSite cookie. Actor identity is never accepted from request JSON.
5. **Room definitions are immutable content.** The fixture is Zod-validated at startup, and movement destination is selected from the server's exit graph.
6. **UI package is state-agnostic.** Components take presentation props and emit callbacks; Stories and unit tests exercise them without an engine or SDK.
7. **Keep the first release narrow.** No combat, chat, quests, NPCs, authoring API, or speculative plugin execution/sandbox.

## Dependencies

- Runtime: TypeScript, Zod, Express, PostgreSQL `pg`, Drizzle ORM.
- Web: React, Vite, Tailwind CSS v4, Lucide icons, `vite-plugin-pwa`.
- UI development: Storybook for Vite, Vitest, Testing Library, jsdom.
- Tooling: npm workspaces, `tsx`, `drizzle-kit`, `concurrently`, ESLint with TypeScript rules.

## Verification

Run contract tests, engine/plugin/adapter tests, SDK integration tests, UI component tests, type checks, migration generation/application, production builds and Storybook build. Run the PWA through the configured Replit web workflow on port 5000 and verify the narrow viewport visually.
