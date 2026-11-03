# Design

## Context

See [proposal.md](./proposal.md) for motivation and scope. [ADR 0042](../../../docs/adr/0042-world-map-layout-data-files.md) intentionally separates JSON map layout from TypeScript content and preserves import-time composition and validation. This change retains that architecture.

The reviewed [entry point](../../../packages/world-orraveth/src/index.ts) contains local dialogue builders, shared fish data, one large content object, and final validation. [NPC dialogue handling](../../../packages/plugins/src/npc-dialogue.ts) already enforces quest eligibility and filters progress conditions. Anwen's four quest actions explicitly hide after her town-question flag; conversation restart clears that incidental flag, so the current issue is unnecessary navigation rather than a permanent lockout. Existing [integration assertions](../../../apps/server/src/worlds/orraveth-world.integration.test.ts) deliberately require quest actions to belong to a conversation branch and must be revised narrowly.

Research confirmed that [world validation](../../../engine-contracts/src/world.ts) checks duplicate mobile NPC IDs and limited merchant cases, but not all authored NPCs. NPC progress is keyed by NPC ID within a character's world context. There is no established duplicate in current Orraveth content.

## Goals / Non-Goals

**Goals:** Make content ownership and dialogue policies explicit while proving that extraction preserves the composed pack. Restrict intentional output changes to Anwen's quest visibility, the Boatman's topic keywords, and a patch pack-version increment. Strengthen shared authored-NPC identity validation.

**Non-Goals:** No new content format, generic content framework, map reorganization, localization system, general topic-ranking algorithm, public exports, ruleset redesign, deep freezing, instance-ID relocation, explicit spawn field, or balance changes. Keep lore, fish distributions, crafting values, encounter frequencies, route order, quest IDs/versions, and reward identity unchanged.

## Decisions

### 1. Extract along content ownership boundaries

Keep the package entry point as a small composition root. Internal modules depend only on public contracts and other local content/helpers; they never import the entry point, runtime plugins, server code, or clients.

Suggested internal organization:

| Area | Responsibility |
| --- | --- |
| `content/dialogue.ts` | Typed small-talk and bulletin response helpers |
| `content/daily-jobs.ts` | Board definitions, job identifiers, and related response data |
| `content/gathering.ts` | Fish species, fishing spots, trees, and gathering settings |
| `content/crafting.ts` | Workbench references and readable multiline recipes |
| `content/encounters.ts` | Shared creature factories and explicit road encounter tables |
| `content/quests.ts` | Quest definitions and narrowly shared quest identifiers |
| `content/settlements/` | Location-content fragments grouped by settlement; split Bellwold by commerce, residences, and landmarks where useful |

The existing class catalog stays separate. Each location-content key has one owning fragment. Compose fragments in explicit author order and reject duplicate location keys before merging, preventing silent object-spread overwrites. Use public contract-derived fragment types and `satisfies` to localize type errors. Do not create one file per NPC or introduce a registry/plugin system for static content.

Array order remains significant, including location spawn order, NPC lists, topic precedence, dialogue choices, encounters, and quest branches. Leave the three map JSON files unchanged. Preserve the current public exports, schema defaults, graph-validation error behavior, and import-time validation.

Alternative: move all content into JSON. Rejected because helpers and shared values are useful and ADR 0042 explicitly scopes the current split. A generic world-content assembly library is also unnecessary for one pack.

### 2. Make dialogue construction explicit without rewriting its state model

Replace positional arguments with a typed options object containing `npcId`, identity/activity responses, town information, follow-up questions, and initial visibility conditions. Give town information an explicit stable ID/key separate from its display name; generate the existing choice IDs from that stable key and preserve the legacy `asked-about-town` progress flags.

Use `undefined` to select a documented default and an explicit empty list to mean no conditions. When migrating existing call sites, translate the old empty initial-hide list to the default rather than copying it as a new explicit empty list. Preserve the current merge of initial prerequisites into follow-up prerequisites and its deterministic deduplication. Derive input/output types from public dialogue contracts instead of maintaining a parallel partial schema.

Add focused helper tests for default branching, explicit empty conditions, custom hiding flags, Orin's rod prerequisite, additional-question overrides, stable town IDs, and deterministic condition ordering. Output equality is the primary protection for all migrated calls.

Alternative: merely rename the helper. Rejected because it leaves ambiguous positional arguments and implicit empty-array semantics intact.

### 3. Fix authored dialogue locally

Remove the town-question hiding condition from Anwen's two acceptance and two turn-in choices. Keep IDs, progress flags, quest actions, objective conditions, and response text unchanged. Existing authoritative quest logic continues to reject incomplete turn-ins and repeated rewards; no runtime bypass is introduced. Other residents' small-talk branches and Orin's reward gate remain unchanged.

For the Independent Boatman, replace the dispute topic's broad `ferry` keyword with explicit `ferry guild` and `ferry dispute` phrases. Add the bare `ferry` keyword to the later passage topic so bare ferry questions also obtain passage information. Preserve topic order, other keywords, and all response text. Verify the exact inputs in the dialogue spec against real topic projection.

Alternative: change generic matching precedence. Rejected because it would alter every world's dialogue and require broader behavioral decisions. An explicit back-to-quest menu was considered, but keeping eligible quest choices accessible is smaller and removes the restart dependency entirely.

### 4. Share creature data while preserving regional differences

Extend the existing bandit-factory approach to repeated hound, boar, badger, and deer profiles. Factories accept explicit occurrence IDs and construct fresh nested objects. Keep encounter order and road probabilities visible in each road table. Loot remains an explicit variation: preserve the southern-road deer's hide drop and the absence of that drop on other deer. Do not infer loot solely from creature name.

Keep crafting recipes as individually readable typed data; shared constants are appropriate for repeated stable identifiers, but avoid a positional recipe builder or defaults that obscure quantities and rewards. Reformatting must preserve floating-point experience values exactly.

Alternative: a configurable creature catalog with inheritance. Rejected as unnecessary complexity for these repeated definitions.

### 5. Enforce authored NPC uniqueness at both validation boundaries

Use one small internal detector in the contracts package to collect duplicate IDs across `locations[*].npcs[*]`, retaining location/NPC indexes. Integrate it into `WorldPackDraftSchema` refinement and `validateDraftWorldGraph`. Schema issues identify the later occurrence's `id` field; graph errors name the offending ID.

Replace the mobile-only duplicate check with the general invariant while retaining route/wander validation and the existing encounter-versus-NPC collision check. Avoid duplicate diagnostics from redundant merchant checks where the global check already covers the same collision. Do not broaden uniqueness across independently loaded packs, world instances, item IDs, or unrelated namespaces.

Contract tests exercise schema parsing and direct graph validation separately. For graph tests, parse a valid fixture first and clone/mutate it to introduce a duplicate; an invalid fixture cannot first pass the strengthened parser. Include static/static, static/mobile in either order, mobile/mobile, same-room collisions, precise error paths, same-name/different-ID acceptance, empty lists, independent-pack ID reuse, and preservation of movement/encounter checks. Record the identity-invariant clarification in an ADR during implementation because accepted validation behavior changes.

### 6. Prove extraction separately from intentional behavior changes

Before editing content, capture the parsed pack from the implementation checkout as a checked-in test fixture. First prove that extraction, named options, and encounter factories reproduce it exactly, including omitted/defaulted values and all array order.

After the targeted dialogue fixes, keep an expected final pack derived from that captured fixture by an explicit narrow patch: only the four Anwen hide-condition removals, Boatman keyword changes, and a pack patch-version increment. Do not regenerate the fixture from the refactored implementation to make failures disappear. This equivalence fixture is temporary migration evidence; retain focused behavioral tests permanently and remove the bulky baseline only in a separate reviewed cleanup after merge.

The reviewed pack is version `1.21.0`; the behavior fixes target `1.21.1`. If another change advances the version first, increment the implementation baseline's patch version rather than decreasing or reusing it. Extraction alone does not change the version. Existing quest definition versions and identifiers remain unchanged.

## Risks / Trade-offs

- [Silent fragment overwrite or changed ordering] -> Detect duplicate fragment keys and compare the full parsed output before applying the explicit behavior patch.
- [Empty-array semantics change while converting helpers] -> Translate old defaults deliberately and cover Orin/custom visibility cases before migrating all call sites.
- [Tests encode the old Anwen branch policy] -> Replace only those assertions with quest-state eligibility assertions; retain other residents' branch coverage.
- [External packs previously accepted duplicate static IDs] -> Return actionable diagnostics and document the validation tightening. Do not auto-rename IDs referenced by persisted events.
- [Shared factories erase intentional loot differences] -> Require explicit occurrence IDs and loot choices; compare all road tables against the baseline.
- [Large baseline fixture becomes maintenance overhead] -> Treat it as temporary extraction evidence and keep permanent focused tests for dialogue, identity, routes, and rewards.

## Migration Plan

1. Capture the baseline from the current checkout and establish existing package tests.
2. Extract content, helper options, and creature factories with exact output equivalence.
3. Tighten NPC validation and exercise both public validation entry points against valid and invalid packs.
4. Apply the two localized dialogue fixes, bump the pack patch version, and verify the explicitly bounded output diff.
5. Run contract, pack, plugin dialogue, and affected server integration tests plus repository typecheck, lint, and build. Existing events and character progress require no transformation.
6. Deploy through the existing world registry. Rollback restores the prior code/content release; no event schema or database rollback is needed. Previously emitted quest-completion/reward events retain their existing formats and IDs.

No implementation-blocking questions remain. The review's broader robustness observations (immutable pack exports and explicit spawn identity) are deferred to separate changes.
