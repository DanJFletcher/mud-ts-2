# ADR 0046 — Pack-scoped authored NPC identity

- **Status:** Accepted
- **Date:** 2026-11-02
- **Owners:** MUDD contracts and world authors
- **Related:** [World layout/content split](0042-world-map-layout-data-files.md)

## Context

Dialogue commands, quest references and persisted character NPC progress address
residents by NPC ID. Previous validation rejected duplicate mobile actors and
some same-room merchant collisions, but allowed unrelated static residents in
different rooms to share an identity.

## Decision

Require every authored NPC in a single world's location definitions to have a
unique ID, whether static, mobile, merchant or combatant. Both world schema
parsing and direct graph validation use the same internal duplicate detector.
Schema issues point at the later occurrence's ID field; graph errors name the ID.
Movement validation and the existing encounter/NPC collision rule remain intact.

The boundary is one authored pack. Separate packs or instances may reuse IDs.
Identical names and content are valid when their IDs differ. This does not extend
the namespace to items or change event, stream, command or projection formats.

## Alternatives

- Keep mobility-specific checks: leaves static dialogue state ambiguous.
- Identify NPCs by room and ID: changes persistent addressing and breaks mobile
  actors' identity when they move, requiring a much larger migration.
- Enforce global uniqueness across packs: introduces unnecessary coordination
  between independently loaded content.

## Compatibility and rollout

Previously accepted content with duplicate static IDs now fails validation with
an actionable diagnostic. Existing valid packs, event histories and character
progress need no migration. Never automatically rename IDs referenced by saved
events; affected external pack authors must resolve their intended identity
before loading. Both shipped packs are checked during implementation verification.

Rollback restores the old validation code without transforming stored data.
