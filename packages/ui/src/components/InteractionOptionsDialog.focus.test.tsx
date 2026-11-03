import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { InteractionOptionsDialog } from './InteractionOptionsDialog.js';

afterEach(cleanup);

it('returns keyboard focus to the opener after the dialog closes', async () => {
  render(<button type="button">Open actions</button>);
  const opener = screen.getByRole('button', { name: 'Open actions' });
  opener.focus();
  const dialog = render(
    <InteractionOptionsDialog
      targetLabel="Bulletin board"
      options={[{ id: 'look', label: 'Look' }]}
      onSelect={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  const close = screen.getByRole('button', { name: 'Close' });
  close.focus();
  expect(close).toHaveFocus();

  dialog.unmount();

  await waitFor(() => expect(opener).toHaveFocus());
});
