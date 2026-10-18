# Clients, SDK, PWA and Replit deployment

## Client contract

Clients are replaceable consumers of the engine protocol. The `client-sdk` should expose typed primitives rather than leaking raw WebSocket events and backend implementation types:

```ts
interface MuddClient {
  connect(options: ConnectionOptions): Promise<void>;
  execute<C extends ClientCommand>(command: C): Promise<CommandReceipt>;
  query<Q extends ClientQuery>(query: Q): Promise<QueryResult<Q>>;
  subscribe(topic: SubscriptionRequest, listener: ProjectionListener): Unsubscribe;
  disconnect(): Promise<void>;
}
```

The signature is conceptual; implement actual generics by deriving types from registered Zod schemas. Provide a single facade for both local/demo and remote hosts. UI must never calculate authoritative hit results, bypass inventory transactions, assign location directly or load privileged world state.

## First proof of concept: mobile-first PWA

- Use React + TypeScript + Tailwind CSS v4. Follow existing component-library/design-token conventions if available; don't introduce a one-off visual system.
- Design for touch at narrow mobile widths first, and scale to desktop without hiding critical actions behind hover.
- Provide a readable scrollable narrative log, context-aware action controls, message/command entry, character/status area, accessible exit navigation, inventory, and readable error/reconnect statuses.
- Support keyboard access, semantic labels, visible focus, reduced motion, clear system/error feedback, decent contrast, and screen-reader announcements for critical events. Prevent narrative floods with sensible live-region behavior.
- Ensure responsive layout and virtualized or bounded event log history where appropriate; retain recent log state across reload where required.
- Create an installable PWA manifest and useful offline startup behavior. Test on a narrow viewport as well as keyboard desktop use; do not claim service-worker offline synchronization until implemented.
- A local-only demo can run an in-process host with IndexedDB-backed event log. UI still talks to an SDK-like abstraction. When switching to server mode, the UI should primarily change its connector configuration, not its game mechanics.
- Auth in local demo may be a local profile. Server mode requires real session/auth checks server-side; don't export local-mode auth into network authority.

## Text/TTY client

TTY must be able to consume room descriptions, occupants, inventory and combat updates rendered into text. It maps commands such as `look`, `north`, `say hello`, `attack <target>` into identical domain commands as the PWA. Keep text alternatives for map/icon cues. Telnet is the traditional baseline transport adapter, with SSH or secure tunnel options preferable for internet authentication.

Never put movement, combat, or ruleset semantics into parsing/display functions. Parsing is a client capability; valid commands are server-resolved.

## Future client APIs

- Voice: speech recognition/text-to-speech outside engine; send explicit parsed commands and consume event/query summaries.
- 2D/3D: world space presentation outside engine; the core location graph remains usable in plain text. Optional spatial components can be added through capabilities.
- Third-party UI developer SDK: documentation of authentication, protocol schema/version compatibility, subscriptions, reconnect and example app. Keep transport and rendering library independent.

## Replit workflow

1. Inspect Replit project's package manager, current web/server entry points, environment variables and managed database options before deciding dependencies.
2. Keep `.agents/skills/mudd-architect/SKILL.md` under version control with its references. The skill is a **repository artifact**, not automatically an engine runtime package.
3. Configure a single runnable development command for the initial PWA and, when present, the authoritative server. Use standard env configuration and Replit secrets for non-public keys. Never hardcode credentials.
4. For server-backed testing, use a PostgreSQL connection configured through the environment, with migrations applied deliberately; do not assume a database has been provisioned or that deployment retains local files.
5. Keep server sockets, storage drivers, and Replit deployment wiring in adapters/composition roots. Avoid Replit-specific APIs in engine-core and contracts.
6. Record exact commands for install, dev, test, lint, typecheck, build, migrate and seed. Verify live reload and that a clean checkout can start with documented environment variables.
7. Add integration testing for a browser client and, when supported, a second client. For in-browser local mode, test that refreshing/reopening recovers durable local state.

## Security and accessibility gates

- Never publish hidden game content to all connected users and rely on client-side filtering. Filter on trusted server/viewer scope.
- Sanitize HTML and terminal control sequences from chat/world content to avoid XSS and terminal injection.
- Validate outbound shape as well as inbound payload when crossing trust boundary to untrusted clients.
- Handle reconnect/resume without duplicate messages or fabricated successful actions.
- Avoid heavyweight UI polish before an end-to-end move/see/communicate loop works.
