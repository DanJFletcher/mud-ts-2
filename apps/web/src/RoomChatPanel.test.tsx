import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomChatPanel, type RoomChatMessage } from './RoomChatPanel.js';

describe('RoomChatPanel message polling', () => {
  let storedMessages: RoomChatMessage[];
  let intervals: Array<() => void>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let failedPostRequests: number;
  let postedSubmissionIds: string[];

  beforeEach(() => {
    storedMessages = [];
    intervals = [];
    failedPostRequests = 0;
    postedSubmissionIds = [];
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://mudd.test');
      if (init?.method === 'POST') {
        const requestBody = JSON.parse(String(init.body)) as { clientMessageId: string; text: string };
        postedSubmissionIds.push(requestBody.clientMessageId);
        if (failedPostRequests > 0) {
          failedPostRequests -= 1;
          return new Response(JSON.stringify({ message: 'Temporary failure.' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          });
        }
        const ownMessage: RoomChatMessage = {
          id: 12,
          roomId: 'test-room',
          speakerType: 'player',
          speakerName: 'Rowan',
          text: requestBody.text,
          createdAt: '2026-10-18T12:00:02.000Z',
        };
        storedMessages.push(ownMessage);
        return new Response(JSON.stringify({ message: ownMessage }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }

      const afterId = Number(url.searchParams.get('afterId') ?? 0);
      return new Response(JSON.stringify({
        roomId: 'test-room',
        messages: storedMessages.filter((message) => message.id > afterId),
      }), { headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'setInterval').mockImplementation((handler) => {
      intervals.push(handler as () => void);
      return intervals.length as unknown as ReturnType<typeof window.setInterval>;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not skip another speaker message arriving before the send acknowledgement', async () => {
    storedMessages = [{
      id: 10,
      roomId: 'test-room',
      speakerType: 'npc',
      speakerName: 'Mara',
      text: 'The marker points east.',
      createdAt: '2026-10-18T12:00:00.000Z',
    }];
    render(<RoomChatPanel roomId="test-room" fullscreen={false} onFullscreenChange={vi.fn()} />);

    expect(await screen.findByText('The marker points east.')).toBeVisible();
    storedMessages.push({
      id: 11,
      roomId: 'test-room',
      speakerType: 'npc',
      speakerName: 'Mara',
      text: 'The north bridge is open.',
      createdAt: '2026-10-18T12:00:01.000Z',
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Message the room' }), { target: { value: 'Hello' } });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Message the room' }).closest('form')!);
    expect(await screen.findByText('Hello')).toBeVisible();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(intervals[0]).toBeDefined();
    await act(async () => {
      intervals[0]?.();
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const pollRequest = fetchMock.mock.calls.at(-1);
    expect(String(pollRequest?.[0])).toContain('afterId=10');
    expect(await screen.findByText('The north bridge is open.')).toBeVisible();
    expect(screen.getAllByText('Hello')).toHaveLength(1);
  });

  it('reuses the same submission ID when the player retries a failed send', async () => {
    failedPostRequests = 1;
    render(<RoomChatPanel roomId="test-room" fullscreen={false} onFullscreenChange={vi.fn()} />);

    const textbox = await screen.findByRole('textbox', { name: 'Message the room' });
    fireEvent.change(textbox, { target: { value: 'Hello again' } });
    fireEvent.submit(textbox.closest('form')!);
    expect(await screen.findByText('Temporary failure.')).toBeVisible();

    fireEvent.submit(textbox.closest('form')!);
    expect(await screen.findByText('Hello again')).toBeVisible();
    expect(postedSubmissionIds).toHaveLength(2);
    expect(postedSubmissionIds[1]).toBe(postedSubmissionIds[0]);
  });
});
