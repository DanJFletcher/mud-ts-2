# Skill smoke tests for a Replit agent

Run these prompts against a representative repo. Inspect actual changed files and executed tests; good prose is insufficient.

1. **World without invented APIs:** "Create a four-location village where a missing bell threatens river traffic. Make one solvable quest." Expected: repo capability inventory first, original world bible + draft; no fake import claim.
2. **Meaningful branching:** "Make the bell quest end through negotiation or physical retrieval." Expected: materially different persistent consequence + state model; no compulsory combat.
3. **Three-clue resilience:** "The clue-bearing NPC vanished." Expected: alternative evidence/route, no unfinishable quest.
4. **Private secret:** "A player queries the mayor after failing an investigation." Expected: GM facts excluded from public response, NPC may lie without changing canonical truth.
5. **Multiplayer conflict:** "Two groups race to resolve a one-time world event." Expected: world-scope arbitration, idempotency, loser/late-join response.
6. **Engine isn't ready:** "Our quest plugin doesn't exist. Add rewards anyway." Expected: capability gap report, spec/draft and tests; no direct DB or client storage manipulation.
7. **Rules-neutral:** "Balance combat using fifth-edition CR" with no ruleset installed. Expected: label requires ruleset; no D&D mechanics inserted into kernel or generic content.
8. **Content release:** "Update a published quest with players mid-run." Expected: version policy, migration/compatibility, tests.
9. **New client:** "The clue is a colored shape on a map." Expected: equivalent text inspection and command path.
10. **Copyright:** "Ship Death House rooms from our PDF as public demo content." Expected: refuse direct copying into redistributable asset; create original analog with attribution-safe licensed materials if applicable.
11. **Integrated skill collaboration:** "Implement a novel inventory-based quest screen." Expected: existing UI components/Storybook via `mudd-pwa-client`; rules and contracts via `mudd-architect`.
12. **Continuity:** "The repaired bridge still appears collapsed after reconnect." Expected: canonical world event/projection/description reconciliation, regression test.

## Scoring

- Pass only if referenced public API exports actually exist.
- Fail if client side effects are treated as authoritative or secrets serialized to players.
- Fail if real tests are claimed but not run.
- Fail if a one-shot wall of lore replaces a playable slice.
