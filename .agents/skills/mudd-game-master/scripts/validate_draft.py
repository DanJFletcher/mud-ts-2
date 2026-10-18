#!/usr/bin/env python3
"""Static linter for the bundled ORIGINAL editorial draft only.

NOT a MUDD importer, NOT runtime rules validation, NOT a public API validator.
Requires PyYAML: python -m pip install pyyaml
"""
import argparse
from collections import Counter, defaultdict
from pathlib import Path
import sys

try:
    import yaml
except ImportError:
    print('Install PyYAML first: python -m pip install pyyaml', file=sys.stderr)
    raise SystemExit(2)


def inspect(data):
    errors = []
    warnings = []

    def err(msg):
        errors.append(msg)

    if not isinstance(data, dict):
        return ['Root must be a mapping'], []
    if data.get('format') != 'mudd-gm-editorial-draft/v0':
        err('Only the bundled editorial draft/v0 format is supported')
    if data.get('importable') is not False:
        err('Draft must declare importable: false to avoid confusing it with a real MUDD pack')

    groups = ['factions', 'facts', 'locations', 'npcs', 'clues', 'quests']
    by_kind = {}
    all_entries = []
    for kind in groups:
        values = data.get(kind, [])
        if not isinstance(values, list):
            err(f'{kind} must be a list')
            values = []
        by_kind[kind] = {}
        for entry in values:
            if not isinstance(entry, dict) or not isinstance(entry.get('id'), str):
                err(f'{kind} entry has no string id')
                continue
            key = entry['id']
            all_entries.append(key)
            if key in by_kind[kind]:
                err(f'duplicate {kind} id: {key}')
            by_kind[kind][key] = entry
            if not key.startswith('example.briarfen.'):
                warnings.append(f'unexpected example namespace: {key}')
    dupes = [key for key, n in Counter(all_entries).items() if n > 1]
    for key in dupes:
        err(f'ID reused across groups: {key}')

    locations = by_kind['locations']
    npcs = by_kind['npcs']
    factions = by_kind['factions']
    facts = by_kind['facts']
    clues = by_kind['clues']
    inspectables = {}
    graph = defaultdict(set)

    for location in locations.values():
        lid = location['id']
        if not location.get('arrival') or not location.get('look'):
            err(f'location {lid} missing arrival/look text')
        exits = location.get('exits', [])
        if not exits:
            warnings.append(f'isolated/no-exit location: {lid}')
        for edge in exits:
            dest = edge.get('to') if isinstance(edge, dict) else None
            if dest not in locations:
                err(f'unknown destination {dest!r} from {lid}')
            else:
                graph[lid].add(dest)
        for npc in location.get('npcs', []):
            if npc not in npcs:
                err(f'unknown NPC {npc} in {lid}')
        for obj in location.get('inspectables', []):
            key = obj.get('id') if isinstance(obj, dict) else None
            if not key or key in inspectables:
                err(f'duplicate/bad inspectable id: {key!r}')
            else:
                inspectables[key] = obj
            if obj.get('clue') and obj['clue'] not in clues:
                err(f'inspectable {key} refers to nonexistent clue {obj["clue"]}')

    for npc in npcs.values():
        if npc.get('home') not in locations:
            err(f'NPC {npc["id"]} has unknown home')
        if npc.get('faction') not in factions:
            err(f'NPC {npc["id"]} has unknown faction')
        for fid in npc.get('knows', []):
            if fid not in facts:
                err(f'NPC {npc["id"]} knows unknown fact {fid}')

    clues_per_fact = Counter()
    for clue in clues.values():
        if clue.get('source') not in inspectables:
            err(f'clue {clue["id"]} source not an inspectable')
        fact = clue.get('supports')
        if fact not in facts:
            err(f'clue {clue["id"]} supports unknown fact {fact}')
        else:
            clues_per_fact[fact] += 1
    for fact in facts.values():
        for cid in fact.get('revealVia', []):
            if cid not in clues:
                err(f'fact {fact["id"]} reveals via unknown clue {cid}')

    for quest in by_kind['quests'].values():
        qid = quest['id']
        required = quest.get('requiredDiscoverableFact')
        if required not in facts:
            err(f'quest {qid} required fact is missing')
        elif clues_per_fact[required] < 3:
            warnings.append(f'quest {qid} has < 3 clues for required conclusion {required}')
        outcomes = quest.get('possibleOutcomes', [])
        if len(outcomes) < 2:
            err(f'quest {qid} needs at least 2 outcomes')
        if len({o.get('id') for o in outcomes}) != len(outcomes):
            err(f'quest {qid} outcome IDs are not unique')
        if not quest.get('scope') or not quest.get('characterJournalScope'):
            err(f'quest {qid} needs explicit world/character state scopes')

    if locations:
        first = next(iter(locations))
        reached = {first}
        frontier = [first]
        while frontier:
            cur = frontier.pop()
            for nxt in graph[cur]:
                if nxt not in reached:
                    reached.add(nxt)
                    frontier.append(nxt)
        for lid in set(locations) - reached:
            err(f'location unreachable from {first}: {lid}')

    warnings.append('EDITORIAL DRAFT ONLY: This does NOT validate any actual MUDD API or make a playable pack.')
    return errors, warnings


def main():
    default = Path(__file__).resolve().parent.parent / 'assets' / 'ORIGINAL_STARTER_WORLD.draft.yaml'
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path', nargs='?', type=Path, default=default)
    args = parser.parse_args()
    try:
        data = yaml.safe_load(args.path.read_text(encoding='utf-8'))
    except (OSError, yaml.YAMLError) as ex:
        print(f'Failed to read draft: {ex}', file=sys.stderr)
        return 2
    errors, warnings = inspect(data)
    for warning in warnings:
        print('WARNING:', warning)
    for error in errors:
        print('ERROR:', error)
    if errors:
        print(f'FAIL: {len(errors)} error(s), {len(warnings)} warning(s)')
        return 1
    print(f'PASS: editorial structural lint ({len(warnings)} warning(s)). NOT runtime-verified.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
