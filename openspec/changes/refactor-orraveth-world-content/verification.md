# Verification

## Result

Implemented the content extraction, named dialogue options, independent creature
factories, pack-wide authored NPC identity validation, and the two specified
dialogue corrections. The public entry point is 72 lines (previously 2,039).
Orraveth's pack version is `1.21.1`; quest definition versions remain unchanged.

## Checks

| Check | Observed result |
| --- | --- |
| Contracts suite | 99 tests passed, including duplicate static/mobile identities, direct graph validation, precise issue paths, allowed independent packs, movement and encounter identity checks |
| Demo-world suite | 8 tests passed |
| Orraveth suite | 36 tests passed, including baseline equivalence, helper semantics, fragment collision rejection, factory isolation and authored identity |
| Plugin NPC dialogue suite | 17 tests passed |
| Orraveth server integration and world-map projection suites | 60 tests passed across both files |
| Repository `npm run typecheck` | Passed |
| Repository `npm run lint` | Passed with 0 errors and 405 warnings in existing unrelated code |
| Repository `npm run build` | Passed; Vite reported the existing large-chunk advisory |
| `git diff --check` | Passed |
| `openspec validate refactor-orraveth-world-content --strict` | Passed |

The focused suites above cover 220 tests in total. Tests use fresh builds of the
contracts, shipped worlds, engine, plugins and SDK. No database, event, protocol
or character-progress migration is needed.

## Behavior and compatibility evidence

- Captured the unmodified parsed pack before extraction, recording its source and
  output SHA-256 digests and capture command in the fixture provenance.
- Proved exact output equality after helper migration, module extraction, and
  encounter-factory consolidation, before introducing behavior changes.
- The final equality test applies an explicit independent patch to that original
  fixture: the four Anwen hide-condition removals, the Boatman's two topic keyword
  changes, and the pack patch-version increment. All other parsed values and array
  order must match. The captured fixture itself retains its original digest.
- Confirmed map JSON, package export configuration, and the class catalog are
  unchanged. No runtime plugin, event-schema or protocol implementation changed.
- The mill journey accepts after town small talk, also asks about town while the
  quest is active, rejects an incomplete direct turn-in, then loads the saved
  character in a fresh host and completes without resetting its town progress.
  Restart/retry cannot repeat completion.
- The church journey accepts after town small talk, rejects incomplete turn-in,
  completes with the same recovered sword and exactly 20 gold, and verifies both
  idempotent command retry and rejection of another reward after dialogue restart.
- The Boatman is queried through real authoritative dialogue projection for
  `ferry stage`, `ferry`, `ferry guild`, `ferry dispute`, `Silverfin`, `passage`
  and `current`, asserting the intended existing response text for each.

## Environment and limitations

The server world integration file imports a database module eagerly even though
these tests use an in-memory event store. Its first invocation without a
`DATABASE_URL` failed during import. The passing invocation used
`DATABASE_URL=postgresql://localhost:1/mudd_unused`; no live database was needed.
The world-map suite passed independently and again in the final combined run.

The initial Boatman test used a receipt stream instead of the created character's
identity and a query ID containing spaces. Those test inputs were corrected; the
final combined integration run passes. These were test-construction failures, not
additional production behavior changes.

No browser/UI journey, production deployment, external-pack migration, commit,
or archive was performed. The temporary full-pack fixture is retained as required
for review and merge; its later removal requires a separate reviewed cleanup.
