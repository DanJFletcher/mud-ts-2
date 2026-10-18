# Difficulty, pacing, player cognition

## Difficulty vectors

Score target complexity qualitatively across: number of reasoning rules, number of state variables, number of dependent steps, clue dispersion, clue ambiguity, cost of testing, player coordination needs, demand for memory/notes, spatial/navigation load and motor/time pressure. Higher difficulty should mostly mean richer deductions, **not less legible input**. Never infer a reliable solve duration from design alone.

## A five-tier progression

- **Tier 1 / Introductory:** one explicit rule, obvious goal, immediate feedback, no penalty; one inference.
- **Tier 2 / Easy:** familiar rule repurposed, 2–3 steps, more than one inspectable clue.
- **Tier 3 / Moderate:** combine two simple ideas, 3–5 steps, optional branching, 3 hint levels.
- **Tier 4 / Hard:** connect separated clues, 4+ interactions, parallel paths, recoverable setbacks; avoid mandatory story choke-point.
- **Tier 5 / Expert:** several linked puzzle systems with meaningful optional discovery; extensive multiplayer tests; almost always optional or offering an alternate progression route.

## Teach → practice → twist → mastery

1. **Teach:** player can safely manipulate object A, see output B.
2. **Practice:** player predicts B from A in a nearby, low-stakes context.
3. **Twist:** change one environmental constraint; require transfer of understanding.
4. **Mastery:** combine two previously demonstrated rules; don't introduce a secret third rule at the final door.

## Pacing in a MUD

A persistent game has asynchronous visits, missed social clues, and users on mobile screens. Keep location descriptions concise with inspectable detail. Offer a log of **discovered** facts if a journal capability exists; don't leak GM truth. Make long puzzles resumable. Avoid real-time-only simultaneous switch puzzles unless alternate asynchronous methods exist and the actual server clock supports the timing.

## Measuring actual difficulty

Record **without presuming** a solve time: attempt traces, % finding core clue, requests for hints, confusion over parser syntax, number of wrong attempts, whether players understand the rule after solving, whether they found alternate routes, number abandoning. Ask blind testers: “What did you think the room wanted you to do?” If they misunderstood the *goal*, improve framing; if they understood but could not observe a critical rule, improve clue design; if they solved conceptually but the parser refused them, improve affordance/API bindings.
