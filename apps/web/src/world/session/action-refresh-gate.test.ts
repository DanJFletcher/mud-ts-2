import { describe, it, expect } from 'vitest';
import { ActionRefreshGate } from './action-refresh-gate.js';

describe('background refresh ordering', () => {
  it('rejects old results both during and after an action', () => {
    const gate = new ActionRefreshGate();
    const before = gate.capture();
    expect(gate.accepts(before)).toBe(true);
    gate.begin();
    expect(gate.accepts(before)).toBe(false);
    expect(gate.accepts(gate.capture())).toBe(false);
    gate.end();
    expect(gate.accepts(before)).toBe(false);
    expect(gate.accepts(gate.capture())).toBe(true);
  });
  it('rejects a refresh crossing two successive actions', () => {
    const gate = new ActionRefreshGate();
    gate.begin(); gate.end();
    const refresh = gate.capture();
    gate.begin(); gate.end();
    expect(gate.accepts(refresh)).toBe(false);
  });
});
