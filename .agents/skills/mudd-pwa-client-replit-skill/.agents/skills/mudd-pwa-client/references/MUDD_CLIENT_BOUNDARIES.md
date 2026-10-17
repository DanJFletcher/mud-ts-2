# MUDD client SDK, events, commands, and projections

## The separation that must never collapse

The client sends **intents**, not authoritative state. Examples:

- Correct: `client.commands.send({ type: 'movement.move', payload: { exitId }, commandId, expectedVersion })` where exact shape comes from contracts.
- Incorrect: React computes a new room and writes into engine state, or `setCharacterHp` directly from player input.

Use whatever contract names and types actually exist in repo; names above are illustrative, not an invented protocol specification. The `mudd-architect` skill owns protocol shape and capability permissions. If missing, coordinate through typed interfaces without claiming fake server behavior.

**UI data flow:**

1. `client-sdk` handles connect/reconnect, transport, auth context, session identity, query/subscriptions, decoding/validation, ordering and cursor recovery.
2. A feature adapter/hook maps state into lightweight `RoomView`, `CharacterStatusView`, `MessageView[]`, connection status, and action callbacks.
3. `@mudd/ui` widgets render props and emit callbacks only. Stories pass fixtures to widgets without server.
4. The feature adapter associates pending submission with `commandId`, handles ack/rejection and eventually applied projection, and exposes distinct pending/error indicators.

## Example presentation-only types

```ts
export type ExitView = { id: string; label: string; destinationHint?: string; disabled?: boolean };
export type RoomView = {
  id: string;
  title: string;
  description: string;
  exits: readonly ExitView[];
  objects: readonly { id: string; label: string }[];
  occupants: readonly { id: string; displayName: string }[];
};
export type ConnectionView = {
  state: 'local-only' | 'connecting' | 'connected' | 'reconnecting' | 'resyncing' | 'offline' | 'error';
  detail?: string;
};
export type MessageView = {
  id: string;
  kind: 'narration' | 'player' | 'party' | 'system' | 'error';
  text: string;
  author?: string;
  at?: string;
};
```

These are **UI view models**, not domain or wire schemas. They may be mapped from real protocol contracts in `apps/web/src/features/*/adapters` or similar, but the generic `@mudd/ui` package should not import the client SDK or a particular ruleset.

## Special attention: session state and connection state

- Connected means transport/session is connected, not necessarily that all projections are up to date. Model `resyncing` independently.
- A locally hosted demonstration might continue offline; multiplayer depends on its chosen authority. Make mode visible. Do not quietly queue and later replay irreversible online game actions (movement/combat/purchases) unless protocol explicitly allows idempotent, correctly validated queued commands and UI labels them as pending.
- On reconnect, request missing events with a cursor or full projection; dedupe by event ID; apply in sequence; expose stale state if synchronization has not completed.
- Preserve command draft during disconnection; show retry semantics only when safe and user-confirmed if necessary.
- Auth/authorization rejection must produce a helpful accessible message without leaking server/internal secrets.

## High-volume transcript patterns

- Transcript has deterministic stable IDs, date/time semantic display, kind/text/author, and bounded history; virtualize only as needed, but not at the expense of focus or screen-reader semantics.
- Never use `dangerouslySetInnerHTML` with untrusted chat/narrative content. If inline formatting is required, use vetted parser/sanitizer and document safe subset.
- Autoscroll only when user is at the end; if scrolled away, preserve reading position and offer a 'new messages' control.
- Avoid announcing a complete history on hydration/replay. Use a separate polite announcement for relevant *new* messages (or selectively announce), with a pause/verbosity preference. Distinguish alerts from ordinary narration.
- Handle thousands of messages without blocking input; include stable ordering with event sequence/cursor so late events don't reorder content deceptively.

## Game control states

- Movement: always submit typed exit ID from projection rather than crafting room IDs locally; disable only if projection/permissions explicitly disallow, otherwise errors handled from authority.
- Combat/turns: server/ruleset gives permissible actions and resolution; client displays state and selection, not rules engine computations.
- Dice: UI may animate results from actual authoritative events, but cannot roll official results for an online session.
- Chat: text entry should support Unicode/IME, length limits from contracts, safe rendering and meaningful send/slowmode/denied feedback.
- Client plugins / future TTY: keep command semantics accessible without pointer maps, drag-only interactions, or animation.

## SDK integration test contract

At minimum, assert that callbacks in UI → feature adapter → SDK command; SDK rejection renders an error without fabricated game changes; ack + projection update change the screen once; duplicate events don't duplicate transcript; reconnect restores cursor and drafts; app works in stub/local-authority mode per explicitly supported feature scope.
