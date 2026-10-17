# Wiki maintenance and quality assurance

## Every edit

1. Find an existing article or alias before creating a new one.
2. Read adjacent pages and index entries that mention the entity.
3. Preserve approved claims; place creative additions in clearly draft pages or sections until approved.
4. Update all direct inbound links you can find after a rename; maintain alias or redirect conventions already supported.
5. Recheck chronology, lineage, geography, membership and spoiler status across linked pages.
6. Remove mechanics, quests and call-to-action instructions from lore prose.
7. Run read-only link/metadata validation when supported.
8. Deliver wiki content only—no test report or maintenance changelog outside wiki.

## Quality matrix

| Dimension | Pass condition |
| --- | --- |
| Scope | Every new or changed file is a wiki Markdown article/index |
| Canon | Draft claims cannot masquerade as approved canon; sources are real |
| Character | Person feels like a human actor in a larger history rather than a stat block |
| Place | Subject has distinctive physical, social and historical context |
| Linking | Working references, no duplicate IDs or accidental empty pages |
| History | Timelines and geopolitical state remain coherent |
| Secrets | Public pages do not reveal restricted/private material |
| Portability | Markdown works without app-specific UI or code changes |
| Focus | No quest, puzzle progression, combat or engine APIs |

## Linter

Use the bundled `scripts/validate_wiki.py` for fallback-style Markdown. It checks YAML-like metadata fields, duplicate page IDs, bad relative Markdown links and some obvious headings indicative of quest/mechanics material. It is intentionally dependency-free and read-only. It **cannot verify lore correctness, legal clearance, spoiler containment, or the prose quality**. Manually inspect those.

For nonstandard repo conventions (e.g., Obsidian `[[wikilinks]]`, Docusaurus `.mdx` or different metadata), adapt the *review method*, not the wiki output format or project configuration. Never run an automatic rewrite that reclassifies approved canon.
