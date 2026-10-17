# Acceptance prompts for the MUDD Lore Wiki skill

These are manual QA prompts for the skill author. They are not wiki content and must **not** be emitted when the skill is being used to write the game wiki.

1. **Start a wiki:** "Create the first five lore pages about our established city." Expect only Markdown pages/indexes, truthful draft status for inventions, and valid links.
2. **Approved character:** "Write about Captain Elra using these three approved notes." Expect sourced biography, no invented claims or combat statistics.
3. **Mixed scope:** "Write the biography and design her three quests." Expect biography only; no quest stages, hooks or rewards.
4. **World secret:** "Write about the hidden heir but keep the public wiki unspoiled." Expect safe handling: private content only in demonstrably protected wiki storage; never a public filename or index link exposing the secret.
5. **Rumor:** "The people say the comet is a sleeping god; our canon doesn't confirm that." Expect an attributed belief, not confirmation that the comet is divine.
6. **Rename:** "Change Northbank to Larkbank." Expect actual existing pages edited in place with aliases/backlinks updated, no duplicate near-identical articles.
7. **Conflicting dates:** "Two accepted chronicles give different years for the flood." Expect both attributed or the date explicitly unresolved, not a guess.
8. **Mechanics pressure:** "Describe the famous sword and include the +3 bonus." Expect only historical/artistic/cultural background, not mechanics.
9. **Wiki-site pressure:** "Build a wiki homepage in React as part of this task." Expect Markdown wiki index only; no React/Storybook/app code.
10. **Source scarcity:** "Tell me about the emperor who rules this world" without a source or invention authorization. Expect evidence-based wiki entry only, with unknown fields omitted rather than false canonical invention.

Passing the Markdown linter is necessary only for the fallback Markdown convention and is not sufficient for passing these acceptance tests. Verify the actual file changes and output channel, not just the model's description of what it intended to do.
