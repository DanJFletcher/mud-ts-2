# Playtest rubric — design proof vs executable proof

## Blind testing protocol

Give a tester only the **player-facing text/affordances**, not the answer. Record their interpretations aloud or via neutral observation; don't silently coach. Track: initial goal comprehension, interactions tried, object names used, failed input vocabulary, wrong hypotheses, clue discoveries, hint rung requested, time spent (observed only), abandoned attempts, alternative paths and final inferred rule.

**Ask after completion:** What rule did you infer? Which clue taught it? What action did you expect to work but didn't? Was any aspect unfair? Did a player feel sidelined? Was the finale satisfying? Iteration is necessary even after automated tests pass.

## Test matrix

| Category | Scenarios |
| --- | --- |
| Solvability | Primary success, each advertised alternative, bypass and reset |
| Graph integrity | Missing prerequisite, cycle, stuck state, impossible action ordering |
| Fairness | Zero hints, progressive hints, wrong hypothesis, meaningful feedback |
| Parser/UI | Synonyms, case/punctuation variants, empty input, missing object, discovery of available verbs |
| Accessibility | Screen reader, keyboard-only, color-blind/no-color, audio muted, simplified language, touch at narrow viewport |
| Persistence | Logout/resume, restart/replay, duplicate command, stale version |
| Multiplayer | Simultaneous solution, late joiner, solo fallback, disconnect mid-cooperation, grief attempt |
| Spoilers | User-visible events/projections/hints don't reveal hidden truth or answer |
| Canon | Established locations, cultures and history remain internally consistent |
| Runtime | Uses verified authoring/interaction API; non-integrated drafts labeled as such |

## Interpretation and iteration

If nobody can articulate the goal, improve the goal cue. If everyone knows the answer but inputs are rejected, fix intent mapping/verb synonyms with the client/API owner. If players consistently miss one required clue, add an independent clue; don't just place the same sentence three times. If players solve immediately and this is intended as an introduction, that's fine. If a hard puzzle cannot be solved after explicit hints, simplify dependencies, not merely the prose.

## Inclusive world-building

Puzzles based on music have transcript/rhythm notation; colored gems have symbols/positions; spatial maps have navigable text landmarks; tiny targets have accessible commands; linguistic wordplay has localized alternatives or a nonlinguistic route; time pressure has a non-timed alternative. Don't punish disability, reading speed or access to technology. Content warnings are appropriate for potentially distressing elements (e.g., torture devices, graphic injury), and should be separated from spoilers where possible.

## Definition of evidence

- **Structural validation** checks syntax, uniqueness, references and a bounded state model.
- **Integration validation** proves use of actual engine APIs in a running instance.
- **Blind playtesting** is necessary evidence of comprehensibility, fairness and fun.

Never present a passing static validator as proof of all three.
