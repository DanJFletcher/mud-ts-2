import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PendingActionCoordinator } from '@mudd/client-sdk';
import { RoomChatPanel, type RoomChatMessage } from './RoomChatPanel.js';

const worldInstanceId = 'orraveth-test-instance';

describe('RoomChatPanel message polling', () => {
  let storedMessages: RoomChatMessage[];
  let intervals: Array<() => void>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let failedPostRequests: number;
  let postedSubmissionIds: string[];
  let pendingTerminalEvents: RoomChatMessage[];

  beforeEach(() => {
    storedMessages = [];
    intervals = [];
    failedPostRequests = 0;
    postedSubmissionIds = [];
    pendingTerminalEvents = [];
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://mudd.test');
      if (new Headers(init?.headers).get('x-mudd-world-instance') !== worldInstanceId) {
        return Response.json({ message: 'Wrong world selected.' }, { status: 409 });
      }
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
        terminalEvents: pendingTerminalEvents.filter((message) => message.id > afterId),
        cursor: Math.max(
          afterId,
          ...storedMessages.map((message) => message.id),
          ...pendingTerminalEvents.map((message) => message.id),
          0,
        ),
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

  it('groups the room chat controls at the right edge of the header', async () => {
    const { container } = render(
      <RoomChatPanel worldInstanceId={worldInstanceId} roomId="test-room" fullscreen={false} onFullscreenChange={vi.fn()} />,
    );
    const header = container.querySelector('.focused-room-chat__header')!;
    const controls = header.querySelector('.focused-room-chat__controls')!;

    await screen.findByText('Room');
    expect(header.lastElementChild).toBe(controls);
    expect(controls).toContainElement(screen.getByRole('button', { name: 'Collapse room chat' }));
    expect(controls).toContainElement(screen.getByRole('button', { name: 'Open chat full screen' }));
    expect(screen.getByText('Room')).toBeInTheDocument();
  });

  it('pauses hidden-tab chat polling and refreshes immediately on becoming visible', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('visible');
    render(<RoomChatPanel worldInstanceId={worldInstanceId} roomId="test-room"
      fullscreen={false} onFullscreenChange={vi.fn()} />);
    await screen.findByText('No room messages yet.');
    const before = fetchMock.mock.calls.length;
    visibility.mockReturnValue('hidden');
    await act(async () => { for (const poll of intervals) poll(); });
    expect(fetchMock).toHaveBeenCalledTimes(before);
    visibility.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
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
    render(<RoomChatPanel worldInstanceId={worldInstanceId} roomId="test-room" fullscreen={false} onFullscreenChange={vi.fn()} />);

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
    await waitFor(() => expect(screen.getByText('Hello')).toBeVisible());
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

  it('polls the selected non-demo world and forwards NPC departures and arrivals to the terminal', async () => {
    const onTerminalEvent = vi.fn();
    render(
      <RoomChatPanel
        worldInstanceId={worldInstanceId}
        roomId="test-room"
        fullscreen={false}
        onFullscreenChange={vi.fn()}
        onTerminalEvent={onTerminalEvent}
      />,
    );
    expect(await screen.findByText('No room messages yet.')).toBeVisible();
    const departure: RoomChatMessage = {
      id: 13,
      roomId: 'test-room',
      speakerType: 'npc',
      speakerName: 'Taren Voss',
      text: 'The guard leaves toward the south, continuing the patrol.',
      createdAt: '2026-10-21T12:00:00.000Z',
    };
    const arrival: RoomChatMessage = {
      id: 14,
      roomId: 'test-room',
      speakerType: 'npc',
      speakerName: 'Linnet Reed',
      text: 'A villager enters from the north, nodding to a familiar face.',
      createdAt: '2026-10-21T12:00:01.000Z',
    };
    pendingTerminalEvents = [departure, arrival];

    await act(async () => {
      intervals[0]?.();
    });

    await waitFor(() => expect(onTerminalEvent).toHaveBeenCalledTimes(2));
    expect(onTerminalEvent).toHaveBeenNthCalledWith(1, departure);
    expect(onTerminalEvent).toHaveBeenNthCalledWith(2, arrival);
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get('x-mudd-world-instance')).toBe(worldInstanceId);
    }
    expect(screen.queryByText(departure.text)).not.toBeInTheDocument();
    expect(screen.queryByText(arrival.text)).not.toBeInTheDocument();
    expect(screen.queryByText(departure.speakerName)).not.toBeInTheDocument();
    expect(screen.queryByText(arrival.speakerName)).not.toBeInTheDocument();
  });

  it('sends player chat to the selected non-demo world', async () => {
    render(
      <RoomChatPanel
        worldInstanceId={worldInstanceId}
        roomId="test-room"
        fullscreen={false}
        onFullscreenChange={vi.fn()}
      />,
    );
    await screen.findByText('No room messages yet.');
    const textbox = screen.getByRole('textbox', { name: 'Message the room' });
    fireEvent.change(textbox, { target: { value: 'Hello Bellwold' } });
    fireEvent.submit(textbox.closest('form')!);

    await waitFor(() => expect(screen.getByText('Hello Bellwold')).toBeVisible());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post).toBeDefined();
    expect(new Headers(post?.[1]?.headers).get('x-mudd-world-instance')).toBe(worldInstanceId);
  });

  it('reuses the same submission ID when the player retries a failed send', async () => {
    failedPostRequests = 1;
    render(<RoomChatPanel worldInstanceId={worldInstanceId} roomId="test-room" fullscreen={false} onFullscreenChange={vi.fn()} />);

    const textbox = await screen.findByRole('textbox', { name: 'Message the room' });
    fireEvent.change(textbox, { target: { value: 'Hello again' } });
    fireEvent.submit(textbox.closest('form')!);
    expect(await screen.findByText('Temporary failure.')).toBeVisible();

    fireEvent.change(textbox, { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('Hello again')).toBeVisible());
    expect(postedSubmissionIds).toHaveLength(2);
    expect(postedSubmissionIds[1]).toBe(postedSubmissionIds[0]);
    expect(textbox).toHaveValue('Keep this draft');
  });

  it('shows a pending message before the post acknowledgement and reconciles it without a duplicate', async () => {
    const coordinator = new PendingActionCoordinator();
    let resolvePost!: (response: Response) => void;
    const originalFetch = fetchMock.getMockImplementation() as typeof fetch;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Promise<Response>((resolve) => { resolvePost = resolve; });
      }
      return Promise.resolve(originalFetch(input, init));
    });
    render(
      <RoomChatPanel
        pendingActionCoordinator={coordinator}
        worldInstanceId={worldInstanceId}
        characterId="fern"
        characterName="Fern"
        roomId="test-room"
        fullscreen={false}
        onFullscreenChange={vi.fn()}
      />,
    );
    const textbox = await screen.findByRole('textbox', { name: 'Message the room' });
    fireEvent.change(textbox, { target: { value: 'The bridge is clear.' } });
    fireEvent.submit(textbox.closest('form')!);

    expect(await screen.findByText('The bridge is clear.')).toBeVisible();
    expect(screen.getByText('Sending…')).toBeVisible();
    expect(coordinator.getSnapshot()[0]?.state).toBe('sending');

    await act(async () => {
      resolvePost(new Response(JSON.stringify({
        message: {
          id: 20,
          roomId: 'test-room',
          speakerType: 'player',
          speakerName: 'Fern',
          text: 'The bridge is clear.',
          createdAt: '2026-10-18T12:00:03.000Z',
        },
      }), { status: 201, headers: { 'content-type': 'application/json' } }));
    });
    await waitFor(() => expect(coordinator.getSnapshot()[0]?.state).toBe('confirmed'));
    expect(screen.getAllByText('The bridge is clear.')).toHaveLength(1);
    coordinator.clearWhere(() => true);
  });

  it('reconciles an uncertain post from its author-only history submission ID', async () => {
    failedPostRequests = 1;
    const coordinator = new PendingActionCoordinator();
    render(
      <RoomChatPanel
        pendingActionCoordinator={coordinator}
        worldInstanceId={worldInstanceId}
        characterId="fern"
        roomId="test-room"
        fullscreen={false}
        onFullscreenChange={vi.fn()}
      />,
    );
    const textbox = await screen.findByRole('textbox', { name: 'Message the room' });
    fireEvent.change(textbox, { target: { value: 'Checking the river.' } });
    fireEvent.submit(textbox.closest('form')!);
    expect(await screen.findByText('Temporary failure.')).toBeVisible();

    const submissionId = postedSubmissionIds[0]!;
    expect(coordinator.getSnapshot()[0]?.state).toBe('uncertain');
    storedMessages.push({
      id: 21,
      roomId: 'test-room',
      speakerType: 'player',
      speakerName: 'Fern',
      text: 'Checking the river.',
      createdAt: '2026-10-18T12:00:04.000Z',
      submissionId,
    });
    await act(async () => { intervals[0]?.(); });

    await waitFor(() => expect(coordinator.getSnapshot()[0]?.state).toBe('confirmed'));
    expect(screen.getAllByText('Checking the river.')).toHaveLength(1);
    expect(screen.queryByText('Delivery is unconfirmed. Retry to check safely.')).not.toBeInTheDocument();
    coordinator.clearWhere(() => true);
  });
});
