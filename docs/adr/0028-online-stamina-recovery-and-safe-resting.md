# ADR 0028: Online stamina recovery and safe resting

- **Status:** Accepted
- **Date:** 2026-10-23
- **Owners:** Engine and game client
- **Related:** [ADR 0027: Character-owned stamina and mana](0027-character-stamina-and-mana.md), [ADR 0007: Character-scoped paid inn rest](0007-character-scoped-paid-inn-rest.md)

## Context

ADR 0027 established persistent character-owned stamina and deferred timed recovery and resting until timing and ownership rules were explicit. The worlds now need exploration to spend stamina and safe locations to offer a free resting posture. This must remain distinct from the existing paid, immediate inn service: ADR 0007's price, currency, health restoration, validation, and narration are unchanged.

## Decision

- Each successfully completed ordinary move or road segment costs 5 stamina. The cost is part of the same character movement event as the location change; a failed move has no debit. A solo road encounter starts in that same atomic character stream after movement and payment.
- While an authenticated character has a live world session, standing restores 1% of maximum stamina per elapsed second. Resting restores 3% per second. Recovery is capped at maximum. The calculation uses integer hundred-thousandths and a persisted fractional carry so short settlements do not lose or create stamina through rounding.
- The server's trusted clock is the only timing authority. A character recovery event records the settled time, posture, exact carry, and resulting resource projection. Settlement uses elapsed time between persisted anchors; aggregate revision ticks are not clocks.
- Only live world sessions recover. Server settlement is driven from fresh world-session presence and stops at the last confirmed heartbeat. On reconnect after a stale session, the recovery anchor is reset to the current server time, so time spent offline does not accrue. Queries never mutate character state.
- State-changing commands settle due recovery and validate costs against the resulting stamina at the same expected character-stream revision. Movement cost and destination commit atomically. Concurrent requests are serialized by optimistic concurrency and retries are idempotent through command receipts.
- `character.rest` and `character.stand` control a free posture. Entering rest requires a living character, no active combat, and a location explicitly marked `safeResting` in that world pack. Standing recovery is available anywhere. The demo marks Willowrest Inn safe; Orraveth marks the Kindly Roof safe and does not add a priced inn service.
- A resting character cannot move or initiate/accept combat. Rest cannot be entered during combat. Respawn clears resting posture. Existing PvP remains explicitly consent-based; no unsolicited attacks or new encounters are introduced. Double incoming damage applies only if an existing legal attack can reach a resting character; current entry constraints make that state unreachable.
- Paid `inn.rest` remains a separate command and retains its authored fee and immediate full restoration exactly as specified by ADR 0007. It is not a substitute for free posture rest.
- Passive health/mana recovery, spell mechanics, and changes to turn-based combat pacing remain deferred.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Store fractional stamina in floating point | Simple arithmetic | Replay and repeated settlement can accumulate rounding error |
| Use server timestamps and persisted integer fractional carry | Deterministic replay and exact bounded recovery | Adds small character events while sessions are live |
| Infer elapsed time from event ticks or revision | No explicit timing state | Revisions are not wall-clock time and vary with unrelated actions |
| Recover while disconnected | Simple reconnect behavior | Enables offline farming; explicitly rejected |

## Consequences and trade-offs

- **Positive:** stamina spending and recovery are character-owned, bounded, replayable, and independent per world session.
- **Negative:** online presence settlement adds periodic event writes for characters below maximum stamina; time between heartbeats is the maximum precision of the online boundary.
- **Compatibility:** old character streams retain full-resource defaults and begin with no recovery anchor. The first authenticated settlement anchors them without offline catch-up. Existing stamina-spending, movement, inn-rest, and character-created events remain readable.
- **Security/trust:** only the trusted server scheduler can issue recovery settlement commands. Clients can request posture changes but cannot supply a recovery time, amount, or resulting resource value.
- **Operational:** no database schema migration is required. Presence heartbeats and recovery events use existing session and character streams.
- **Rollback:** keep all persisted event schemas and replay branches if the mechanics are disabled.

## Verification

- Replay old character streams with default stamina and standing posture.
- Verify exact fractional accrual, both rates, maximum clamping, non-monotonic clock handling, online-only boundaries, reconnect anchoring, duplicate recovery settlement, and concurrent movement.
- Verify a move/road step pays exactly 5 only when it commits, including encounter-starting movement and party road completion.
- Verify rest restrictions, stand recovery, movement/combat rejection while resting, death posture reset, both world safe-place authoring, and paid inn nonregression.

## Revisit trigger

Revisit if the presence heartbeat cadence changes, if multiple server writers are introduced, or if resting characters become valid targets of an existing combat action.
