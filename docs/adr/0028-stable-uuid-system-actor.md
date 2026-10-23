# ADR 0028: Stable UUID identity for system-authored events

- **Status:** Accepted
- **Date:** 2026-10-22
- **Owners:** MUDD engine
- **Related decisions:** [ADR 0013](0013-character-respawn-and-shared-death-drops.md)

## Context

The engine represents actor IDs as strings, while the PostgreSQL event store persists `actor_id` as a UUID. Durable effects had been writing labels such as `system:world-items` as actor IDs. PostgreSQL rejected those writes, leaving shared world-item and corpse effects retrying instead of committing.

## Decision

Use one stable, reserved UUID as the actor identity for durable system-effect writes. System effects use the same identity for command receipt lookup and event append so retries remain idempotent. Player-originated commands continue to use the authenticated player UUID.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Change persisted actor columns to text | Directly stores descriptive system labels | Requires a broad schema migration and changes the established UUID identity type when a reserved UUID already satisfies persistence. |
| Generate a new system actor UUID for each retry | Easy to produce valid IDs | Breaks command receipt lookup because retries would use a different actor identity. |
| Use a stable reserved UUID | Compatible with the existing schema and retry-safe | System events share one internal actor identity rather than a descriptive label. |

## Consequences and trade-offs

- Positive: durable effects can append and deduplicate correctly in PostgreSQL.
- Negative: event actor IDs for system writes are not human-readable; consumers should identify system-originated events by this reserved ID.
- Compatibility/migration: no data migration is required; existing failed effects can retry with the corrected writer.
- Security/abuse/trust: only trusted server-side effect handlers use the reserved identity.
- Performance/operational: no additional query or aggregate is introduced.
- Rollback/reversibility: revert the writer constant and mappings; existing event data remains readable.

## Verification

The combat integration test asserts corpse events carry the reserved UUID. The PostgreSQL event-store integration test appends a corpse event, reads it back, and confirms duplicate command lookup works with that identity.

## Follow-up / revisit trigger

Revisit this choice if event auditing needs distinct service identities or if the event store changes its actor ID persistence contract.
