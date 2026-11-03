import { describe, expect, it } from 'vitest';
import { smallTalkChoices, type SmallTalkOptions } from './dialogue.js';

const options: SmallTalkOptions = {
  npcId: 'resident', identity: 'I am a resident.', activity: 'Working.',
  town: { key: 'bellwold', name: 'Bellwold', response: 'A small town.' },
  additionalQuestions: [{ id: 'work', label: 'What work?', response: 'Repairs.' }],
};

describe('small talk visibility and identity', () => {
  it('defaults initial hiding and follow-up prerequisites to the town flag', () => {
    const choices = smallTalkChoices(options);
    expect(choices.slice(0, 3).every((choice) =>
      choice.hideAfterProgressFlagIds?.includes('resident-asked-about-town'))).toBe(true);
    expect(choices[3]?.requiresProgressFlagIds).toEqual(['resident-asked-about-town']);
  });

  it('treats explicit empty conditions as no conditions', () => {
    const choices = smallTalkChoices({ ...options, hideInitialChoicesAfterProgressFlagIds: [],
      additionalQuestions: [{ ...options.additionalQuestions![0]!, requiresProgressFlagIds: [] }] });
    expect(choices[0]?.hideAfterProgressFlagIds).toEqual([]);
    expect(choices[3]?.requiresProgressFlagIds ?? []).toEqual([]);
  });

  it('merges initial prerequisites into custom follow-ups in deterministic order', () => {
    const choices = smallTalkChoices({ ...options,
      hideInitialChoicesAfterProgressFlagIds: ['custom-hide'],
      requireInitialChoicesAfterProgressFlagIds: ['received-rod', 'shared'],
      additionalQuestions: [{ ...options.additionalQuestions![0]!,
        requiresProgressFlagIds: ['shared', 'custom'], hideAfterProgressFlagIds: ['finished'] }] });
    expect(choices[0]?.requiresProgressFlagIds).toEqual(['received-rod', 'shared']);
    expect(choices[0]?.hideAfterProgressFlagIds).toEqual(['custom-hide']);
    expect(choices[3]?.requiresProgressFlagIds).toEqual(['shared', 'custom', 'received-rod']);
    expect(choices[3]?.hideAfterProgressFlagIds).toEqual(['finished']);
  });

  it('keeps every small-talk choice behind Orin’s rod prerequisite', () => {
    expect(smallTalkChoices({ ...options,
      requireInitialChoicesAfterProgressFlagIds: ['received-old-fishing-rod'],
    }).every((choice) => choice.requiresProgressFlagIds?.includes('received-old-fishing-rod'))).toBe(true);
  });

  it('keeps IDs and flags stable when the settlement display name changes', () => {
    const original = smallTalkChoices(options);
    const renamed = smallTalkChoices({ ...options, town: { ...options.town, name: 'New Name' } });
    expect(renamed.map(({ id, progressFlagId }) => ({ id, progressFlagId })))
      .toEqual(original.map(({ id, progressFlagId }) => ({ id, progressFlagId })));
    expect(renamed[2]?.label).toBe('What is New Name like?');
  });
});
