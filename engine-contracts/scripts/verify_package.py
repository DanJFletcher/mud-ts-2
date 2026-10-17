#!/usr/bin/env python3
"""Offline packaging checks. Does not claim TS/runtime compliance."""
from pathlib import Path
import json
root = Path(__file__).resolve().parents[1]
required = [
    'README.md', 'package.json', 'tsconfig.json',
    'src/index.ts', 'src/ids.ts', 'src/protocol.ts', 'src/movement.ts',
    'src/plugins.ts', 'src/event-store.ts', 'src/client.ts', 'src/authoring.ts',
    'originals/architect/MESSAGE_CONTRACTS.example.ts',
    'originals/architect/PLUGIN_CONTRACT.example.ts',
    'originals/game-master/CONTENT_PORT.example.ts',
    'docs/CONTRACT_CATALOG.md', 'docs/SOURCE_MAP.md',
]
for rel in required:
    assert (root / rel).is_file(), f'Missing {rel}'
package = json.loads((root/'package.json').read_text())
assert package['private'] is True
assert package['name'] == '@mudd/contracts-proposal'
for f in (root/'src').glob('*.ts'):
    source = f.read_text()
    assert any(word in source.lower() for word in ('proposed', 'proposal', 'draft')), f'{f.name} not clearly marked proposal'
for rel in ('originals/architect/MESSAGE_CONTRACTS.example.ts',
            'originals/architect/PLUGIN_CONTRACT.example.ts',
            'originals/game-master/CONTENT_PORT.example.ts'):
    assert 'example' in rel
print(f'Offline checks passed: {len(required)} required files, {len(list((root / "src").glob("*.ts")))} source modules')
