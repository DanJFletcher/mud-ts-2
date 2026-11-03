import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { WorldPackDraft } from '@mudd/contracts';
import baseline from './__fixtures__/pre-refactor-world.json' with { type: 'json' };
import provenance from './__fixtures__/baseline-provenance.json' with { type: 'json' };
import { orravethWorld } from './index.js';

// This patch is deliberately independent of the refactored content modules.
// Every other field must remain byte-for-value equivalent to the captured pack.
function expectedWorld() {
  // The captured JSON is already parsed; do not reparse and normalize away differences.
  const expected = structuredClone(baseline) as WorldPackDraft;
  expected.packVersion = '1.21.1';
  const anwen = expected.locations.flatMap((location) => location.npcs ?? [])
    .find(({ id }) => id === 'anwen-marr')!;
  const actionIds = ['ask-anwen-about-mill', 'ask-anwen-about-church-sword',
    'report-mill-ledger', 'return-church-sword-to-anwen'];
  for (const id of actionIds) {
    anwen.dialogue!.choices.find((choice) => choice.id === id)!.hideAfterProgressFlagIds = [];
  }
  const boatman = expected.locations.flatMap((location) => location.npcs ?? [])
    .find(({ id }) => id === 'rillford-independent-boatman')!;
  boatman.topics.find(({ id }) => id === 'ferry')!.keywords =
    ['ferry guild', 'ferry dispute', 'guild', 'rights', 'exclusive', 'dispute'];
  boatman.topics.find(({ id }) => id === 'passage')!.keywords =
    ['passage', 'crossing', 'boat', 'across', 'ferry stage', 'ferry'];
  return expected;
}

describe('content extraction equivalence', () => {
  it('preserves the independently captured parsed pack except the explicit dialogue patch', () => {
    expect(orravethWorld).toStrictEqual(expectedWorld());
  });

  it('keeps the captured baseline intact', () => {
    const bytes = readFileSync(new URL('./__fixtures__/pre-refactor-world.json', import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.packSha256);
  });

  it.each(['identity', 'order', 'reward'])('detects accidental %s changes', (kind) => {
    const expected = expectedWorld();
    const changed = structuredClone(expected);
    if (kind === 'identity') changed.locations[0]!.id = 'changed';
    if (kind === 'order') changed.locations.reverse();
    if (kind === 'reward') {
      const bandit = changed.roads.flatMap((road) => road.encounters)
        .find((encounter) => encounter.loot?.currencyAmount)!;
      bandit.loot!.currencyAmount = 999;
    }
    expect(changed).not.toStrictEqual(expected);
  });
});
