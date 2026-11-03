import { requestMeasurements } from './performance.js';
import { replayCharacter as reconstructCharacter } from '@mudd/engine-core';

export function replayCharacter(events: Parameters<typeof reconstructCharacter>[0]) {
  const started = performance.now();
  try { return reconstructCharacter(events); }
  finally {
    const metrics = requestMeasurements.getStore();
    if (metrics) metrics.stages.characterReplay =
      (metrics.stages.characterReplay ?? 0) + performance.now() - started;
  }
}
