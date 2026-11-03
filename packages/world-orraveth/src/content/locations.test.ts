import { expect, it } from 'vitest';
import { mergeLocationContent } from './locations.js';

it('rejects conflicting ownership rather than silently overwriting a location', () => {
  expect(() => mergeLocationContent({ room: { safeResting: true } }, { room: {} }))
    .toThrow('Duplicate location content key room');
  expect(mergeLocationContent({ first: {} }, { second: { safeResting: true } }))
    .toEqual({ first: {}, second: { safeResting: true } });
});
