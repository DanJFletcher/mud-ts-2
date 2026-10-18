# ADR 0003: Room chat persistence and ordering boundary

- **Status:** Accepted for the current room-chat feature.
- **Date:** 2026-10-18

## Context

Room chat is a public room feed, while NPC dialogue and gameplay commands remain private engine interactions. Keeping chat out of character event streams avoids mixing a high-volume communication log into character progression, but the separate table still needs a clear authority boundary. In particular, a player must not post or read a room after moving away, and retries must not duplicate a message or its immediate NPC response.

## Decision

- Keep room messages in `room_chat_messages`; do not route them through character event streams.
- Treat `(world instance, room)` as the public feed scope and the authenticated player as the owner of a player submission.
- Require a stable client submission ID. Enforce uniqueness by world, player, and submission ID; exact retries return the original message, while reuse with different content is a conflict.
- At the chat transaction boundary, acquire the same `(world instance, character stream)` advisory lock as movement, then revalidate the active world session, character ownership/archive state, and current room from the event stream before inserting or listing messages.
- Serialize inserts with a `(world instance, room)` advisory lock so room message IDs are committed in insertion order and the existing ID-based polling cursor cannot skip an earlier uncommitted message.
- Trigger an NPC room reaction only after the player's message is newly committed. Private NPC dialogue remains on the engine query path.

## Consequences

- A concurrent move and chat request has a deterministic lock order: the message is accepted in the old room before movement, or rejected after movement; it cannot be accepted using a stale room projection.
- A retry after a successful send returns the original message even if the character has since moved.
- Existing NPC messages are retained; the new nullable idempotency fields do not require rewriting old rows.
- NPC reactions are queued in the same transaction as the player message and use the durable effect ID to deduplicate published replies. The general outbox policy is recorded in [ADR 0004](0004-durable-event-effects.md).
- `TRUSTED_HOSTS` must be configured in production. The current rate limiter is process-local and is not a cluster-wide quota.

## Alternatives considered

- **Store all room chat in character streams:** rejected because room feeds are public, shared by multiple players, and not character progression.
- **Validate room only before the database insert:** rejected because movement may commit between validation and insertion.
- **Rely on a global serial ID alone for chat ordering:** rejected because sequence values can be allocated by transactions that commit out of order.
