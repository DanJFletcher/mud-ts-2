import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, Maximize2, X } from 'lucide-react';
import { Button, DisclosureButton, PendingActionStatus } from '@mudd/ui';
import { trapDialogTab } from './dialog-focus.js';
import { MuddHttpClient, PendingActionCoordinator, type PendingActionState } from '@mudd/client-sdk';

const emptyActionCoordinator = new PendingActionCoordinator();

export type RoomChatMessage = Readonly<{
  id: number;
  roomId: string;
  speakerType: 'player' | 'npc';
  speakerName: string;
  text: string;
  createdAt: string;
  submissionId?: string | null;
}>;

type RoomChatPanelProps = Readonly<{
  realtimeClient?: MuddHttpClient;
  pendingActionCoordinator?: PendingActionCoordinator;
  worldInstanceId: string;
  characterId?: string;
  characterName?: string;
  roomId: string;
  fullscreen: boolean;
  onFullscreenChange: (fullscreen: boolean) => void;
  embedded?: boolean;
  actionPending?: boolean;
  onTerminalEvent?: (message: RoomChatMessage) => void;
}>;
type RoomChatResponse = Readonly<{
  roomId: string;
  messages: readonly RoomChatMessage[];
  terminalEvents?: readonly RoomChatMessage[];
  cursor?: number;
}>;
type MessageResponse = Readonly<{ message: RoomChatMessage; npcMessage?: RoomChatMessage }>;

function errorMessage(body: unknown, fallback: string) {
  if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
    return body.message;
  }
  return fallback;
}

function chatPendingStatus(state: PendingActionState) {
  if (state === 'uncertain') return 'uncertain' as const;
  if (state === 'acknowledged') return 'acknowledged' as const;
  return 'sending' as const;
}

function traceChatFeedbackPaint(traceId: string | undefined, startedAt: number): void {
  if (!traceId) return;
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    console.info('[mudd_perf_trace_feedback]', JSON.stringify({
      traceId,
      action: 'chat.send',
      actionToFirstFeedbackPaintMs: Math.round((performance.now() - startedAt) * 10) / 10,
    }));
  }));
}

function mergeMessages(current: readonly RoomChatMessage[], incoming: readonly RoomChatMessage[]) {
  const messages = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => messages.set(message.id, message));
  return [...messages.values()].sort((left, right) => left.id - right.id).slice(-100);
}

export function RoomChatPanel({
  realtimeClient,
  pendingActionCoordinator,
  worldInstanceId,
  characterId,
  characterName = 'You',
  roomId,
  fullscreen,
  onFullscreenChange,
  embedded = false,
  actionPending = false,
  onTerminalEvent,
}: RoomChatPanelProps) {
  const actionCoordinator = pendingActionCoordinator ?? realtimeClient?.pendingActions ?? emptyActionCoordinator;
  const pendingActionSnapshot = useSyncExternalStore(
    actionCoordinator.subscribe,
    actionCoordinator.getSnapshot,
    actionCoordinator.getSnapshot,
  );
  const [messages, setMessages] = useState<readonly RoomChatMessage[]>([]);
  const actionPendingRef = useRef(actionPending);
  actionPendingRef.current = actionPending;
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [sendError, setSendError] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreenPresent, setFullscreenPresent] = useState(fullscreen);
  const [fullscreenClosing, setFullscreenClosing] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const followsLatestRef = useRef(true);
  const scope = JSON.stringify([worldInstanceId, characterId, roomId]);
  const currentScopeRef = useRef(scope);
  const lastMessageIdRef = useRef(0);
  const pendingSubmissionRef = useRef<{ text: string; id: string } | null>(null);
  const initialLoadCompleteRef = useRef(false);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasFullscreenRef = useRef(false);
  const pendingChatActions = pendingActionSnapshot.filter((action) =>
    action.details.kind === 'chat.send' &&
    action.scope.worldInstanceId === worldInstanceId &&
    action.scope.roomId === roomId &&
    (characterId === undefined || action.scope.characterId === characterId) &&
    ['sending', 'acknowledged', 'uncertain'].includes(action.state)
  );

  currentScopeRef.current = scope;

  useEffect(() => {
    if (fullscreen) {
      setFullscreenPresent(true);
      setFullscreenClosing(false);
      return;
    }
    if (!fullscreenPresent) return;

    setFullscreenClosing(true);
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const closeDelay = prefersReducedMotion ? 0 : 250;
    const timeout = window.setTimeout(() => {
      setFullscreenPresent(false);
      setFullscreenClosing(false);
    }, closeDelay);
    return () => window.clearTimeout(timeout);
  }, [fullscreen, fullscreenPresent]);

  useEffect(() => {
    if (!fullscreenPresent) {
      if (wasFullscreenRef.current) expandButtonRef.current?.focus();
      wasFullscreenRef.current = false;
      return;
    }

    wasFullscreenRef.current = true;
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onFullscreenChange(false);
      trapDialogTab(event, document.querySelector<HTMLElement>('[aria-modal="true"]'));
    };
    document.addEventListener('keydown', closeOnEscape);
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [fullscreenPresent, onFullscreenChange]);

  useEffect(() => {
    let active = true;
    let requesting = false;
    followsLatestRef.current = true;
    lastMessageIdRef.current = 0;
    initialLoadCompleteRef.current = false;
    pendingSubmissionRef.current = null;
    setMessages([]);
    setDraft('');
    setLoading(true);
    setSending(false);
    setLoadError('');
    setSendError('');

    const refreshMessages = async () => {
      if (requesting || !active || actionPendingRef.current || document.visibilityState === 'hidden') return;
      requesting = true;
      try {
        const query = new URLSearchParams({ roomId });
        if (initialLoadCompleteRef.current) {
          query.set('afterId', String(lastMessageIdRef.current));
        }
        const response = await fetch(`/api/chat?${query.toString()}`, {
          credentials: 'include',
          headers: { 'x-mudd-world-instance': worldInstanceId },
        });
        const body = await response.json() as RoomChatResponse & { message?: string };
        if (!response.ok) throw new Error(errorMessage(body, 'Could not load room chat.'));
        if (body.roomId !== roomId || !Array.isArray(body.messages)) {
          throw new Error('The room chat response was invalid.');
        }
        if (!active) return;

        initialLoadCompleteRef.current = true;
        if (typeof body.cursor === 'number' && Number.isSafeInteger(body.cursor)) {
          lastMessageIdRef.current = Math.max(lastMessageIdRef.current, body.cursor);
        }
        if (body.messages.length) {
          lastMessageIdRef.current = Math.max(
            lastMessageIdRef.current,
            ...body.messages.map((message) => message.id),
          );
          setMessages((current) => mergeMessages(current, body.messages));
        }
        const confirmedSubmissionIds = new Set(
          body.messages.flatMap((message) => message.submissionId ? [message.submissionId] : []),
        );
        if (confirmedSubmissionIds.size) {
          let reconciledPendingMessage = false;
          actionCoordinator.getSnapshot().forEach((action) => {
            if (
              action.details.kind === 'chat.send' &&
              action.scope.worldInstanceId === worldInstanceId &&
              action.scope.roomId === roomId &&
              action.details.clientMessageId &&
              confirmedSubmissionIds.has(action.details.clientMessageId)
            ) {
              actionCoordinator.confirm(action.id);
              reconciledPendingMessage = true;
            }
          });
          if (reconciledPendingMessage) setSendError('');
        }
        body.terminalEvents?.forEach((message) => onTerminalEvent?.(message));
        setLoading(false);
        setLoadError('');
      } catch (error) {
        if (!active) return;
        setLoading(false);
        setLoadError(error instanceof Error ? error.message : 'Could not load room chat.');
      } finally {
        requesting = false;
      }
    };

    void refreshMessages();
    const stopRealtime = realtimeClient?.watchRealtime('chat', refreshMessages, 3000, () => !actionPendingRef.current);
    const interval = stopRealtime ? undefined : window.setInterval(() => void refreshMessages(), 3000);
    const visible = () => { if (document.visibilityState === 'visible') void refreshMessages(); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      window.clearInterval(interval);
      stopRealtime?.();
      document.removeEventListener('visibilitychange', visible);
    };
  }, [actionCoordinator, characterId, onTerminalEvent, roomId, worldInstanceId, realtimeClient]);

  useEffect(() => {
    const messagesElement = messagesRef.current;
    if (messagesElement && followsLatestRef.current) {
      messagesElement.scrollTop = messagesElement.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async (
    event?: FormEvent<HTMLFormElement>,
    retry?: { id: string; text: string },
  ) => {
    event?.preventDefault();
    const text = retry?.text ?? draft.trim();
    if (!text || sending) return;

    let submission = retry;
    if (!submission) {
      const retryableAction = actionCoordinator.getSnapshot().filter((action) =>
        action.scope.worldInstanceId === worldInstanceId &&
        action.scope.roomId === roomId &&
        action.scope.characterId === characterId &&
        action.details.kind === 'chat.send' &&
        action.details.text === text &&
        (action.state === 'uncertain' || action.state === 'acknowledged')
      ).at(-1);
      if (retryableAction?.details.kind === 'chat.send') {
        submission = { id: retryableAction.id, text };
      } else if (!pendingSubmissionRef.current || pendingSubmissionRef.current.text !== text) {
        submission = { text, id: globalThis.crypto.randomUUID() };
      } else {
        submission = pendingSubmissionRef.current;
      }
    }
    pendingSubmissionRef.current = submission;
    const existingSubmissionAction = actionCoordinator.getSnapshot().find((action) =>
      action.id === submission.id && action.details.kind === 'chat.send'
    );
    const actionStartedAt = performance.now();
    const traceId = new URLSearchParams(window.location.search).get('muddTrace') === '1'
      ? submission.id
      : undefined;
    actionCoordinator.begin({
      id: submission.id,
      scope: {
        worldInstanceId,
        roomId,
        ...(characterId ? { characterId } : {}),
      },
      details: existingSubmissionAction?.details.kind === 'chat.send'
        ? existingSubmissionAction.details
        : {
          kind: 'chat.send',
          roomId,
          clientMessageId: submission.id,
          text,
          speakerName: characterName,
        },
    });
    setSending(true);
    setSendError('');
    traceChatFeedbackPaint(traceId, actionStartedAt);
    let explicitlyRejected = false;
    let ambiguousServerResponse = false;
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'x-mudd-world-instance': worldInstanceId,
        },
        body: JSON.stringify({
          roomId,
          text,
          clientMessageId: submission.id,
        }),
      });
      const body = await response.json() as unknown;
      if (!response.ok) {
        const message = errorMessage(body, 'Could not send room message.');
        if (response.status >= 500) {
          ambiguousServerResponse = true;
          actionCoordinator.markUncertain(submission.id, 'The server did not confirm whether it stored the message.');
        } else {
          explicitlyRejected = true;
          actionCoordinator.reject(submission.id, message);
          if (pendingSubmissionRef.current?.id === submission.id) pendingSubmissionRef.current = null;
        }
        throw new Error(message);
      }
      const payload = body as MessageResponse;
      if (
        !payload.message ||
        payload.message.roomId !== roomId ||
        (payload.npcMessage && (payload.npcMessage.roomId !== roomId || payload.npcMessage.speakerType !== 'npc'))
      ) {
        actionCoordinator.markUncertain(submission.id);
        throw new Error('The room chat response was invalid.');
      }
      if (currentScopeRef.current !== scope) {
        actionCoordinator.confirm(submission.id);
        return;
      }

      actionCoordinator.acknowledge(submission.id);
      const incomingMessages = [
        { ...payload.message, submissionId: submission.id },
        ...(payload.npcMessage ? [payload.npcMessage] : []),
      ];
      setMessages((current) => mergeMessages(current, incomingMessages));
      actionCoordinator.confirm(submission.id);
      setDraft((current) => current.trim() === text ? '' : current);
      if (pendingSubmissionRef.current?.id === submission.id) pendingSubmissionRef.current = null;
    } catch (error) {
      if (!explicitlyRejected) {
        actionCoordinator.markUncertain(submission.id, 'Delivery is not confirmed yet.');
      }
      if (currentScopeRef.current === scope) {
        if (!explicitlyRejected && !ambiguousServerResponse) {
          setSendError('Delivery is unconfirmed. Retry to check safely; the same message ID will be reused.');
        } else {
          setSendError(error instanceof Error ? error.message : 'Could not send room message.');
        }
      }
    } finally {
      if (currentScopeRef.current === scope) setSending(false);
    }
  };

  const panel = (
    <section
      className={[
        'focused-room-chat',
        embedded ? 'focused-room-chat--embedded' : '',
        !fullscreenPresent && collapsed ? 'focused-room-chat--collapsed' : '',
        fullscreenPresent ? 'focused-room-chat--fullscreen' : '',
        fullscreenClosing ? 'focused-room-chat--closing' : '',
      ].filter(Boolean).join(' ')}
      aria-label="Room chat"
      role={fullscreenPresent ? 'dialog' : undefined}
      aria-modal={fullscreenPresent ? true : undefined}
    >
      <div className="focused-room-chat__header">
        <h2 className="focused-kicker">Room chat</h2>
        <span className="focused-room-chat__status" aria-live="polite">
          {loadError ? 'Reconnecting' : loading ? 'Connecting' : 'Room'}
        </span>
        <div className="focused-room-chat__controls">
          {!fullscreenPresent && (
            <DisclosureButton
              className="focused-room-chat__fullscreen-button focused-room-chat__collapse-button"
              onClick={() => setCollapsed((current) => !current)}
              aria-label={collapsed ? 'Expand room chat' : 'Collapse room chat'}
              title={collapsed ? 'Expand room chat' : 'Collapse room chat'}
              controls="room-chat-content"
              expanded={!collapsed}
              indicator={collapsed ? <ChevronUp size={17} aria-hidden="true" /> : <ChevronDown size={17} aria-hidden="true" />}
            >
              <span className="focused-panel-disclosure-label">
                {collapsed ? 'Expand room chat' : 'Collapse room chat'}
              </span>
            </DisclosureButton>
          )}
          <button
            className="focused-room-chat__fullscreen-button"
            type="button"
            ref={fullscreenPresent ? closeButtonRef : expandButtonRef}
            onClick={() => onFullscreenChange(!fullscreenPresent)}
            aria-label={fullscreenPresent ? 'Close full-screen chat' : 'Open chat full screen'}
            title={fullscreenPresent ? 'Close chat' : 'Open full-screen chat'}
          >
            {fullscreenPresent ? <X size={17} aria-hidden="true" /> : <Maximize2 size={17} aria-hidden="true" />}
          </button>
        </div>
      </div>
      <div
        className="focused-room-chat__messages"
        id="room-chat-content"
        ref={messagesRef}
        role="log"
        aria-label="Room chat messages"
        aria-live="polite"
        aria-relevant="additions"
        tabIndex={0}
        onScroll={(event) => {
          const element = event.currentTarget;
          followsLatestRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 28;
        }}
      >
        {messages.map((message) => (
          <div
            className={`focused-room-chat__message focused-room-chat__message--${message.speakerType}`}
            key={message.submissionId ? `submission-${message.submissionId}` : `message-${message.id}`}
          >
            <span className="focused-room-chat__speaker">{message.speakerName}</span>
            <p>{message.text}</p>
          </div>
        ))}
        {pendingChatActions.map((action) => {
          if (action.details.kind !== 'chat.send') return null;
          const status: PendingActionState = action.state;
          const statusView = chatPendingStatus(status);
          return (
            <div
              className="focused-room-chat__message focused-room-chat__message--player focused-room-chat__message--pending"
              key={`submission-${action.details.clientMessageId}`}
            >
              <span className="focused-room-chat__speaker">{action.details.speakerName}</span>
              <div className="focused-room-chat__pending-content">
                <p>{action.details.text}</p>
                <PendingActionStatus
                  state={statusView}
                  label={status === 'sending' ? 'Sending…'
                    : status === 'acknowledged' ? 'Sent; waiting for room history…'
                      : 'Delivery is unconfirmed. Retry to check safely.'}
                  className="focused-room-chat__pending-status"
                />
                {status === 'uncertain' && (
                  <button
                    className="focused-room-chat__retry"
                    type="button"
                    disabled={sending}
                    onClick={() => void sendMessage(undefined, {
                      id: action.id,
                      text: action.details.kind === 'chat.send' ? action.details.text : '',
                    })}
                  >
                    Retry
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {!messages.length && !pendingChatActions.length && (
          <p className="focused-room-chat__empty">
            {loadError ? 'Room chat is unavailable. Retrying…' : loading ? 'Connecting to room…' : 'No room messages yet.'}
          </p>
        )}
      </div>
      <form className="focused-room-chat__composer" onSubmit={(event) => void sendMessage(event)}>
        <input
          type="text"
          aria-label="Message the room"
          placeholder="Message the room"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={500}
          autoComplete="off"
          disabled={sending}
        />
        <Button type="submit" variant="secondary" aria-label="Send room message" disabled={!draft.trim() || sending}>
          {sending ? 'Sending' : 'Send'}
        </Button>
      </form>
      {sendError && <p className="focused-room-chat__error" role="alert">{sendError}</p>}
    </section>
  );

  return fullscreenPresent ? createPortal(panel, document.body) : panel;
}
