# Overland authoring design

## Context

The regional Codex describes Mosswake as about one day's travel southeast of Bellwold. The current playable route takes nine moves from South Gate. Both statements describe the existing work. The expansion plan's eight-step scale also appears in its instructions for future phases, where an author could mistake an earlier layout decision for current guidance. [Regional geography](../../../apps/web/src/codex/content/regions/bellwold-marches.md) · [Bellwold expansion plan](../../../docs/world-content/orraveth/bellwold-region-expansion.md#L147)

## Goals / Non-Goals

Give a human or agent enough information to sketch the ground, choose a plausible route and town site, and judge the resulting travel distance. The unit applies to overland itinerary design. Simulation, settlement street lengths, retrofits to published roads, and an atlas of all Orraveth lie outside the change.

## Decisions

### Give authors one current rule

Put the rule and regional sketch in the Orraveth world bible. Link there from the pack README and the expansion plan. Use the existing region around Bellwold as the sketch's extent. Mark superseded planning estimates once at the relevant section or table. Keep dates, shipped counts, and the provisional travel times attributed to the Codex, so a reader can reconstruct why the current map looks as it does. [World bible](../../../docs/world-content/orraveth/world-bible.md) · [Pack authoring guide](../../../packages/world-orraveth/README.md)

### Draw the ground before tracing the road

Use a compact, text-readable regional sketch with a north reference and keyed features. Anchor it to known places such as Bellwold, the Lower Rill bridge, and Mosswake. For each feature, identify where it lies, its consequence for travel or building, and its status. Cite established geography, label suggested features as proposals, and identify open questions. The course of a river can be sketched while its downstream direction remains unresolved.

Trace a route for a particular traveler. A wagon carrying timber might follow a longer, gentler grade around a wooded rise. A walker might cross the rise directly. Show a straight stretch where level, firm ground permits it. At a consequential turn, give authors an example of what a traveler could observe from the room that explains the turn. The earlier green-room diagram illustrates this principle of route shape.

### Include the supplied maps in the world bible

Preserve the two PNGs attached to the proposal. During implementation copy them into `docs/world-content/orraveth/assets/orraveth-known-lands.png` and `docs/world-content/orraveth/assets/bellwold-marches-topography.png`. Embed the continental overview and the regional map in the world bible with relative links to those permanent assets, readable alt text, captions and full-resolution links. Identify them as user-supplied design references received on 2026-11-04. This gives the bible stable references after the OpenSpec change is archived.

Use the continental image for regional context and the Bellwold image for the approach and settlement example. Keep the textual sketch and key alongside the images so an author can understand the intended terrain relationships without reading small labels in an illustration. Reconcile depicted names, political boundaries, crossings, elevation bands and mileage with the Codex and the open geography questions. Record discrepancies and proposed details in the key. Treat the printed mile bars separately from the approximate 48-move authoring convention.

### Check travel scale after choosing the route

Count transitions between rooms on the intended overland journey from the departure point to the arrival point. Rough targets for half, one, one and a half, and two travel days are 24, 48, 72, and 96 moves. A 48-move unbranched itinerary visits 49 rooms counting its start. Document meaningful shortcuts, difficult ground, or a route chosen for loaded wagons if they explain a departure from the estimate. If the count looks implausible, revisit settlement spacing or the itinerary before adding turns. Keep the guideline editorial because the runtime already handles individual moves and no approved gameplay feature consumes a fictional-day conversion.

### Apply one sketch at two scales

Use the same Mosswake terrain to explain an approach and a street-level decision. For example, an author could propose that the causeway turns onto a strip of firm ground, follows it directly, then reaches navigable water at the landing. Show how that landing relates to the boat sheds and how a channel might separate two nearby platforms. The Codex supports raised platforms, firmer patches and boatbuilding. The exact strip, bend and channel are design proposals until reviewed. Give the measured current route and the prospective one-day budget separate labels. [Mosswake geography](../../../apps/web/src/codex/content/regions/mosswake.md)

## Risks / Trade-offs

- A schematic can look authoritative. Pair the drawing with a textual key carrying provenance and uncertainty, including the open Lower Rill flow direction.
- A sixfold increase can encourage repetitive rooms or repeated encounter rolls. Ask authors to explain what each stretch contributes and flag pacing for playtest when a particular playable route is commissioned.
- Existing tests assert shipped geometry. Documentation review should compare the example with the current pack and leave any geometry or test changes to a separately scoped map redesign.
