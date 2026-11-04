# Orraveth geography rebuild design

## Context

The pack composes three JSON layout files with TypeScript content keyed by location and road IDs. Quest, gathering and patrol definitions also contain place IDs. The first authored location determines spawn. The server already constructs independent runtimes for registered world instances. Location-group persistence uses pack ID and pack version. [Assembly](../../../packages/world-orraveth/src/index.ts) · [Registry](../../../apps/server/src/worlds/world-registry.ts) · [Group store](../../../apps/server/src/worlds/location-group-store.ts)

The user accepts a fresh world instance. See proposal.md for scope. The applied overland-design change supplies the world-bible maps and prospective 48-move guideline.

## Goals / Non-Goals

Deliver new geography for the current playable region with an independently checked retained-content catalog. New neighboring settlements beyond those currently playable, terrain simulation and current-driven movement are outside scope.

## Decisions

### Compose two editions from explicit layouts

Add a second map directory and a rebuilt world export in the existing package. Register a new stable world-instance ID and a distinct pack version, retaining the current public exports and original world entry. Proposed identifiers are `orraveth-bellwold-rebuilt-instance` and pack version `2.0.0`; check collisions before adoption. Label the choices clearly as original and rebuilt editions, with fresh-progress information in the picker.

Extract a focused content-composition function after establishing passing original-pack equivalence coverage. Share the catalog and independent parsed copies, with explicit edition-specific placement and patrol bindings. A changed patrol must not alter the original edition through a shared mutable object. Reuse semantic place IDs within the separate instances. A place retains its meaning even when its position changes. Newly invented transit rooms get new IDs. Road and exit IDs may change in the rebuilt edition.

This uses the existing registration mechanism. Replacing the current world in place would require migration of saved positions, encounters and shared state. A separate package would introduce catalog duplication or an additional shared-content package.

### Preserve content with reviewed bindings

Capture an inventory from the current parsed pack before edits. Include NPC identities and dialogue, static mobs and road encounters, combat profiles and loot, quests and their versions, branches, flags, items, containers, readables, services, crafting, gathering, daily jobs, mobile behavior, states and gates. Compare stable definitions separately from intentionally redesigned bindings. Preserve source ordering where first-match dialogue or encounter selection relies on it.

Review explicit exceptions for directional wording, place descriptions, route memberships and patrol itineraries. Keep rewards, prerequisites and creature balance fixed. Preserve logical gate dependencies while rebuilding underground geometry. Keep the original whole-pack baseline protecting the original edition. Avoid deriving a replacement expectation from the rebuilt output. [Existing baseline](../../../packages/world-orraveth/src/equivalence.test.ts)

### Review terrain and river direction before authoring tiles

Add river guidance to the world bible, grounded in [NPS meander descriptions](https://home.nps.gov/articles/meandering-stream.htm) and [EPA river zones](https://www.epa.gov/n-steps-online/water-body-types). Show broad lowland bends, outer-bank erosion, inner-bank deposition and floodplain features where appropriate. Vary curvature with valley confinement and grade. The water and its deposits influence road alignment, fields, crossings and town sites.

Prepare a regional terrain and drainage sheet with elevation relationships, a proposed Lower Rill downstream direction, tributary joins, bends, crossings and wetlands. Reconcile both supplied images with the Codex and identify proposed details. Submit the sheet for the user's geography review before converting it to playable layout. The direction is a content-design decision in that review; the implementation must not infer it from today's east/west exits.

### Design the whole graph, then bind the activities

Place Bellwold, Harrowfen, Rillford, Ashcombe, Thornmere and Mosswake in their established relative directions. Redesign all map areas, including settlement interiors and underground rooms, around the meaningful-place anchors and preserved puzzle gates. Draw roads after river and settlement sites. Maintain unique coordinates within map area and level, directionally consistent connections, explicit state transitions, and intentional dry crossings. Keep the intended starting location first.

The tile-based client can show a river's hooks through connected room positions. A new spline renderer or elevation engine is unnecessary for this scope. River tiles do not themselves imply a travel permission; preserve explicit water-entry rules and bridge `on`/`under` and ferry `stage`/`water` distinctions.

### Measure and playtest the expanded journeys

Provide a test-side itinerary report against the composed world with endpoints, intended path, shortest permitted walking alternative, count, stamina debit and encounter exposure. Respect water and gated access when computing routes. Compare Harrowfen's half day with about 24 moves and one-day settlements with about 48. Document justified exceptions and prohibit artificial loops solely to reach a count.

Existing per-step encounter rates and two-stamina movement cost can make a 48-move trip much harder. Retain existing rates for the first review and measure the result. Record pacing evidence and seek a scoped balance decision if it prevents acceptable release. Changing creature profiles or reward amounts is outside this plan.

## Risks / Trade-offs

- The old geometry is pinned by tests. Keep original-edition expectations and introduce new layout assertions and public journeys for the rebuilt edition.
- A preserved quest can become unreachable. Test actual clue, item and gate progression in addition to schema references and abstract graph connectivity.
- Retaining two editions adds maintenance. Share stable content through explicit composition while testing both outputs and independently keyed group catalogs.
- A larger map can affect payload size and rendering. Verify entry and long-route use in a production build on mobile and keyboard, and measure before requesting engine optimization.

## Migration Plan

Establish the inventory and original baseline, review the terrain sheet, build the independent new layout, bind content, then add the picker entry after verification. Rebuild packages before integration tests. Exercise both editions through server selection and client entry.

Rollback removes the rebuilt edition from selection while retaining its saved data for later recovery. Existing world data is never rewritten. Record pack and instance identity choices and the fresh-world activation boundary in an ADR before registration changes.
