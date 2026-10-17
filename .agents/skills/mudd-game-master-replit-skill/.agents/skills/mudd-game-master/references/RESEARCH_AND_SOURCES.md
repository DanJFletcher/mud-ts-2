# Research basis, adaptations and rights

Research compiled 2026-10-17. External sources below are **design references**, not implied code dependencies or content that may be copied into a commercial game without permission. Distinguish cited author arguments from MUDD-specific prescriptions.

## Primary sources and what this skill adapts

1. **Hunicke, LeBlanc & Zubek, *MDA: A Formal Approach to Game Design and Game Research* (AAAI, 2004).** https://aaai.org/papers/ws04-04-001-mda-a-formal-approach-to-game-design-and-game-research/ — mechanics/dynamics/aesthetics used here to work backwards from desired player feeling to verbs and available rules. The MUDD content process is our application, not a quotation from the paper.
2. **Justin Alexander, *Don't Prep Plots* (2009).** https://thealexandrian.net/wordpress/4147/roleplaying-games/dont-prep-plots — prepare active situations and antagonists' goals, not obligatory player behavior. Here this becomes faction plans, clocks, multiple quest resolutions.
3. **Justin Alexander, *Node-Based Scenario Design* / *Inverting the Three Clue Rule* (2010).** https://www.thealexandrian.net/creations/misc/node-design/node-design2.html — robust interconnected investigation and clue redundancy. Here used for location and quest graph checks rather than forced three-clue boilerplate in every scene.
4. **inkle, *Writing with ink*.** https://github.com/inkle/ink/blob/master/Documentation/WritingWithInk.md — nodes, choices, conditions, revisits and variable state in interactive scripts. MUDD does not automatically use the Ink runtime. Export adapters require an accepted design.
5. **Yarn Spinner, *Nodes and Lines* & scripting fundamentals.** https://docs.yarnspinner.dev/write-yarn-scripts/scripting-fundamentals/lines-nodes-and-options — manageable dialogue nodes, choices, IDs and branching. This inspires narrative modeling, not hidden changes to engine authority.
6. **Emily Short, *Getting Started* and *Self-Training in Narrative Design*.** https://emshort.blog/how-to-play/writing-if/my-articles/getting-started/ and https://emshort.blog/2019/01/08/mailbag-self-training-in-narrative-design/ — design the model of interaction and exploration, then story details around that player experience.
7. **Weir et al., *Ontologically Faithful Generation of Non-Player Character Dialogues* (2022).** https://arxiv.org/abs/2212.10618 — research describing constraints on branching dialogue coherence with character and quest knowledge. Inspires our canonical knowledge ledger and fact checking for AI-authored scripts.
8. **Blades in the Dark, *Progress Clocks*.** https://bladesinthedark.com/progress-clocks — represent evolving obstacles/threats and stakes. MUDD only uses a clock if a suitable authorized time/quest capability really exists. Respect original system design and IP.
9. **Agent Skills specification.** https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx — `SKILL.md` frontmatter, progressive disclosure, optional assets/references.
10. **Replit Agent Skills documentation.** https://docs.replit.com/replitai/skills — project skills under `.agents/skills` and on-demand invocation.

## Project-provided D&D materials

The user has provided *D&D 5e Player's Handbook*, *Monster Manual*, and *Curse of Strahd* introductory adventure / *Death House*. These can be studied as private examples of exploration, social interaction, combat, creature roles, rooms, clues, consequences, and milestone progression. **They are not assets licensed to redistribute in a generated game or agent skill.** Never package their artwork, full passages, maps, characters, trademarks, exact protected statblocks or adventures in world packs without affirmative rights verification.

For distributable rules/content derived from the D&D System Reference Document, see the **official D&D Beyond SRD landing page** https://www.dndbeyond.com/srd . As of research, SRD 5.1 and SRD 5.2.1 are available, and SRD 5.1 is available under CC BY 4.0. Each edition has its own scope and attribution. The SRD is not the same as the entire Player's Handbook or Monster Manual. Prefer original MUDD rules-neutral creatures and settings unless explicitly asked for licensed compatibility.

## Research-to-skill translation

| Finding | Our authored rule | Caution |
|---|---|---|
| Situation-based design | Factions with motives, not forced player scripts | Computer games still need implementable action coverage |
| Node/clue redundancy | Multiple approaches and graph tests | Do not multiply every minor clue mechanically |
| Interactive fiction nodes | Versioned dialogue and state tests | Do not create another competing state store |
| MDA | Choose desired player experience before mechanics | Player experience must be tested, not merely asserted |
| Dialogue fidelity research | Canon/knowledge/visibility ledger | AI model is not an authoritative GM or oracle |
| Progress clocks | Pressure that evolves with world events | Requires real plugin capability and durable time semantics |

Never invent a source or imply that an article defines MUDD's current public APIs. The actual repository determines APIs.
