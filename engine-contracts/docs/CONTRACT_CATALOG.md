# Contract catalog and maturity

| Capability | Proposed file | Earlier source | Maturity in this ZIP |
| --- | --- | --- | --- |
| Plugin manifest, lifecycle, registry, capability tokens | `src/plugins.ts` | Architect `PLUGIN_CONTRACT.example.ts`, `PLUGIN_SYSTEM.md` | **Original illustrative example**, consolidated/extended |
| Movement command and movement outcome event | `src/movement.ts` | Architect `MESSAGE_CONTRACTS.example.ts` | **Original illustrative example**, near-verbatim wire shape |
| Command receipt and stable errors | `src/protocol.ts` | Architect `MESSAGE_CONTRACTS.example.ts`, `STATE_AND_PROTOCOL.md` | Original example + proposed extra codes |
| Runtime command/query/event metadata | `src/protocol.ts` | Architect `STATE_AND_PROTOCOL.md` | Proposed unified envelope |
| Trusted session and ownership authorization | `src/session.ts` | Architect `ARCHITECTURE.md`, `STATE_AND_PROTOCOL.md` | Proposed interface only |
| Character creation/read model | `src/character.ts` | Architect `ARCHITECTURE.md`, `DATA_MODEL.md` | New proposed schema; NOT an earlier concrete API |
| World location/exits/content pack | `src/world.ts` | Architect `ARCHITECTURE.md`, `DATA_MODEL.md` | New proposed draft schema; no importer guaranteed |
| Describe/look query & filtered projections | `src/world.ts` | Architect `STATE_AND_PROTOCOL.md` | Proposed query/view |
| Chat command/event | `src/chat.ts` | Architect `ARCHITECTURE.md`, PWA `MUDD_CLIENT_BOUNDARIES.md` | New proposed schema |
| Combat action/view | `src/combat.ts` | Architect `ARCHITECTURE.md`, PWA `MUDD_CLIENT_BOUNDARIES.md` | DRAFT seam only; no ruleset semantics |
| Clock, RNG, turn | `src/clock-rng.ts` | Architect `PLUGIN_CONTRACT.example.ts`, `STATE_AND_PROTOCOL.md` | Original clock/RNG interfaces + proposed turn port |
| Append-only storage/replay/idempotency | `src/event-store.ts` | Architect `STATE_AND_PROTOCOL.md`, `DATA_MODEL.md` | Proposed port; storage not implemented |
| Subscribe/snapshot/resume | `src/stream.ts`, `src/network.ts` | Architect `STATE_AND_PROTOCOL.md`, PWA client boundaries | Proposed protocol format |
| Shared PWA/TTY client SDK facade | `src/client.ts` | Architect `CLIENTS_AND_REPLIT.md` | Earlier conceptual interface, formalized |
| Authoring API discovery/preflight/authorized publish | `src/authoring.ts` | GM `CONTENT_PORT.example.ts`, `PUBLIC_API_AND_CONTENT.md` | Original sketch reformulated; **not verified public API** |
| Postgres/Drizzle persistence schemas | `docs/PERSISTENCE_REQUIREMENTS.md` | Architect `DATA_MODEL.md` | Suggested tables only; no migrations |
| Lore wiki | — | Lore Wiki skill | Non-engine content; no API contracts created |
| Quest, crafting, economy, land, MUD-Lang, procedural generation | — | Architect roadmap, Game Master skill | **Future capabilities**, not bundled as fake implemented interfaces |

**Important:** `src/` is a proposal designed to be compiled and tested in isolation; it has no right to claim compatibility with an existing MUDD repo without inspection. Names and fields can be refined by ADRs before adoption.
