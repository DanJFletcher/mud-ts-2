# Provenance and what was actually written

The user and assistant designed four Replit Agent skills earlier in this project. The artifacts were available in the current conversation's workspace and examined while compiling this package.

## Authoring sources included verbatim

1. **MUDD Architect** (original ZIP: `mudd-architect-replit-skill.zip`)
   - `assets/PLUGIN_CONTRACT.example.ts`: plugin manifest, command context, ClockPort, RngPort, GamePlugin, CommandRegistry, etc. It explicitly calls itself *illustrative*.
   - `assets/MESSAGE_CONTRACTS.example.ts`: `MoveCharacterCommand`, `CharacterMovedEvent`, `CommandReceipt` Zod schemas. It explicitly calls the messages illustrative.
   - `references/ARCHITECTURE.md`, `STATE_AND_PROTOCOL.md`, `PLUGIN_SYSTEM.md`, `DATA_MODEL.md`, `CLIENTS_AND_REPLIT.md`: conceptual design contract requirements, not verified exports.
2. **MUDD PWA Client** (`mudd-pwa-client-replit-skill.zip`)
   - `references/MUDD_CLIENT_BOUNDARIES.md`: client/engine separation, UI view models, reconnect behavior. UI view models are deliberately **not** engine wire schemas.
3. **MUDD Game Master** (`mudd-game-master-replit-skill.zip`)
   - `assets/CONTENT_PORT.example.ts`: capability inventory, preflight and proposed authoring adapter. Header explicitly states these are **not verified MUDD public APIs**.
   - `references/PUBLIC_API_AND_CONTENT.md`: repository discovery requirement and no-bypass publishing rules.
4. **MUDD Lore Wiki** (`mudd-lore-wiki-replit-skill.zip`)
   - Wiki-only skill; no public engine contract was produced, so its templates are not presented as engine contracts.

The `originals/` directory preserves the first three sources **without alteration**. The `src/` code uses source ideas but harmonizes them into a proposed package (some fields and additional schemas are newly designed for coherence). Therefore these proposed modules must not be misrepresented as exact prior implementations.
