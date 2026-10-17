# Publishing and spoilers

The wiki is a lore publication, not a player journal or game database. Nonetheless, world documentation can reveal secrets unintentionally.

## Visibility fallback

- `public`: suitable for all readers; place names, broadly known history, public biographies, traditions and public controversies.
- `restricted`: for approved editorial audiences or a limited lore edition; content may reveal disputed or politically sensitive records.
- `private`: secret world truths, hidden identities or unrevealed historical revelations. Do not cross-reference these from public article titles, excerpts, nav or tags if their existence itself is sensitive.

These are content-editorial labels, not an implemented authorization system. **Do not assume that setting `visibility` controls real-world file access.** If the repository itself is public or serves all `.md` files, do not place private lore there at all. Work only in a known protected location or omit the secret material. A content-only skill must never modify access controls to make itself safe.

## Spoiler-safe linking

- Public articles should not hyperlink hidden pages that expose names, titles or URL slugs containing secret revelations.
- When the public knows a historical rumor, describe the *existence of the rumor* and attribute it, without confirming it by adjacent metadata.
- If a hidden page was accidentally published, stop broadening exposure and correct public-facing text within wiki-authorized scope. Do not claim that editing a file revokes copies/caches.

## Lore editions

Public encyclopedia and private editorial wiki may coexist if the repo already supports the separation. Do not invent a private folder and assume it is secure. Keep editorial `canon_status` separate from visibility; an approved truth may still be private.
