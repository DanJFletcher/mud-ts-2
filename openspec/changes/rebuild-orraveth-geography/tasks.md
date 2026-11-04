# Tasks

## 1. Protect existing content

- [ ] 1.1 Capture and review a preservation inventory from the current parsed pack covering the categories in design.md. Establish passing original-edition equivalence and public quest/access tests before production edits. Record revision and provenance.
- [ ] 1.2 Add independent preservation assertions using the inventory. Verify that removing an NPC, altering a reward or dropping an encounter from a candidate copy is detected without coupling the assertion to coordinates.
- [ ] 1.3 Extract shared content composition and explicit edition bindings. Verify original output equivalence and independent parsed objects, then run package tests, lint and typecheck. Document how placements and patrol routes differ between editions.

## 2. Approve the landscape

- [ ] 2.1 Extend the world bible with natural-river guidance and cited examples of erosion, deposition, floodplains and terrain-dependent bends. Verify the worked examples explain a landing, crossing and road alignment.
- [ ] 2.2 Produce a terrain and drainage sheet for the current playable region, including proposed downstream direction, gradient relationships, meanders, wetlands and crossing sites. Compare it against the Codex and supplied maps and identify new geographic claims.
- [ ] 2.3 Obtain and record the user's geography review of the sheet before authoring the playable layout. Verify that the direction and required crossing relationships are resolved and the approved scope includes all existing settlements and map areas.

## 3. Build the new independent layout

- [ ] 3.1 Add the second map directory, pack version and rebuilt export with a focused spawn/identity test. Observe that test fail for the missing edition before implementation, then pass through the composed public export. Keep the original layout baseline green.
- [ ] 3.2 Author the Lower Rill course and wetlands from the approved sheet. Establish failing assertions for required bend geometry and bank connections before authoring, then verify graph validity, unique tiles, visible directions and water-access states.
- [ ] 3.3 Rebuild Bellwold surface rooms around the preserved service and quest anchors. Verify all existing residents, services and readables are bound and the new spawn reaches them under existing prerequisites.
- [ ] 3.4 Rebuild the church and underground layout around preserved puzzle dependencies. Verify locked access, key acquisition, interaction prerequisites, sword recovery and return behavior through actual commands.
- [ ] 3.5 Rebuild Harrowfen and its approach. Verify the half-day itinerary measurement, retained residents, yield tallies and quest arrival requirements.
- [ ] 3.6 Rebuild Rillford and both approaches around the approved river. Verify bank access, retained services, towpath fishing and the absence of unauthored ferry passage.
- [ ] 3.7 Rebuild Ashcombe, Thornmere and Mosswake with their approaches, one settlement at a time. Verify residents, content restrictions and intended one-day journeys against the reviewed terrain.
- [ ] 3.8 Bind retained encounters, patrols and gathering sites to the completed layout. Verify encounter and loot inventory parity, mobile NPC route validity, fishing states, daily jobs and crafting access. Review any changed prose or placement against the explicit binding inventory.
- [ ] 3.9 Add the itinerary report and layout guide. Verify every existing inter-settlement journey's intended path and shortest permitted walking alternative, move count, gross stamina and encounter exposure. Explain deviations from the approximate travel-day target and retain automated reference, gate and coordinate checks.

## 4. Expose and verify the fresh world

- [ ] 4.1 Record the instance, pack-version and activation decision in an ADR. Use a failing registration/selection integration test, then add the rebuilt entry with distinct player-facing naming. Verify independent location-group catalogs and original-world re-entry with existing progress.
- [ ] 4.2 Add a failing picker/entry test for fresh-world information and scoped rosters, implement the client changes, then verify original and rebuilt entry in the client suite and Storybook if presentation changes require it.
- [ ] 4.3 Exercise all retained quests, gates, dialogue prerequisites, gathering, crafting, combat and services through the rebuilt world's public command pipeline. Verify rewards remain idempotent, state is isolated across editions and both editions pass integration coverage.
- [ ] 4.4 Run the complete relevant package, server and client checks, lint, typecheck and explicit-base PR quality gate. Review numeric limits, cohesion, inventory exceptions and obsolete allowances. Record actual TDD observations and any skipped checks.
- [ ] 4.5 Playtest a production build with mobile and keyboard entry, river/bridge inspection, each regional journey and return, a dungeon quest, and long-history map use. Record readability, payload/rendering observations and travel pacing. Resolve blocking findings before marking release verification complete; seek a scoped decision if balance changes are needed.
