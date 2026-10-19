# ADR 0007: Character-scoped paid inn rest

- **Status:** Accepted for the first inn-rest slice
- **Date:** 2026-10-18

## Context

Character health and wallet are both projections of the character event stream. The combat plugin owns health progression and already resolves the character's maximum health by level. The demo world has one currency, moss marks, and immutable authored world content. Resting was identified as a future health-regeneration feature in ADR 0006.

## Decision

- Inn locations and their fixed full-rest price are immutable world content. The initial inn charges 5 moss marks to restore a living character to full health.
- A character can rest only at the inn authored for their current location, while not in active combat, while below maximum health, and with a wallet in the world's configured currency that can cover the price.
- The public `inn.rest` command carries the inn ID and expected character-stream revision. The server resolves location, price, current health, maximum health, and currency from trusted character/world state; client values do not set the outcome.
- The combat plugin owns rest validation because it owns health progression policy. It emits one `character.inn_rest_completed` event containing the resolved charge and resulting health.
- Replay applies the wallet debit and health restoration from that same character event. Existing command receipts provide retry idempotency and optimistic concurrency prevents concurrent overspending.
- Resting at full health is rejected without charging. Rest is unavailable during active combat and cannot revive a dead character.
- Inn use is available to all clients through the command contract; the PWA provides a contextual quick action. No database table or migration is introduced.
- The existing one-active-character-per-world-session rule is unchanged.

## Consequences

- Payment and healing are atomic, auditable, and scoped to one character stream.
- Inn prices can differ by authored location in future, while the initial world uses a single fixed 5-mark price.
- The PWA does not calculate health restoration or trust its displayed balance when deciding whether a rest is accepted.
- The combat plugin now handles a non-combat health service, keeping maximum-health policy centralized at the cost of a narrow inn-content dependency.

## Alternatives considered

- **Heal and debit in separate events:** rejected because a failure or retry between writes could charge without healing or heal without charging.
- **Put health restoration in the client or a location query:** rejected because it would bypass server authority and character-stream replay.
- **Create a separate inn plugin that recalculates maximum health:** rejected because it would duplicate combat-owned progression policy.

## Verification requirements

- Verify successful full restoration and exact wallet debit in the character projection after replay.
- Verify insufficient funds, full health, wrong location, invalid inn ID, active combat, and dead-character rejection without events.
- Verify duplicate command IDs do not charge twice and concurrent commands cannot spend the same balance twice.
- Verify the inn is reachable through authored exits and appears in the map after the player visits it.
