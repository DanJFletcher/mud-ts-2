# ADR 0005: Character-scoped merchant purchases

- **Status:** Accepted for the first merchant slice
- **Date:** 2026-10-18

## Context

The demo world has authored locations, NPCs, character inventories, and an event-sourced character stream, but it has no currency or merchant transactions. A shared shop inventory would introduce a world-instance aggregate and cross-aggregate consistency requirements. The first merchant only needs a small, authored catalog that every character can use independently.

Legacy characters also have no wallet event. Giving them a balance through a read-time projection default would make currency untraceable and would not safely support concurrent requests.

## Decision

- Merchant catalog entries, item definitions, prices, and the single world currency are immutable, versioned world content.
- Each character owns their wallet and purchase history. A character may purchase each authored listing once; another character's purchase does not deplete or reserve that listing.
- A newly created character receives the world's configured starting balance in its `character.created` event.
- A legacy character receives the same configured balance through an explicit, server-initiated, expected-version wallet-initialization command the first time its game snapshot is loaded. The command is valid only when replay shows no wallet. Concurrent requests can commit at most one initialization event.
- A merchant purchase command supplies only merchant and listing IDs. The server resolves price and item from current world content, validates location, balance, purchase history, and inventory, then appends one `character.merchant_item_purchased` event. Replay applies the debit, item grant, and purchase-history update from that same fact.
- Currency is a whole-number character resource. The account wallet, selling, buyback, shared stock, restocking, and dynamic pricing are out of scope.
- One active character per account/world session remains unchanged.

## Consequences

- Purchase correctness stays inside one character stream and its existing atomic event/receipt append; there is no shared stock aggregate or database table.
- Existing character history is preserved. Wallet initialization is explicit, replayable, and idempotent rather than a silent projection fallback.
- The initial client can browse a merchant catalog and purchase through terminal-friendly controls; TTY-compatible commands remain possible.
- Future account-wide currency, item stacking, sales, shared stock, or more complex economy rules require a new ownership and transaction decision.

## Alternatives considered

- **Shared finite merchant stock:** rejected for this first slice because it requires shared aggregate ownership and transactional coordination across character and world state.
- **Currency stored on the account:** rejected because characters are played independently and the selected shop scope is character-specific.
- **Initialize legacy wallets as a projection default:** rejected because the balance would not be an authoritative, auditable event and could be inconsistent across replay.
- **Store price or item data from the client:** rejected because client input is untrusted and must not choose purchase outcomes.
