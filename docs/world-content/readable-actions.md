# Readable actions

Ordinary location readables keep their required `id`, `label`, `description` and
`text`. Omit `readAction` to retain static reading. A daily bulletin can declare:

```ts
{
  id: 'bellwold-daily-notice',
  label: 'Bulletin board',
  description: 'A board holds current notices.',
  text: 'Residents post jobs here.',
  readAction: { type: 'daily-board', boardId: 'bellwold-notice-board' }
}
```

The full-world graph validator requires exactly one board with that ID in the
same location. Keep readable and board IDs distinct and stable. Location states
inherit location readables and their actions; there are no state-specific lists.

The PWA's room-description action chooser and text Read both resolve exact object
identity, then use the declared action. Look still inspects. Ordinary reading
still sends the normal read command; a board action queries postings without
accepting jobs or recording ordinary read-progress events.

Text resolution prefers exact readable IDs, then unique exact labels. Generic
bulletin aliases (including `read bulletin`, `read notice board`, and `read board`)
require one local board; other names use unique partial matching. Ambiguous names
require a more specific selection. A selected ID is never converted back to a
label command. Removed/replaced objects or changed associations require selection
again. Quick controls are deduplicated only by explicit board linkage; an
unrelated object named Bulletin board remains an ordinary readable.

SDK consumers opt in with `readableActions: true`, which advertises
`x-mudd-readable-actions: 1` on every request. Legacy clients receive no new field
on snapshots, location queries or command projections. New clients accept older
responses without it. See [ADR 0045](../adr/0045-typed-readable-actions.md).
