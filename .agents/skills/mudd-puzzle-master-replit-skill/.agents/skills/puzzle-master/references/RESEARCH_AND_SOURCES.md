# Research base and its practical implications

Research verified 2026-10-17. These are **design influences, not verbatim content**. Distinguish the cited author's observations from MUDD-specific synthesis.

| Primary reference | Evidence / idea | Operational rule in Puzzle Master |
| --- | --- | --- |
| Clara Fernández-Vara, GDC *Puzzle Writing: Best Practices* — https://www.gdcvault.com/play/1013851/Puzzle-Writing-Best | A good puzzle is an information contract and belongs in its fictional world. | Provide necessary discoverable facts, clear fiction purpose, and fair feedback. |
| Ron Gilbert, *Puzzle Dependency Charts* — https://www.grumpygamer.com/puzzle_dependency_charts/ | Plan puzzle steps as prerequisite graphs, working backwards from the goal. | Write a dependency DAG and identify bottlenecks before narrative copy. |
| Ben Kowalski et al., *Puzzle Dependency Graph Primer* — https://www.gamedeveloper.com/design/puzzle-dependency-graph-primer | Dependencies reveal non-linearity, pacing and bottlenecks. | Audit reachability, parallel paths, required vs optional steps. |
| Justin Alexander, *Three Clue Rule* — https://thealexandrian.net/wordpress/1101/roleplaying-games/three-clue-rule-part-3-the-three-clue-rule | Critical conclusions need clue redundancy. | Three distinct discoverable clues where progression critically depends on a deduction; not three repetitions of one prop. |
| Justin Alexander, *Node-Based Scenario Design* — https://thealexandrian.net/wordpress/7985/roleplaying-games/node-based-scenario-design-part-3-inverting-the-three-clue-rule | Multiple leads improve resilience and player agency. | Avoid single linear clue→lock chains, especially in exploratory MUD spaces. |
| Justin Alexander, *Failure for the Beginning GM* — https://thealexandrian.net/wordpress/46186/roleplaying-games/failure-for-the-beginning-gm | Failure can progress with a meaningful cost/complication. | Prefer information-bearing, reversible failure or a worse alternate route. |
| Emily Short, *Making of Counterfeit Monkey: Puzzles and Toys* — https://emshort.blog/2013/01/24/making-of-counterfeit-monkey-puzzles-and-toys/ | Expressive systems, feedback and difficulty-tuning matter in parser IF. | Avoid guess-the-verb; prototype flexible actions and show state feedback. |
| Emily Short, *The Unique Selling Points of Parser IF* — https://emshort.blog/2017/05/04/mailbag-the-endangered-art-of-parser-if/ | Puzzles can convey character and world rather than act as locks. | Tie each puzzle's insight to culture, history, personality or ecology. |
| Emily Short, *Idea to Implementation* — https://emshort.blog/2009/08/23/idea-to-implementation/ | Implement a complete throughline, test and expand rather than drafting a huge untested network. | Ship tiny end-to-end puzzle slices before scaling. |
| GDC, *Teaching by Design: Tips for Effective Tutorials from Mushroom 11* — https://www.gdcvault.com/play/1024187/Teaching-by-Design-Tips-for | Introduce systems gradually through playable challenges. | Teach → practice → combine → twist; avoid unexplained twists. |
| Game Accessibility Guidelines, audio clues — https://gameaccessibilityguidelines.com/ensure-no-essential-information-is-conveyed-by-sounds-alone/ | Audio-only essential information excludes players and common play situations. | Every required sound pattern has an equivalent textual/tactile/iconographic description. |
| Game Accessibility Guidelines, fixed colour — https://gameaccessibilityguidelines.com/ensure-no-essential-information-is-conveyed-by-a-fixed-colour-alone/ | Fixed color alone is inaccessible. | Use symbols, labels, texture or text alongside color. |
| Game Accessibility Guidelines, bypass options — https://gameaccessibilityguidelines.com/offer-a-means-to-bypass-gameplay-elements-that-arent-part-of-the-core-mechanic-via-settings-or-in-game-skip-option/ | Optional bypass can prevent accessibility blocks in non-core challenges. | Provide opt-in reveal/skip/alternate route for required non-core puzzles. |
| Levonyan et al., 2023, *Automated Graph Genetic Algorithm based Puzzle Validation for Faster Game Design* — https://arxiv.org/abs/2302.09040 | Solvability can be assisted by algorithmic validation, not only subjective review. | Treat reachability tests as a useful supplement to human playtests. |
| Replit Agent Skills docs — https://docs.replit.com/replitai/skills | Project skills live in `.agents/skills/`; agent reads skill name/description first. | Keep clear frontmatter and progressive-disclosure references. |

## Derived MUDD-specific requirements (our synthesis)

1. A solution trace must be **rendering-independent**: the same game intent should work through TTY and PWA without a specific click/pixel/drag gesture.
2. Preserve information hierarchy: fictional clues visible to eligible characters; solution notes and hidden truth only visible to authorized authors.
3. Represent puzzle updates via validated commands/events and versioned projections if actual MUDD APIs exist; client-side effects don't unlock the authoritative world.
4. Multiplayer imposes explicit ownership/scope: a shared door can open once, but private deductions should not leak; duplicates and race conditions cannot double-award or consume props.
5. Fairness is a design/test claim supported by blind playtest observations, not merely by passing a JSON validator.

## Licensing boundary

D&D 5e, the Player’s Handbook, Monster Manual and *Curse of Strahd* can inform lawful private study, but do not reproduce their proprietary puzzle content, text, maps, named characters or stat blocks into shareable packs without permissions. Prefer wholly original examples and licensed SRD material if applicable; the exact SRD license/version must be checked separately before distribution.
