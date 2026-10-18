#!/usr/bin/env python3
"""Validate puzzle-master EDITORIAL DRAFT v1, NOT any MUDD engine API.

Uses Python stdlib only. Checks schema basics, references, solution traces,
reachability and dead-end states of small finite boolean models. This is not a
substitute for a runtime integration test or a blind human playtest.
"""
import argparse
import json
import sys
from collections import deque
from pathlib import Path

FORMAT = "puzzle-master/editorial-draft/v1"


def analyze(draft):
    errors = []
    warnings = []
    if not isinstance(draft, dict):
        return ["Root must be a JSON object"], [], {}
    if draft.get("draftFormat") != FORMAT:
        errors.append(f"draftFormat must be {FORMAT}")
    if draft.get("status") != "NONCANONICAL_NOT_AN_ENGINE_API":
        errors.append("Mark editorial draft as noncanonical and not an engine API")
    for key in ("id", "title", "goal", "worldPurpose", "feedbackOnInvalidAction", "resets"):
        if not isinstance(draft.get(key), str) or not draft.get(key).strip():
            errors.append(f"Missing nonempty string: {key}")
    if type(draft.get("difficulty")) is not int or not 1 <= draft["difficulty"] <= 5:
        errors.append("difficulty must be an integer from 1 to 5")

    initial = draft.get("state")
    completion = draft.get("completion")
    if not isinstance(initial, dict) or not initial or not all(type(x) is bool for x in initial.values()):
        return errors + ["state must be a nonempty map of boolean values"], warnings, {}
    if not isinstance(completion, dict) or not completion or any(
        k not in initial or type(v) is not bool for k, v in completion.items()
    ):
        errors.append("completion must be a nonempty mapping to known boolean state keys")
        completion = {}

    actions = draft.get("actions")
    if not isinstance(actions, list) or not actions:
        return errors + ["actions must be a nonempty list"], warnings, {}
    if any(not isinstance(a, dict) for a in actions):
        return errors + ["every action must be an object"], warnings, {}
    ids = [a.get("id") for a in actions]
    if any(not isinstance(x, str) or not x for x in ids) or len(ids) != len(set(ids)):
        errors.append("action ids must be unique nonempty strings")
    byid = {a.get("id"): a for a in actions if isinstance(a.get("id"), str)}
    aliases = {}
    for a in actions:
        aid = a.get("id", "<invalid>")
        for field in ("requires", "effects"):
            values = a.get(field)
            if not isinstance(values, dict):
                errors.append(f"{aid}: {field} must be a map")
                continue
            for k, v in values.items():
                if k not in initial or type(v) is not bool:
                    errors.append(f"{aid}: invalid {field} key/value: {k}")
        if not isinstance(a.get("feedback"), str) or not a["feedback"].strip():
            errors.append(f"{aid}: missing feedback")
        for alias in a.get("aliases", []):
            if not isinstance(alias, str) or not alias.strip():
                errors.append(f"{aid}: invalid alias")
                continue
            norm = alias.casefold().strip()
            if norm in aliases and aliases[norm] != aid:
                errors.append(f"Alias collision: {alias}")
            aliases[norm] = aid

    clues = draft.get("clues", [])
    if not isinstance(clues, list) or any(not isinstance(c, dict) for c in clues):
        errors.append("clues must be an array of objects")
        clues = []
    clueids = [c.get("id") for c in clues]
    if len(set(clueids)) != len(clueids) or any(not isinstance(x, str) or not x for x in clueids):
        errors.append("clue ids must be unique nonempty strings")
    for clue in clues:
        if not isinstance(clue.get("playerText"), str) or not clue["playerText"].strip():
            errors.append(f"clue {clue.get('id')}: missing playerText")
    for cid, aids in draft.get("clueToActions", {}).items():
        if cid not in clueids:
            errors.append(f"clueToActions refers to unknown clue: {cid}")
        if not isinstance(aids, list):
            errors.append(f"clueToActions {cid} must map to a list")
        else:
            for aid in aids:
                if aid not in byid:
                    errors.append(f"clueToActions {cid} refers to unknown action: {aid}")

    hints = draft.get("hints", [])
    if not isinstance(hints, list):
        errors.append("hints must be a list")
    elif sorted([h.get("level") for h in hints if isinstance(h, dict)]) != [1, 2, 3] or len(hints) != 3:
        errors.append("Need distinct hint levels 1, 2, 3")
    elif not all(isinstance(h.get("text"), str) and h["text"].strip() for h in hints):
        errors.append("Every hint needs nonempty text")

    def goal(state):
        return bool(completion) and all(state.get(k) == v for k, v in completion.items())

    def enabled(action, state):
        req = action.get("requires", {})
        return isinstance(req, dict) and all(state.get(k) == v for k, v in req.items())

    def apply(action, state):
        nxt = state.copy()
        nxt.update(action.get("effects", {}))
        return nxt

    for solution in draft.get("solutions", []):
        sid = solution.get("id", "<unnamed>")
        st = initial.copy()
        trace = solution.get("actions")
        if not isinstance(trace, list) or not trace:
            errors.append(f"solution {sid}: empty trace")
            continue
        for aid in trace:
            action = byid.get(aid)
            if not action:
                errors.append(f"solution {sid}: unknown action {aid}")
                break
            if not enabled(action, st):
                errors.append(f"solution {sid}: unmet preconditions at action {aid}")
                break
            st = apply(action, st)
        else:
            if not goal(st):
                errors.append(f"solution {sid}: trace does not reach completion")
    if len(draft.get("solutions", [])) < 2:
        warnings.append("Only one advertised solution path; consider alternate/bypass for mandatory gating")

    if len(initial) > 16:
        warnings.append("State has >16 booleans; bounded BFS skipped; use a specialized model checker")
        return errors, warnings, {}
    keys = tuple(sorted(initial))
    encode = lambda state: tuple(state[k] for k in keys)
    q = deque([(initial, [])])
    seen = {encode(initial)}
    successes = []
    deadends = []
    while q:
        st, path = q.popleft()
        if goal(st):
            successes.append(path)
            continue
        enabled_actions = [a for a in actions if enabled(a, st)]
        next_states = 0
        for a in enabled_actions:
            nxt = apply(a, st)
            if encode(nxt) != encode(st):
                next_states += 1
            coded = encode(nxt)
            if coded not in seen:
                seen.add(coded)
                q.append((nxt, path + [a["id"]]))
        if next_states == 0:
            deadends.append(path)
    if not successes:
        errors.append("Completion not reachable by any BFS action sequence")
    if deadends:
        errors.append(f"Found {len(deadends)} reachable dead-end noncomplete state(s)")
    if draft.get("gateType") == "critical" and not draft.get("fallback"):
        errors.append("Critical gate must document fallback or safe bypass")
    count_inferences = {}
    for c in clues:
        name = c.get("inference")
        if name:
            count_inferences[name] = count_inferences.get(name, 0) + 1
    if draft.get("gateType") == "critical" and any(v < 3 for v in count_inferences.values()):
        warnings.append("Critical puzzle: consider three independent clues for required inferences")

    return errors, warnings, {"reachable_states": len(seen), "successful_states": len(successes), "shortest_solution": successes[0] if successes else None}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("file", type=Path)
    a = p.parse_args()
    try:
        data = json.loads(a.file.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        print(f"ERROR: cannot read JSON: {e}", file=sys.stderr)
        return 2
    errors, warnings, stats = analyze(data)
    for message in errors:
        print(f"ERROR: {message}")
    for message in warnings:
        print(f"WARNING: {message}")
    print(f"STATE CHECK: {stats}")
    if errors:
        print(f"INVALID: {len(errors)} issue(s)")
        return 1
    print("VALID EDITORIAL STRUCTURE ONLY — engine binding and blind playtest NOT verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
