# Article architecture and navigation

## Initial discovery

Check for existing wiki roots, content directories, Markdown extensions (`.md` or `.mdx`), frontmatter schema, terminology, relation fields, link conventions and sidebar/navigation entry points. Use the existing content convention if present, while preserving the no-code-output rule. If there is no existing wiki, use portable Markdown under `docs/wiki/` rather than choosing a site generator prematurely.

## Ontology and page roles

| Category | Article subject | Good content | Exclude |
| --- | --- | --- | --- |
| `place` | Region, settlement, geographical feature, building | Terrain, history, culture, name, neighboring places, significance | Encounters, walkable room grids, game exits |
| `person` | Historical or living figure | Life, family, affiliations, public reputation, legacy, perspective | HP, stats, abilities, dialogue trees |
| `faction` | Institution, state, school, guild | Founding, hierarchy, ideals, social influence, schisms | Reputation scores, quest outcomes |
| `culture` | A community's traditions | Language, social structure, crafts, meals, beliefs and variation | Racial bonuses or stereotypes |
| `history` | Event or era | Dates, competing accounts, origins, aftermath | Quest trigger conditions |
| `belief` | Faith, folklore, cosmology | Myths, ritual meaning, religious disputes | Spell mechanics, powers |
| `object` | Significant object with a story | Provenance, makers, symbols, transfers of ownership | Item rarity, stats, effects |
| `species` | Living or legendary kind | Habitat, appearance, legends, interrelations | Monster CR/XP, combat tactics |
| `index` | Navigation | Curated summary/links by region, theme, era or category | Generic non-wiki project tasks |

Do not create a page merely to fill a template. A good wiki has a browseable home page, topical landing pages when scale warrants, and relationships encoded through links.

## Default metadata (when no project schema exists)

```yaml
---
id: person-isa-rehn
title: Isa Rehn
category: person
canon_status: draft
visibility: public
aliases:
  - Isa of the Third Lantern
era: present
source_refs: []
---
```

Use stable lowercase hyphenated IDs prefixed by category, unique slugs and descriptive titles. ID remains stable after spelling corrections; the filename may change as long as you repair links. Frontmatter is editorial metadata and **not a database/schema contract**.

## Links

Default to standard Markdown file links relative to the originating page, e.g. `[Lantern Reach](../places/lantern-reach.md)`. Use this over `[[wikilinks]]` if portability or a site generator matters. If the existing wiki uses Obsidian wikilinks, preserve them consistently instead. Avoid silently mixing incompatible styles. Use descriptive anchor text and correctly URL-encoded paths when needed; prefer filesystem-safe slugs.

- A person page links to associated locations, factions, notable relations and an era.
- A settlement page links to its encompassing geography, associated cultures, notable inhabitants and important historical events.
- A history page links to affected places, people and organizations.
- An index gives context in a phrase per link; do not dump hundreds of unexplained names.
- Don't create a dead-end link. If an absent entity is essential, create a short, correctly scoped draft stub and add it to the appropriate index. Otherwise defer linking until the target exists.
- Match entity identity, not words: "Bell" may mean a tower, artifact or family name; disambiguate via names and pages.

## Information architecture for large settings

Favor category + region + era indexes rather than deeply nesting every individual article. As a setting grows, a reader should be able to enter through geography, chronology, culture, person or faction. Use aliases for alternate spellings and exonyms without generating duplicate articles. For lineage, distinguish relatives and dates instead of fabricating complete genealogies.
