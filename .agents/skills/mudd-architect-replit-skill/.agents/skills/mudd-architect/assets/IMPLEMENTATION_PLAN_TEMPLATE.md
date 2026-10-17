# MUDD feature implementation plan — [Feature]

**Goal / user-observable behavior:**
**Existing repo findings:**
**Owning plugin/capability:**
**Assumptions and deferred scope:**

## Contract changes

- New or updated command(s): type/version, payload Zod schema, auth/permissions.
- Query/projection(s): viewer permissions, consistency requirements.
- Event(s): type/version, facts recorded, idempotency, upcaster if needed.

## Boundary map

- Core/ports touched:
- Plugin(s) touched:
- Persistence/migration touched:
- Client SDK / PWA / TTY impact:
- Operational / networking impact:

## Invariants and failure paths

- Aggregate/version/transaction boundary:
- Duplicate/retry and disconnect behavior:
- RNG/clock/replay considerations:
- Abuse/authorization and hidden-info boundaries:

## Steps

1. Define schema/contracts and tests.
2. Implement plugin domain handler and capability wiring.
3. Implement storage/projection/migrations (if any).
4. Integrate transport + client facade and visible flow.
5. Add integration/replay/authorization tests; run checks.
6. Update docs and ADR if required.

## Acceptance criteria

- [ ] User can complete the end-to-end action.
- [ ] No domain logic or authority in the client.
- [ ] Events/projections and replay match accepted outcomes.
- [ ] Invalid, duplicate, stale, unauthorized requests are handled.
- [ ] Cross-client API is documented and tested where applicable.
- [ ] Tests/build/lint/typecheck and migration checks are reported.
