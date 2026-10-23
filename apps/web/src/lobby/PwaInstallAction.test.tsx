import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PwaInstallAction } from './PwaInstallAction.js';

describe('PwaInstallAction', () => {
  it('uses the browser install prompt when available and hides after installation', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = new Event('beforeinstallprompt') as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: 'accepted'; platform: string }>;
    };
    event.prompt = prompt;
    event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });

    render(<PwaInstallAction />);
    act(() => window.dispatchEvent(event));
    fireEvent.click(screen.getByRole('button', { name: 'Install MUDD' }));

    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Install MUDD' })).not.toBeInTheDocument());
  });

  it('shows platform guidance when the browser has no install prompt', () => {
    render(<PwaInstallAction />);
    fireEvent.click(screen.getByRole('button', { name: 'Install MUDD' }));
    expect(screen.getByRole('status')).toHaveTextContent('Choose Install app or Add to Home Screen');
  });
});
