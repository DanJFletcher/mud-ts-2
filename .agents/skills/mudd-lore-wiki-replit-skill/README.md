# MUDD Lore Wiki — Replit Agent Skill

**A dedicated lore archivist and world-encyclopedia author.** This companion to `mudd-architect`, `mudd-pwa-client`, and `mudd-game-master` writes and maintains **only wiki articles** about the fictional world.

## Install

Extract the ZIP into the **root of the existing Replit project**, preserving `.agents/`:

```text
.agents/skills/
  mudd-architect/                 # existing: engine architecture
  mudd-pwa-client/                # existing: Storybook + PWA
  mudd-game-master/               # existing: narrative + quests
  mudd-lore-wiki/                 # this package
    SKILL.md
    references/
    templates/
    examples/wiki/
    scripts/validate_wiki.py
```

Replit loads installed project skills from `.agents/skills` when relevant; use the Skills pane or explicitly ask Agent to "Use `mudd-lore-wiki`". Its output destination is the **repo's existing lore wiki**; if none exists, the fallback is `docs/wiki/` containing portable Markdown files.

## Hard boundary: wiki is the only output

When using this skill, Agent can **read** project world documents to check canon and names, and run **read-only** wiki checks, but its authored output is **wiki Markdown pages and indexes only**. No quests, quest hooks, stat blocks, gameplay balancing, engine APIs, TypeScript, server/client code, Storybook changes, app scaffolding, schemas, changelogs, or project plans. If you ask for quests or mechanics too, those parts are excluded from this skill's output and belong in another agent task.

## What the wiki covers

- Geography, countries, regions, towns, buildings and landmarks.
- Character biographies, backstories, family relationships and reputations.
- Cultures, customs, languages, religions and folklore.
- Historical events, time periods, political changes and disputed records.
- Factions and institutions as social/historical entities.
- Storied objects, symbols, non-mechanical species and legends.
- Cross-referenced categories and alphabetical or regional indexes.

## Key editorial protections

- **Canon provenance:** approved source text overrides drafts; agent-generated additions default to `canon_status: draft` unless you explicitly approve them.
- **Rumors remain rumors:** accounts can be canonical without their content being true.
- **Spoiler handling:** `visibility` is an editorial field, *not security*. Agent must not put secret lore into public repo content when there is no actual protected storage.
- **Continuity:** names, aliases, era, geography, genealogy, institutions and histories must remain consistent across linked pages.
- **Wiki-only:** no API integration and no gameplay dependencies are needed to start writing lore.

## First task prompt

> Use `mudd-lore-wiki` to inspect this project's existing world lore and build a small, well-linked world encyclopedia. If a wiki already exists, extend it instead of replacing it. Start with the world index, 1 regional/place article, 2 character biographies, 1 faction, and 1 historical event only where the source material actually supports them; if there is not enough established lore, write clearly marked draft original lore instead. Use portable Markdown and meaningful cross-links. No quests, game mechanics, engine code, PWA changes, or non-wiki output. The wiki is the sole deliverable.

## Single-entry task prompt

> Use `mudd-lore-wiki` to write a wiki biography for [character] using our existing approved setting material. Include formative history, relationships, public reputation, historical context, and related wiki links. Separate disputed accounts from established facts. Update only the biography and necessary wiki index/links. Do not invent canon, describe combat stats, or create quests.

## Package contents

- `SKILL.md`: governing output contract, editorial workflow and MUDD-specific skill boundaries.
- `references/`: canon/provenance, article architecture, writing style, continuity, publication/secrecy, maintenance, source references.
- `templates/`: eight lore-only article templates for index, people, places, factions, cultures, history, beliefs, objects and species. (Nine templates total.)
- `examples/wiki/`: four linked lore articles plus a home page. **Entirely original, illustrative, and NONCANON.** Do not silently import this example into your MUDD world.
- `scripts/validate_wiki.py`: optional read-only Markdown linter requiring only Python's standard library.

### Validate Markdown link hygiene (optional)

```bash
python .agents/skills/mudd-lore-wiki/scripts/validate_wiki.py docs/wiki
```

This checks only basic structure/metadata, duplicate IDs, relative links, and obvious out-of-scope terms. It does **not** establish truth, licensing, authorization, or canon consistency, and it does not write any files.

## Design basis

The approach draws on Replit's official skills documentation, MediaWiki's practices for categories and redirects, Obsidian's Markdown/YAML and cross-linking conventions, and World Anvil's encyclopedia-first worldbuilding model. Source links and interpretation are in `references/REFERENCE_SOURCES.md`.

The uploaded D&D materials and earlier MUDD game-master sample are **not** treated as official MUDD world canon.
