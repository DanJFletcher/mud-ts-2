# Proposal

## Why

Selecting Bulletin board in Orraveth's room description and choosing Read prints the object's static text instead of opening the daily-postings dialog. The exact-ID action bypasses the daily text-command handler, and the readable object has no explicit association with its corresponding daily board.

## What Changes

- Add optional, validated `readAction` metadata to readable definitions and projected room objects, initially supporting `{ type: 'daily-board', boardId }`. Omission preserves ordinary static reading.
- Validate that each referenced board exists in the same authored location, and project the action without inferring links from labels.
- Negotiate read-action metadata through a narrow opt-in HTTP capability so cached clients with strict legacy room-object schemas continue receiving compatible responses.
- Author Orraveth's bulletin readable with its existing daily board ID; keep all object and board IDs stable.
- Route selected-object and resolved text Read intents through the same exact-ID dispatcher, using the existing daily-board controller for linked resources and the existing reader for ordinary text.
- Align board quick actions and supported bulletin aliases with explicit target resolution; preserve Look inspection and current stale-context, loading, and error protections.
- Add regressions for the reported room-description action chooser, exact-ID and named reads, ordinary text, ambiguous targets, multiple boards, and obsolete responses.

## Capabilities

### New Capabilities

- `readable-actions`: Authored, client-neutral read actions with validated resource targets, consistent target-preserving dispatch, and backward-compatible static reading.

### Modified Capabilities

None. The main capability inventory is empty. This change builds on the identity and asynchronous-context guarantees in the unarchived `refactor-world-client` change without redefining those capabilities.

## Impact

- Affects world contracts/validation and room-object projection, Orraveth content, location-bearing HTTP responses and SDK capability headers, frontend command parsing/dispatch, inventory action selectors, and application wiring/tests. The SDK should consume the canonical extended location projection rather than restating its shape.
- Reuses the current daily-board query, controller, and dialog. The action describes a resource rather than a browser modal; other clients can present the same resource appropriately.
- Preserves existing read command/result/event contracts, static-text fallback, and current daily-board browsing semantics. No database migration, new persisted UI effect, arbitrary query/execution descriptor, new runtime dependency, or generic action registry is planned.
- Includes a short contract/compatibility ADR and authoring guidance during implementation. Planning artifacts only are created in this workflow.
