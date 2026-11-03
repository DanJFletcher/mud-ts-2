# Extraction baseline

`pre-refactor-world.json` is the parsed, unmodified pack captured before the
Orraveth content refactor. `baseline-provenance.json` records source/pack SHA-256
digests and the capture command. **Do not regenerate this fixture from the
refactored implementation to fix a failing comparison.**

The equivalence test compares extraction output exactly, then applies only the
explicit dialogue/version patch when those intentional changes land. Keep this
temporary migration evidence through review and merge; remove it only in a
separate reviewed cleanup. Focused behavior tests must remain afterward.
