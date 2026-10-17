# MUDD Game Master — Replit Agent Skill

**Narrative game design + worlds + NPCs + dialogue + quests + public API integration.**

A companion to `mudd-architect` and `mudd-pwa-client`, designed to turn creative work into maintainable, playable MUDD world content instead of scattered prose, client-side quest logic or unauthorized event-store edits.

## Installation

Extract the ZIP **into the root of your existing Replit repository**, keeping its hidden `.agents` directory. It installs:

```text
.agents/
  skills/
    mudd-architect/           # existing skill — keep
    mudd-pwa-client/          # existing skill — keep
    mudd-game-master/         # new skill
      SKILL.md
      references/
      assets/
      scripts/
```

Do not delete or replace the other two skill directories. Replit discovers relevant skills from `.agents/skills`. Invoke `mudd-game-master` explicitly if needed, or ask Replit Agent for world/narrative/quest design.

## What the skill does

- Builds a **world bible**, consistency ledger, travel links, faction motives, changing pressures and original world lore.
- Authors **distinct NPCs** with voices, motivations, knowledge limits, rumors, conversation graphs and reactions.
- Designs **quests as player-directed situations**, with alternative paths, clue redundancy, explicit state scope, branch consequences, failure-forward planning and repeat/reconnect behavior.
- Binds content to **real discovered public MUDD APIs** (authoring/import, commands/queries/events, permissions and available rulesets) and refuses to substitute direct database changes or invented endpoints.
- Designs for **persistent multiplayer**, text/PWA/voice accessibility, authoring version upgrades and tests.
- Provides **templates, a TypeScript integration-boundary sketch, an original 4-location sample world and a draft structural linter**.

## Read this before implementation

This skill cannot know what APIs are already implemented in your actual MUDD repository. The architectural sketches and `ORIGINAL_STARTER_WORLD.draft.yaml` are **design artifacts, not canonical engine schemas or importable packs**. The Replit Agent must inspect your repository and discover genuine exported APIs first. If quest/world authoring APIs are missing, it should leave a capability gap request for `mudd-architect`, not bypass the architecture.

## Recommended first task for Replit Agent

> Use `mudd-game-master` alongside `mudd-architect` to examine this repository's **actual public authoring and game client APIs**. First produce an API/capability inventory; do not invent methods or import formats. Then design and implement the smallest playable original setting: a 4-room village, 2 NPCs with opposing motives, 3 clues, and one quest with at least two materially different resolutions. Write the world bible and content pack in the repository's accepted schema, validate its references, bind choices to authoritative commands/events, and test persistence, duplicate submission, secret visibility and two-player concurrency where the engine supports them. If a capability is missing, produce a clear proposed contract for `mudd-architect` and mark that content integration blocked. Do not generate a whole campaign before this slice works.

## Optional draft-only lint

The included sample can be checked without MUDD installed:

```bash
python -m pip install pyyaml
python .agents/skills/mudd-game-master/scripts/validate_draft.py
```

**This lints only the bundled example's internal references.** It is not a real MUDD schema validator and does not prove that any runtime feature works.

## Research included

See `references/RESEARCH_AND_SOURCES.md` for original research links: MDA (AAAI); Justin Alexander's situation / node / three-clue scenario design; Ink and Yarn Spinner's dialogue authoring concepts; Emily Short's interactive fiction craft; scholarly work on NPC consistency; Blades in the Dark progress clocks; official Replit/Agent Skill conventions; and official D&D SRD license information.

User-provided D&D books and the *Death House* introductory adventure are **private reference inputs only**, not copied or bundled as public content.

## Compatibility and file layout

All files use standard `SKILL.md` metadata and relative resource references. No private credentials or external dependencies are required for the skill itself. It is intentionally **ruleset-neutral** and assumes the MUDD codebase can evolve over time without requiring a rewrite of the content-design methodology.
