import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TerminalPanel } from './TerminalPanel.js';

function touch(
  target: Element,
  type: 'touchstart' | 'touchend' | 'touchcancel',
  clientX = 100,
  clientY = 100,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const points = [{ identifier: 1, clientX, clientY }];
  if (type === 'touchstart') Object.defineProperty(event, 'touches', { value: points });
  if (type === 'touchend') Object.defineProperty(event, 'changedTouches', { value: points });
  fireEvent(target, event);
}

describe('TerminalPanel touch navigation', () => {
  it('opens and closes full screen only for a sufficiently vertical swipe', async () => {
    const { container } = render(
      <TerminalPanel title="Bellwold Market Square" busy={false} mobileViewport={false}>
        <p>Room output</p>
      </TerminalPanel>,
    );
    const heading = screen.getByRole('heading', { name: 'Bellwold Market Square' });

    touch(heading, 'touchstart', 100, 100);
    touch(heading, 'touchend', 160, 120);
    expect(screen.queryByRole('dialog', { name: 'Terminal' })).not.toBeInTheDocument();

    touch(heading, 'touchstart', 100, 100);
    touch(heading, 'touchend', 100, 200);
    expect(await screen.findByRole('dialog', { name: 'Terminal' })).toBeVisible();
    expect(screen.getByText('Room output')).toBeVisible();

    const fullscreenHeading = screen.getByRole('heading', { name: 'Bellwold Market Square' });
    touch(fullscreenHeading, 'touchstart', 100, 200);
    touch(fullscreenHeading, 'touchend', 100, 100);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Terminal' })).not.toBeInTheDocument());
    expect(container.querySelector('.focused-terminal')).toBeInTheDocument();
  });

  it('does not treat horizontal swipes or swipes on controls as terminal navigation', () => {
    render(
      <TerminalPanel title="Bellwold Market Square" busy={false} mobileViewport={false}>
        <p>Room output</p>
      </TerminalPanel>,
    );
    const heading = screen.getByRole('heading', { name: 'Bellwold Market Square' });
    const openButton = screen.getByRole('button', { name: 'Open terminal full screen' });

    touch(heading, 'touchstart', 100, 100);
    touch(heading, 'touchend', 180, 100);
    touch(openButton, 'touchstart', 100, 100);
    touch(openButton, 'touchend', 100, 220);

    expect(screen.queryByRole('dialog', { name: 'Terminal' })).not.toBeInTheDocument();
  });
});
