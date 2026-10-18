---
name: Puzzle-master skill source
description: How to find the puzzle-master instructions when they are absent from the active local skill directories.
---

The puzzle-master skill bundle may be tracked in Git under `.agents/skills/mudd-puzzle-master-replit-skill/.agents/skills/puzzle-master/` while missing from the active skill registries. In this case, `git ls-tree -r --name-only HEAD` and `git show HEAD:<path>` can locate and read it without restoring the bundle.

**Why:** The ordinary skill directory lookup and search returned no match even though the requested skill was in the repository’s tracked bundle.

**How to apply:** When a user names `puzzle-master` or `/puzzle-master`, inspect the nested tracked bundle before concluding the skill is unavailable. Keep this read-only unless the user separately asks to restore skill files.
