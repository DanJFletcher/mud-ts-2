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

  it('ignores an empty chat submission', async () => {
    render(
      <RoomChatPanel worldInstanceId={worldInstanceId} roomId="test-room" fullscreen={false} onFullscreenChange={vi.fn()} />,
    );
    const textbox = await screen.findByRole('textbox', { name: 'Message the room' });
    fireEvent.submit(textbox.closest('form')!);

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('shows an acknowledged pending message while waiting for room history', async () => {
    const coordinator = new PendingActionCoordinator();
    coordinator.begin({
      id: 'acknowledged-chat',
      scope: { worldInstanceId, roomId: 'test-room', characterId: 'fern' },
      details: {
        kind: 'chat.send',
        roomId: 'test-room',
        clientMessageId: 'acknowledged-chat',
        text: 'The river is rising.',
        speakerName: 'Fern',
      },
    });
    coordinator.acknowledge('acknowledged-chat');
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

    expect(await screen.findByText('Sent; waiting for room history…')).toBeVisible();
    expect(screen.getByText('The river is rising.')).toBeVisible();
  });

  it('does not display pending movement actions as room chat messages', async () => {
    const coordinator = new PendingActionCoordinator();
    coordinator.begin({
      id: 'pending-move',
      scope: { worldInstanceId, roomId: 'test-room', characterId: 'fern' },
      details: {
        kind: 'character.move',
        fromLocationId: 'west-bank',
        exitId: 'north-road',
        direction: 'north',
      },
    });
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

    await screen.findByRole('log', { name: 'Room chat messages' });
    expect(document.querySelector('.focused-room-chat__message--pending')).not.toBeInTheDocument();
    expect(screen.getByText('No room messages yet.')).toBeVisible();
  });

  it('does not forward room events from a response that arrives after unmount', async () => {
    let releaseRequest!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { releaseRequest = resolve; }));
    const onTerminalEvent = vi.fn();
    const view = render(
      <RoomChatPanel
        worldInstanceId={worldInstanceId}
        roomId="test-room"
        fullscreen={false}
        onFullscreenChange={vi.fn()}
        onTerminalEvent={onTerminalEvent}
      />,
    );
    await waitFor(() => expect(releaseRequest).toBeDefined());
    view.unmount();
    await act(async () => {
      releaseRequest(Response.json({
        roomId: 'test-room',
        messages: [],
        terminalEvents: [{
          id: 1,
          roomId: 'test-room',
          speakerType: 'npc',
          speakerName: 'The room',
          text: 'The campfire goes out.',
          createdAt: '2026-10-18T12:00:00.000Z',
        }],
      }));
    });

    expect(onTerminalEvent).not.toHaveBeenCalled();
  });

  it('ignores a room-history error that arrives after the chat unmounts', async () => {
    let rejectRequest!: (failure: Error) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { rejectRequest = reject; }));
    const view = render(
      <RoomChatPanel worldInstanceId={worldInstanceId} roomId="test-room" fullscreen={false} onFullscreenChange={vi.fn()} />,
    );
    await waitFor(() => expect(rejectRequest).toBeDefined());
    view.unmount();
    await act(async () => { rejectRequest(new Error('Late chat failure.')); });

    expect(screen.queryByText('Late chat failure.')).not.toBeInTheDocument();
  });

  it.each([
    {
      label: 'a server error without a message',
      response: () => new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }),
      expected: 'Room chat is unavailable. Retrying…',
    },
    {
      label: 'a response for another room',
      response: () => Response.json({ roomId: 'different-room', messages: [] }),
      expected: 'Room chat is unavailable. Retrying…',
    },
  ])('reports a useful load error for $label', async ({ response, expected }) => {
    fetchMock.mockImplementationOnce(async () => response());
    render(<RoomChatPanel worldInstanceId={worldInstanceId} roomId="test-room" fullscreen={false} onFullscreenChange={vi.fn()} />);

    expect(await screen.findByText(expected)).toBeVisible();
  });

  it('bounds the seen-message history while retaining the latest chat entries', async () => {
    storedMessages = Array.from({ length: 205 }, (_, index) => ({
      id: index + 1,
      roomId: 'test-room',
      speakerType: 'npc' as const,
      speakerName: 'Mara',
      text: `Notice ${index + 1}`,
      createdAt: `2026-10-18T12:00:${String(index % 60).padStart(2, '0')}.000Z`,
    }));
    render(<RoomChatPanel worldInstanceId={worldInstanceId} roomId="test-room" fullscreen={false} onFullscreenChange={vi.fn()} />);

    expect(await screen.findByText('Notice 205')).toBeVisible();
    expect(screen.queryByText('Notice 1')).not.toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'Room chat messages' }).querySelectorAll('.focused-room-chat__message'))
      .toHaveLength(100);
  });

  it('shows a count badge for new messages while chat is collapsed and opens to the latest', async () => {
    render(
      <RoomChatPanel worldInstanceId={worldInstanceId} roomId="test-room" fullscreen={false} onFullscreenChange={vi.fn()} />,
    );
    await screen.findByText('No room messages yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse room chat' }));
    storedMessages.push(
      {
        id: 1,
        roomId: 'test-room',
        speakerType: 'player',
        speakerName: 'Alder',
        text: 'The eastern road is clear.',
        createdAt: '2026-10-18T12:00:00.000Z',
      },
      {
        id: 2,
        roomId: 'test-room',
        speakerType: 'npc',
        speakerName: 'Mara',
        text: 'The market is closing soon.',
        createdAt: '2026-10-18T12:00:01.000Z',
      },
    );

    await act(async () => { intervals[0]?.(); });
    const unreadBadge = await screen.findByRole('button', {
      name: '2 unread chat messages. Jump to latest.',
    });
    expect(unreadBadge.querySelector('.focused-room-chat__unread-badge')).toHaveTextContent('2');

    fireEvent.click(unreadBadge);
    expect(screen.queryByRole('button', { name: /unread chat messages/ })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Room chat' })).not.toHaveClass('focused-room-chat--collapsed');
    expect(screen.getByText('The market is closing soon.')).toBeVisible();
  });

  it('shows unread messages while scrolled up and clears the badge at the latest message', async () => {
    storedMessages = [{
      id: 1,
      roomId: 'test-room',
      speakerType: 'npc',
      speakerName: 'Mara',
      text: 'The first notice.',
      createdAt: '2026-10-18T12:00:00.000Z',
    }];
    render(
      <RoomChatPanel worldInstanceId={worldInstanceId} roomId="test-room" fullscreen={false} onFullscreenChange={vi.fn()} />,
    );
    expect(await screen.findByText('The first notice.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /unread chat messages/ })).not.toBeInTheDocument();

    const messages = screen.getByRole('log', { name: 'Room chat messages' });
    Object.defineProperty(messages, 'scrollHeight', { configurable: true, value: 240 });
    Object.defineProperty(messages, 'clientHeight', { configurable: true, value: 120 });
    messages.scrollTop = 0;
    fireEvent.scroll(messages);
    storedMessages.push({
      id: 2,
      roomId: 'test-room',
      speakerType: 'player',
      speakerName: 'Alder',
      text: 'I found a trail marker.',
      createdAt: '2026-10-18T12:00:01.000Z',
    });

    await act(async () => { intervals[0]?.(); });
    expect(await screen.findByRole('button', { name: '1 unread chat message. Jump to latest.' })).toBeVisible();

    messages.scrollTop = 120;
    fireEvent.scroll(messages);
    expect(screen.queryByRole('button', { name: /unread chat message/ })).not.toBeInTheDocument();
  });

  it('scrolls an open chat to the latest message from its unread badge', async () => {
    storedMessages = [{
      id: 1,
      roomId: 'test-room',
      speakerType: 'npc',
      speakerName: 'Mara',
      text: 'The first notice.',
      createdAt: '2026-10-18T12:00:00.000Z',
    }];
    render(<RoomChatPanel worldInstanceId={worldInstanceId} roomId="test-room" fullscreen={false} onFullscreenChange={vi.fn()} />);
    expect(await screen.findByText('The first notice.')).toBeVisible();
    const messages = screen.getByRole('log', { name: 'Room chat messages' });
    Object.defineProperty(messages, 'scrollHeight', { configurable: true, value: 240 });
    Object.defineProperty(messages, 'clientHeight', { configurable: true, value: 120 });
    messages.scrollTop = 0;
    fireEvent.scroll(messages);
    storedMessages.push({
      id: 2,
      roomId: 'test-room',
      speakerType: 'player',
      speakerName: 'Alder',
      text: 'I found a trail marker.',
      createdAt: '2026-10-18T12:00:01.000Z',
    });

    await act(async () => { intervals[0]?.(); });
    fireEvent.click(await screen.findByRole('button', {
      name: '1 unread chat message. Jump to latest.',
    }));

    expect(messages.scrollTop).toBe(240);
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

  it('forwards room movement and lifecycle announcements to the terminal', async () => {
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
    const lifecycleNotice: RoomChatMessage = {
      id: 15,
      roomId: 'test-room',
      speakerType: 'npc',
      speakerName: 'The room',
      text: 'The remains of a bandit crumble into dust.',
      createdAt: '2026-10-21T12:00:02.000Z',
    };
    pendingTerminalEvents = [departure, arrival, lifecycleNotice];

    await act(async () => {
      intervals[0]?.();
    });

    await waitFor(() => expect(onTerminalEvent).toHaveBeenCalledTimes(3));
    expect(onTerminalEvent).toHaveBeenNthCalledWith(1, departure);
    expect(onTerminalEvent).toHaveBeenNthCalledWith(2, arrival);
    expect(onTerminalEvent).toHaveBeenNthCalledWith(3, lifecycleNotice);
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get('x-mudd-world-instance')).toBe(worldInstanceId);
    }
    expect(screen.queryByText(departure.text)).not.toBeInTheDocument();
    expect(screen.queryByText(arrival.text)).not.toBeInTheDocument();
    expect(screen.queryByText(departure.speakerName)).not.toBeInTheDocument();
    expect(screen.queryByText(arrival.speakerName)).not.toBeInTheDocument();
    expect(screen.queryByText(lifecycleNotice.text)).not.toBeInTheDocument();
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

  it('records first-feedback timing for a traced chat send', async () => {
    window.history.replaceState(null, '', '/?muddTrace=1');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(performance.now());
      return 1;
    });
    try {
      render(<RoomChatPanel worldInstanceId={worldInstanceId} roomId="test-room" fullscreen={false} onFullscreenChange={vi.fn()} />);
      const textbox = await screen.findByRole('textbox', { name: 'Message the room' });
      fireEvent.change(textbox, { target: { value: 'Measured chat.' } });
      fireEvent.submit(textbox.closest('form')!);

      expect(info).toHaveBeenCalledWith(
        '[mudd_perf_trace_feedback]',
        expect.stringContaining('"action":"chat.send"'),
      );
    } finally {
      animationFrame.mockRestore();
      info.mockRestore();
      window.history.replaceState(null, '', '/');
    }
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

  it('reuses a pending submission ID across resubmission after uncertain delivery', async () => {
    failedPostRequests = 2;
    const coordinator = new PendingActionCoordinator();
    render(<RoomChatPanel
      pendingActionCoordinator={coordinator}
      worldInstanceId={worldInstanceId}
      characterId="fern"
      roomId="test-room"
      fullscreen={false}
      onFullscreenChange={vi.fn()}
    />);
    const textbox = await screen.findByRole('textbox', { name: 'Message the room' });
    fireEvent.change(textbox, { target: { value: 'The ford is passable.' } });
    fireEvent.submit(textbox.closest('form')!);
    expect(await screen.findByText('Temporary failure.')).toBeVisible();
    const firstSubmissionId = postedSubmissionIds[0];

    fireEvent.submit(textbox.closest('form')!);
    await waitFor(() => expect(postedSubmissionIds).toHaveLength(2));
    expect(postedSubmissionIds[1]).toBe(firstSubmissionId);
    expect(coordinator.getSnapshot()[0]?.state).toBe('uncertain');
    coordinator.clearWhere(() => true);

    fireEvent.submit(textbox.closest('form')!);
    await waitFor(() => expect(postedSubmissionIds).toHaveLength(3));
    expect(postedSubmissionIds[2]).toBe(firstSubmissionId);
    expect(await screen.findByText('The ford is passable.')).toBeVisible();
  });

  it('rejects a send explicitly when the server returns a client error', async () => {
    const coordinator = new PendingActionCoordinator();
    const originalFetch = fetchMock.getMockImplementation() as typeof fetch;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ message: 'That message is too long.' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    });
    render(<RoomChatPanel
      pendingActionCoordinator={coordinator}
      worldInstanceId={worldInstanceId}
      characterId="fern"
      roomId="test-room"
      fullscreen={false}
      onFullscreenChange={vi.fn()}
    />);
    const textbox = await screen.findByRole('textbox', { name: 'Message the room' });
    fireEvent.change(textbox, { target: { value: 'A very long message.' } });
    fireEvent.submit(textbox.closest('form')!);

    expect(await screen.findByText('That message is too long.')).toBeVisible();
    expect(coordinator.getSnapshot()[0]?.state).toBe('rejected');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    coordinator.clearWhere(() => true);
  });

  it('keeps delivery uncertain after a network error', async () => {
    const originalFetch = fetchMock.getMockImplementation() as typeof fetch;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') throw new Error('Network unavailable.');
      return originalFetch(input, init);
    });
    render(<RoomChatPanel worldInstanceId={worldInstanceId} roomId="test-room" fullscreen={false} onFullscreenChange={vi.fn()} />);
    const textbox = await screen.findByRole('textbox', { name: 'Message the room' });
    fireEvent.change(textbox, { target: { value: 'Can anyone hear me?' } });
    fireEvent.submit(textbox.closest('form')!);

    expect(await screen.findByText(
      'Delivery is unconfirmed. Retry to check safely; the same message ID will be reused.',
    )).toBeVisible();
  });

  it('keeps delivery uncertain when a send acknowledgement belongs to another room', async () => {
    const coordinator = new PendingActionCoordinator();
    const originalFetch = fetchMock.getMockImplementation() as typeof fetch;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Response.json({
          message: {
            id: 30,
            roomId: 'different-room',
            speakerType: 'player',
            speakerName: 'Fern',
            text: 'Is anyone there?',
            createdAt: '2026-10-18T12:00:03.000Z',
          },
        }, { status: 201 });
      }
      return originalFetch(input, init);
    });
    render(<RoomChatPanel
      pendingActionCoordinator={coordinator}
      worldInstanceId={worldInstanceId}
      characterId="fern"
      roomId="test-room"
      fullscreen={false}
      onFullscreenChange={vi.fn()}
    />);
    const textbox = await screen.findByRole('textbox', { name: 'Message the room' });
    fireEvent.change(textbox, { target: { value: 'Is anyone there?' } });
    fireEvent.submit(textbox.closest('form')!);

    expect(await screen.findByText(
      'Delivery is unconfirmed. Retry to check safely; the same message ID will be reused.',
    )).toBeVisible();
    expect(coordinator.getSnapshot()[0]?.state).toBe('uncertain');
    coordinator.clearWhere(() => true);
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
    fireEvent.submit(textbox.closest('form')!);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);

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

  it('confirms a late post without rendering it after changing rooms', async () => {
    const coordinator = new PendingActionCoordinator();
    let resolvePost!: (response: Response) => void;
    const originalFetch = fetchMock.getMockImplementation() as typeof fetch;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Promise<Response>((resolve) => { resolvePost = resolve; });
      }
      return Promise.resolve(originalFetch(input, init));
    });
    const props = {
      pendingActionCoordinator: coordinator,
      worldInstanceId,
      characterId: 'fern',
      fullscreen: false,
      onFullscreenChange: vi.fn(),
    };
    const view = render(<RoomChatPanel {...props} roomId="test-room" />);
    const textbox = await screen.findByRole('textbox', { name: 'Message the room' });
    fireEvent.change(textbox, { target: { value: 'The old bridge is clear.' } });
    fireEvent.submit(textbox.closest('form')!);
    expect(await screen.findByText('The old bridge is clear.')).toBeVisible();
    expect(screen.getByText('Sending…')).toBeVisible();

    view.rerender(<RoomChatPanel {...props} roomId="other-room" />);
    await act(async () => {
      resolvePost(new Response(JSON.stringify({
        message: {
          id: 22,
          roomId: 'test-room',
          speakerType: 'player',
          speakerName: 'Fern',
          text: 'The old bridge is clear.',
          createdAt: '2026-10-18T12:00:03.000Z',
        },
      }), { status: 201, headers: { 'content-type': 'application/json' } }));
    });

    await waitFor(() => expect(coordinator.getSnapshot()[0]?.state).toBe('confirmed'));
    expect(screen.queryByText('The old bridge is clear.')).not.toBeInTheDocument();
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
