# Orraveth content authoring

The [entry point](./src/index.ts) exports the existing world, class catalog, instance
ID and summary. It assembles internal content, parses it, and rejects invalid
graphs at import time. Internal modules import contracts and other local helpers;
they must not import the entry point, server, clients, or runtime plugins.

## Ownership

- [Map files](./src/map/) own layout, descriptions, groups and roads as specified
  by [ADR 0042](../../docs/adr/0042-world-map-layout-data-files.md).
- [Settlement fragments](./src/content/settlements/) own location content. Bellwold
  is split into commerce, residences and landmarks; other settlements have their
  own fragments, and waterways own river-state overlays. Each location key has
  exactly one owner. The checked merge rejects duplicates rather than overwriting.
- [Daily jobs](./src/content/daily-jobs.ts), [gathering](./src/content/gathering.ts),
  [crafting](./src/content/crafting.ts), [quests](./src/content/quests.ts), and
  [encounters](./src/content/encounters.ts) own their respective definitions.
- [Classes](./src/classes.ts) remain their own catalog.

Keep IDs stable: saved events refer to locations, NPCs, choices, flags, items and
quests by ID. Keep authored array order, particularly map locations (the first
location is the initial spawn), dialogue topics/choices, routes and encounters.
Changing prose or a display name is not a reason to rename an ID. NPC IDs must be
unique throughout a pack, including static residents and mobile actors.

## Dialogue helpers

[smallTalkChoices](./src/content/dialogue.ts) uses named options:

```ts
smallTalkChoices({
  npcId: 'resident',
  identity: 'I live here.',
  activity: 'Mending a wheel.',
  town: { key: 'bellwold', name: 'Bellwold', response: 'A working village.' },
  additionalQuestions: [{ id: 'work', label: 'What work?', response: 'Repairs.' }],
});
```

`town.key` is stable identity; `town.name` is display text. Omitting the initial
hide condition hides introductory choices after the town question. An explicit
empty array disables that hiding. Follow-ups default to requiring the town flag;
an explicit empty prerequisite array removes that default. Initial prerequisites
also apply to every follow-up and are deduplicated in authored order. Orin's
small talk requires the existing rod-received flag.

Anwen's quest acceptance and turn-in choices depend on quest eligibility, not on
the incidental town small-talk branch. Asking about Bellwold must not require a
conversation restart before continuing a quest. Keep objective checks and
one-time reward protection in the authoritative quest runtime.

Topic matching still uses the first authored substring match. The Independent
Boatman's dispute topic therefore uses specific `ferry guild` / `ferry dispute`
phrases before the passage topic's `ferry stage` / `ferry` keywords. This is local
content disambiguation, not a new general topic-ranking policy.

Creature factories use explicit occurrence IDs and construct independent nested
objects. Loot is an explicit regional choice: the southern-road deer supplies a
hide, while other deer do not. Do not change balance while moving definitions.

## Verification

Run `npm run test --workspace @mudd/world-orraveth` and
`npm run typecheck --workspace @mudd/world-orraveth` from the repository root.
The [temporary baseline](./src/__fixtures__/README.md) protects the extraction;
never regenerate it from refactored output to silence a failure.
