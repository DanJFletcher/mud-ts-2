# ADR 0044 — World-specific movement stamina costs

- **Status:** Accepted
- **Date:** 2026-11-01
- **Owners:** World contracts, movement and combat plugins

## Decision

Orraveth travel costs two stamina per room or road step. Other worlds retain the
existing default of five unless their content explicitly overrides it.

Add optional `movementStaminaCost` to `WorldPackDraft`: an integer from 1 to 100,
authored as TypeScript content. A shared resolver supplies the legacy default
when omitted. Ordinary movement, road-step eligibility, every party member's
eligibility, and post-victory party-road movement all use that resolver.

Movement events already record `movementCost`. New commands record the current
world cost; replay validates and deducts the cost recorded in each event rather
than comparing with a global constant. A history can therefore contain old
five-stamina moves and newer two-stamina moves without reinterpreting either.
Legacy events without a cost retain their existing no-debit replay behavior.
Zero, fractional and unaffordable recorded costs remain rejected.

No event schema, database migration, recovery rate, combat-action cost, flee cost,
or saved character history changes. Orraveth's unreleased pack remains 1.21.0.

## Verification

Tests cover default five and explicit two, schema bounds, a two-stamina move
with exactly two available, rejection with one available, actual Orraveth road
events and balances, party-road entry and victory at both prices, and replay of
mixed five/two histories alongside malformed or unaffordable costs.
