# Verification

Implemented on `fix/bulletin-board-read-action`.

## Delivered behavior

Orraveth's existing `bellwold-daily-notice` declares the optional typed action
`{ type: 'daily-board', boardId: 'bellwold-notice-board' }`. Its exact-ID Read action
opens the existing daily-postings dialog. Readable IDs and board IDs remain stable.
Ordinary Read still sends `character.read`; Look still inspects. Browsing linked
postings does not send an ordinary read command or create read-progress events.

The same dispatcher handles object clicks and resolved text intents. Ambiguous
labels/aliases require disambiguation, and exact selections are not converted to
display-name commands. Quick controls use explicit associations and board IDs.
Selected-object removal, association changes, unavailable targets and obsolete
world/character/location responses cannot redirect or reopen the dialog. Board
loading, errors and retries retain the selected board ID instead of defaulting to
the first board. Daily dialogs suppress world movement shortcuts.

World graph validation rejects missing, duplicated or remote board references.
Location projection preserves metadata across location presentation states. The
SDK opts in through a common `x-mudd-readable-actions: 1` request header. HTTP
boundaries omit the field for legacy/unsupported clients on snapshots, queries,
game command projections and legacy movement projections without mutating shared
projections. The PWA enables this capability; old server responses remain valid.

## Automated checks

| Check | Result |
| --- | --- |
| Contracts suite | 92 tests passed |
| Core plugins suite | 338 tests passed |
| Orraveth suite | 16 tests passed |
| Client SDK suite | 75 tests passed |
| Server HTTP integration suites | 74 tests passed |
| Complete web suite | 532 tests passed |
| Repository `npm run typecheck` | Passed |
| Repository `npm run lint` | Passed, zero errors and 405 warnings |
| Full repository production build | Passed through the isolated E2E runner |
| Strict OpenSpec validation | Passed |

The focused tests initially caught a missing default state in a new test fixture,
new test typing errors, and changed ambiguity feedback; these were corrected
before the final checks above. Existing command/result/event schemas and generic
read-event assertions remain unchanged.

## Production browser exercise

`npm run test:e2e` passed all four Chromium flows using the built PWA preview,
real server and a disposable PostgreSQL 16 database. The runner cleaned up the
database after completion. Browser flows covered:

- Guest creation, ordinary marker reading, exploration, leaving and re-entry.
- Orraveth room text -> Bulletin board chooser -> Read -> exact board postings;
  Accept updates the posting to In progress, Close dismisses it, and Look prints
  the inspection description without reopening postings.
- Arrow movement remains suppressed while the daily dialog is open. Direct
  snapshot requests verify absent/supported/unsupported capability versions.
- Existing mobile history/navigation and fishing cancellation workflows.

These are automated real-browser results. No human screen-reader audit was
performed; no new UI component or styling was introduced.

An intermediate browser repeat hit the existing fishing test's random road
ambush: combat correctly disabled its next movement button, which the test then
waited on until timeout. The bulletin regression passed in that run as well.
No combat/fishing implementation or test timeout was changed for this fix.

## Requirement coverage

The readable-actions contract is covered by schema/graph/composition tests,
character projection and unchanged generic-read tests, stable Orraveth content
assertions, all four negotiated HTTP response shapes, SDK common-header/parsing
tests, identity/ambiguity/staleness dispatch tests, App click/typed/retry tests,
controller deferred-response tests and the production browser flow. See the
[authoring guide](../../../docs/world-content/readable-actions.md) and
[ADR 0045](../../../docs/adr/0045-typed-readable-actions.md) for contract and rollout
details. No database migration or persisted presentation effect was added.
