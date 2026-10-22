# ADR 0025: Map terrain and crossing presentation metadata

- Status: Accepted
- Date: 2026-10-22

## Context

The map needs to show water continuing beneath a bridge without changing room coordinates or movement. Terrain can vary freely by world, so labeling every land color would be both restrictive and noisy. Map visibility remains scoped to the current area and floor as defined in ADR 0008; bridge position remains character-specific as defined in ADR 0017.

## Decision

- Keep map terrain as optional presentation metadata with an open slug vocabulary, and allow an optional developer-authored hex color for land tiles. Water and building tiles keep their labeled colors.
- Limit the visible legend to water, buildings, exits, and one-way exits; other terrain colors are unlabeled.
- Add optional `mapLineGapAtLocationId` metadata to an exit. It identifies one endpoint where the map line should stop short, such as the bridge tile when depicting a river flowing underneath it.
- Copy that presentation metadata into the map projection, including when the reverse exit supplies it. The metadata must not change exit availability, travel direction, state selection, encounter resolution, or any other game rule.
- Draw ordinary exit lines flush to tile edges. Apply a small gap only at the authored endpoint.

## Consequences

- Existing world packs remain valid because added metadata is optional and existing terrain slugs continue to work.
- World authors can use arbitrary terrain slugs and choose colors for land tiles without expanding a fixed engine vocabulary or map legend.
- Over/under crossings remain clear without adding map-only rooms, changing Z coordinates, or modifying character state.
