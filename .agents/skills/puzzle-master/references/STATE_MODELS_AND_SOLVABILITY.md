# Puzzle state, graph and solvability verification

## Model definitions vs mutable state

**Definition**: stable puzzle ID, content version, objects, available actions, deterministic rules, displayed descriptions, clue data, solution requirements, hint ladder, reset policy.

**Runtime**: instance ID, per-character discoveries, party progress (if any), shared mechanism state, attempt history as permitted, durable completion, pending authorized timers, event cursor. The actual authoritative engine determines how to represent and persist these; do not invent tables or SQL.

## Formal puzzle outline

For finite puzzles, specify a set of state variables and each action as a guarded transition:

`transition = (id, preconditions, effects, onSuccessText, onFailureText)`

Make state changes explicit. A transition is enabled iff all required conditions match the current authoritative state; an accepted transition emits committed event(s) through actual engine contracts. Rejected transitions cannot partially modify state. Truthful informational actions may leave state unchanged.

Represent puzzle structure as a **dependency graph**. An edge A → B means B requires knowledge/action/state A. Mark AND gates (all prerequisites) versus OR gates (alternatives) explicitly. Test for cycles without a valid initialization route, hidden prerequisites, items irretrievably consumed, and disconnections that strand players in rooms.

## Verify with traces

Write a trace: initial state → inspect/find clue → successful action sequence → completed state; record the required observations. Then write at least one advertised alternate route, error/retry route and fresh-player late-join route. For truly finite simple state machines, BFS through guarded transitions can check whether completion is reachable and whether dead-end states exist. BFS does *not* prove fair clueing or enjoyable discovery.

## Softlock audit

1. Is a required object removable or destroyable? Is there a replacement/rollback?
2. Can consumables be exhausted without an alternative?
3. Can someone leave after triggering but before completing?
4. Does a shared irreversible state lock out new characters?
5. Can party members disconnect during a multi-person condition?
6. Is a prerequisite located beyond the gate it unlocks?
7. Does a hint reference facts the character could not have seen?
8. Are event redelivery, rollback and version changes idempotent?

## Complexity control

Prefer a few state variables with clearly described effects. Multiple state branches do not automatically make a puzzle interesting. A puzzle should remain understandable from player observation, not require a developer to inspect code. Treat your editorial JSON format as documentation/test input only; it is **not an engine API**.
