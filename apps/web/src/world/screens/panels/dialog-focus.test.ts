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

  it('focuses the dialog when it has no eligible controls', () => {
    document.body.innerHTML = '<section tabindex="-1"><button hidden>Hidden</button><button disabled>Disabled</button></section>';
    const dialog = document.querySelector<HTMLElement>('section')!;
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });

    trapDialogTab(tab, dialog);

    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialog);
  });

  it('skips inaccessible controls and traps focus that starts outside the dialog', () => {
    document.body.innerHTML = `
      <button id="outside">Outside</button>
      <section>
        <button hidden>Hidden</button>
        <button aria-hidden="true">Screen-reader hidden</button>
        <button aria-disabled="true">Unavailable</button>
        <button id="available">Available</button>
      </section>
    `;
    const dialog = document.querySelector<HTMLElement>('section')!;
    const outside = document.querySelector<HTMLButtonElement>('#outside')!;
    const available = document.querySelector<HTMLButtonElement>('#available')!;
    outside.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });

    trapDialogTab(tab, dialog);

    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(available);
  });
});
