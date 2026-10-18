# Puzzle Master — Replit Agent Skill for MUDD

**Skill:** `puzzle-master`  
**Version:** 1.0.0 (2026-10-17)  
**Purpose:** Design and (when real APIs support it) author fair, original, multiplayer-ready puzzles for MUDD or D&D-inspired adventures.

## Install

Unzip the root `.agents/skills/puzzle-master/` directory directly into the root of your Replit workspace. Replit project skills use `.agents/skills/<skill-name>/SKILL.md`, with YAML `name`/`description` frontmatter. Replit Agent discovers and loads them when relevant (https://docs.replit.com/replitai/skills).

```
.agents/skills/
  mudd-architect/
  mudd-pwa-client/
  mudd-game-master/
  mudd-lore-wiki/
  puzzle-master/
    SKILL.md
    references/
    assets/
    examples/
    scripts/
```

Read `.agents/skills/puzzle-master/SKILL.md`, and keep its references co-located. The package does **not** modify the architecture, PWA, wiki or gameplay directly; it equips Replit Agent with design/review guidance.

## Scope of responsibility

Puzzle Master owns puzzle briefs, dependency graphs, core insight, observable clues, player interaction affordances, hint ladders, alternate solutions, replay/multiplayer reset requirements and playtesting. Game Master owns surrounding narrative/quests, Lore Wiki owns canon (never spoilers), Architect owns public APIs, and PWA Client owns components and Storybook.

The package includes an original **noncanonical** Tier-3 puzzle, *The Rainkeeper's Archive*, as `examples/rainkeeper-archive.draft.json`. The JSON is an **editorial draft format invented solely for design tests, not a supported MUDD content schema**. No existing runtime implementation, API support, story integration or human playtesting is claimed.

## Offline checks

```bash
python3 .agents/skills/puzzle-master/scripts/validate_puzzle_draft.py \
  .agents/skills/puzzle-master/examples/rainkeeper-archive.draft.json
python3 .agents/skills/puzzle-master/scripts/test_validator.py
```

These require only Python 3 and check finite boolean-state reachability, solution traces, references, etc. A successful check does not verify quality or integration. Blind-test against player-facing text and real clients before publication.

## Suggested first Replit prompt

> Use `puzzle-master` with `mudd-architect` and `mudd-game-master` to design an original, Tier-2 puzzle for our existing three-room world. Begin by inspecting the actual world lore and public content/interaction APIs. Write the puzzle brief, player-facing descriptions, a state/transition diagram, three independent clues if required for critical progression, three opt-in hints, a primary and alternate solution, and a player-safe failure response. If the engine already has appropriate public interaction/publishing capabilities, integrate and test the puzzle using those real contracts. If not, leave it as a clearly labeled content draft and produce a narrowly scoped contract gap request. Do not create a custom endpoint, bypass the authoritative engine, or edit the public lore wiki with solution spoilers.

## Research and attribution

See `references/RESEARCH_AND_SOURCES.md` for first-party design sources from Clara Fernández-Vara (GDC), Ron Gilbert, Justin Alexander, Emily Short and the Game Accessibility Guidelines, plus MUDD-specific synthesis and licensing cautions.
