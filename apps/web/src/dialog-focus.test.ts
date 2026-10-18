import { describe, expect, it, vi } from 'vitest';
import { trapDialogTab } from './dialog-focus.js';

describe('modal focus trapping', () => {
  it('wraps tab focus in both directions and ignores other keys', () => {
    document.body.innerHTML = '<section><button id="first">Close</button><input id="last"></section>';
    const dialog = document.querySelector('section')!;
    const first = document.querySelector<HTMLButtonElement>('#first')!;
    const last = document.querySelector<HTMLInputElement>('#last')!;

    last.focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    trapDialogTab(forward, dialog);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    first.focus();
    const backward = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    trapDialogTab(backward, dialog);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);

    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    const preventDefault = vi.spyOn(escape, 'preventDefault');
    trapDialogTab(escape, dialog);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
