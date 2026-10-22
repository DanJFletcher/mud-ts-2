# Bell Tower Undercrypt

## Puzzle brief

The undercrypt is an optional, character-scoped side route beneath the Bell
Tower. Its corridors form an east route and a lower-risk, puzzle-opened west
route that meet at the North Junction. The Echo Gallery is concealed off the
Crossway; the Flooded Archive lies beyond the junction, and the Reliquary is the
terminal room at the end. The old bellwrights built two mechanisms to protect
their workshop: an echo gate and a balance-and-reflection gate. Players can
recover a defensive vest and the bellwright sword Echoedge at the end.

The dungeon has its own `bell-tower-undercrypt` map area at level 0. Its doors,
puzzle progress, and loot use the existing character-owned item-use and
character-item event behavior; no shared door or unique world-loot state is
introduced.

## Corridor maze and encounters

- From the entry passage, Rattle Run leads to the Crossway.
- The eastern corridor loops through East Bend, East Passage, East Crawl, and
  East Turn before returning to the North Junction. A drainage niche is a
  reversible dead end.
- The Echo Gallery branches west from the Crossway. Solving its echo mechanism
  opens an alternate route through West Passage and West Turn to the North
  Junction. The eastern route remains available if players skip this puzzle;
  it has more rat-exposed corridor steps.
- Both routes reach the Flooded Archive; its mechanism opens the Reliquary
  Approach. The Reliquary, containing Echoedge, is the last room and has only
  its return exit.
- Giant Rats have a 15% chance to appear on each step of the authored west and
  east corridor roads. Puzzle rooms, the final approach, and the Reliquary are
  not random-encounter segments.

## Puzzle 1: Echo Gallery

**Goal:** raise the north bar and open the hidden western route.

**Authored facts and actions**

- A pale tuning stone fits the marked bowl.
- An undercrypt reed fits the split bronze pipe.
- Use the stone on the bowl, then the reed on the pipe.
- The reed interaction is guarded by the stone interaction. An early reed use
  returns a clue-based message and changes no state.
- The gallery is reached from the Crossway's west exit.
- Completing both interactions opens the north exit to West Passage. The east
  return to the Crossway stays available throughout.
- The main eastern route can reach the North Junction without this shortcut, so
  the puzzle is optional and cannot softlock dungeon progress.

**Clue ledger**

| Inference | Player-facing evidence | Testable prediction |
| --- | --- | --- |
| The stone belongs in the bowl | Rubbing names the pale stone and low note; bowl description names the matching hollow | The stone produces a low tone |
| The reed belongs in the pipe | Rubbing names the hollow note; pipe description names the reed-shaped split | The reed carries a second note |
| Order matters | Rubbing says low note before hollow note; early-use feedback repeats this rule | Reed-before-stone is rejected without losing either item |

**Solution trace:** enter the maze from the Undercrypt Entry Passage; follow
Rattle Run to the Crossway and take its west exit; take the two quest-bound
puzzle items; read the rubbing; use pale tuning stone on stone bowl; use
undercrypt reed on split bronze pipe; take the north exit into West Passage.

## Puzzle 2: Flooded Archive

**Goal:** open the east door to the Reliquary Approach.

**Authored facts and actions**

- The silver balance weight fits the dry scale.
- The mirror shard fits the water plinth face-up.
- Use the weight first, then the shard.
- The shard interaction is guarded by the weight interaction. An early shard
  use returns a clue-based message and changes no state.
- Completing both interactions opens the east exit to the Reliquary Approach.
  The south return exit to North Junction stays available throughout.

**Clue ledger**

| Inference | Player-facing evidence | Testable prediction |
| --- | --- | --- |
| The weight belongs on the dry scale | Ledger names the dry pan; scale description specifies the round hollow | The weight clicks the counterweight |
| The shard belongs on the wet plinth | Ledger names reflection; plinth description specifies a mirror groove | Face-up placement sends light across the ceiling |
| Order matters | Ledger says balance before reflection; early-use feedback repeats the rule | Shard-before-weight is rejected without losing either item |

**Solution trace:** reach the Flooded Archive from North Junction; take the
silver weight, mirror shard, and optional loot; read the ledger; use silver
balance weight on dry balance scale; use mirror shard on water plinth; take the
east exit through the Reliquary Approach to the Reliquary.

## Safety, scope, and verification

- Puzzle tools are quest-bound, reusable, and never consumed. Wrong-order attempts
  do not alter puzzle state. Dead ends and corridor branches have return exits.
- The gates are not required for the main bell quest, so there is no main-story
  softlock or puzzle bypass requirement. The key remains available from the
  previously opened Underhollow door path.
- Puzzle observations and loot are character-scoped. Another character can
  solve and collect their own copy; these are not shared, globally scarce drops.
- The public client integration test follows both correct traces, tries each
  wrong order, verifies locked exits before completion, traverses the maze roads,
  returns through the dungeon, and takes/equips both armor and the final sword.
- This is scripted integration evidence, not a blind human playtest. MUDD has no
  progressive hint command for this content; the in-room inscriptions provide
  explicit, repeatable clues.
