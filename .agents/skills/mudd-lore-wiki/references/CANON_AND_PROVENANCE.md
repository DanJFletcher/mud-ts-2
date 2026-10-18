# Canon and provenance: editorial authority

## Editorial canon vs in-world truth

Do not collapse these dimensions.

| Dimension | Question | Examples |
| --- | --- | --- |
| Editorial approval | Is this page approved as MUDD setting canon? | `canon_status: approved`, `draft`, `deprecated` |
| In-world epistemology | Is a claim verifiable within the fiction, believed, disputed, mythical, or uncertain? | A real city exists; one priest's account is disputed; a legend describes a vanished king |
| Publication visibility | Who may see it in this wiki edition? | `public`, `restricted`, `private` |
| Time | When did it hold? | The duchy existed 400 years ago but no longer rules that valley |

A statement such as "The Grey Priests say the sky rang like iron before the plague" can be approved canon *as an account of what the priests say* even when the alleged sky event is unverified.

## Source authority ladder

1. Explicit current user-authored/approved setting facts and decisions.
2. Existing approved/published wiki entries and authoritative setting sources identified by the project.
3. Official setting documents/chronologies with known versions.
4. Draft lore and notes (eligible for expansion but not automatic promotion).
5. Your new creative proposals (`canon_status: draft`).

If sources conflict, preserve the highest-authority version. If equally authoritative records differ, avoid rewriting the history. Use carefully attributed wording within an article when conflict is intentional; otherwise restrict the unresolved point to a draft page until clarified.

Don't infer that an entire source is canon merely because it is attached. If a user supplies D&D books, third-party settings, or a game-master sample, they are reference material until the user authorizes their use as canonical MUDD content and the project has publication rights.

## Provenance practices

- Track sources in frontmatter `source_refs`, using repository-relative filenames, stable links, or approved reference IDs only when actually available.
- For new original fiction created under user instruction, `source_refs: []` is acceptable and `canon_status: draft` must remain honest.
- Do not fabricate page numbers, quotes, names, geographic coordinates or dates as sourced truth. Novel invented details are valid for a worldbuilding request, but label new pages draft.
- If a fact is missing and not requested for invention, omit it or say "No surviving record establishes ..." **only if the source material supports that absence**. Prefer leaving the detail unstated.
- Keep the real-world source/provenance metadata out of in-world prose unless an in-world manuscript is itself the subject.

## Changing canon safely

- Prefer a minimal correction to existing approved canon over wholesale regeneration.
- Check incoming/outgoing links, alias references and index descriptions before renaming an entity.
- Do not equate renamed persons or towns unless their identity is confirmed.
- Mark superseded pages `deprecated` or use existing redirect conventions if the wiki supports them; do not erase old names when needed to understand historical sources.
- Approval is explicit. The agent may propose inventive draft lore by writing draft wiki pages, but must not self-certify them as approved.
