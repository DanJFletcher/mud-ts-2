import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, Maximize2, X } from 'lucide-react';
import { Button, DisclosureButton } from '@mudd/ui';
import { trapDialogTab } from './dialog-focus.js';

export type RoomChatMessage = Readonly<{
  id: number;
  roomId: string;
  speakerType: 'player' | 'npc';
  speakerName: string;
  text: string;
  createdAt: string;
}>;

type RoomChatPanelProps = Readonly<{
  roomId: string;
  fullscreen: boolean;
  onFullscreenChange: (fullscreen: boolean) => void;
}>;
type RoomChatResponse = Readonly<{ roomId: string; messages: readonly RoomChatMessage[] }>;
type MessageResponse = Readonly<{ message: RoomChatMessage; npcMessage?: RoomChatMessage }>;

function errorMessage(body: unknown, fallback: string) {
  if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
    return body.message;
  }
  return fallback;
}

function mergeMessages(current: readonly RoomChatMessage[], incoming: readonly RoomChatMessage[]) {
  const messages = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => messages.set(message.id, message));
  return [...messages.values()].sort((left, right) => left.id - right.id).slice(-100);
}

export function RoomChatPanel({ roomId, fullscreen, onFullscreenChange }: RoomChatPanelProps) {
  const [messages, setMessages] = useState<readonly RoomChatMessage[]>([]);
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
  const currentRoomIdRef = useRef(roomId);
  const lastMessageIdRef = useRef(0);
  const pendingSubmissionRef = useRef<{ text: string; id: string } | null>(null);
  const initialLoadCompleteRef = useRef(false);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasFullscreenRef = useRef(false);

  currentRoomIdRef.current = roomId;

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
    setMessages([]);
    setDraft('');
    setLoading(true);
    setSending(false);
    setLoadError('');
    setSendError('');

    const refreshMessages = async () => {
      if (requesting) return;
      requesting = true;
      try {
        const query = new URLSearchParams({ roomId });
        if (initialLoadCompleteRef.current) {
          query.set('afterId', String(lastMessageIdRef.current));
        }
        const response = await fetch(`/api/chat?${query.toString()}`, { credentials: 'include' });
        const body = await response.json() as RoomChatResponse & { message?: string };
        if (!response.ok) throw new Error(errorMessage(body, 'Could not load room chat.'));
        if (body.roomId !== roomId || !Array.isArray(body.messages)) {
          throw new Error('The room chat response was invalid.');
        }
        if (!active) return;

        initialLoadCompleteRef.current = true;
        if (body.messages.length) {
          lastMessageIdRef.current = Math.max(
            lastMessageIdRef.current,
            ...body.messages.map((message) => message.id),
          );
          setMessages((current) => mergeMessages(current, body.messages));
        }
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
    const interval = window.setInterval(() => void refreshMessages(), 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [roomId]);

  useEffect(() => {
    const messagesElement = messagesRef.current;
    if (messagesElement && followsLatestRef.current) {
      messagesElement.scrollTop = messagesElement.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;

    if (!pendingSubmissionRef.current || pendingSubmissionRef.current.text !== text) {
      pendingSubmissionRef.current = { text, id: globalThis.crypto.randomUUID() };
    }
    setSending(true);
    setSendError('');
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roomId,
          text,
          clientMessageId: pendingSubmissionRef.current.id,
        }),
      });
      const body = await response.json() as unknown;
      if (!response.ok) throw new Error(errorMessage(body, 'Could not send room message.'));
      const payload = body as MessageResponse;
      if (
        !payload.message ||
        payload.message.roomId !== roomId ||
        (payload.npcMessage && (payload.npcMessage.roomId !== roomId || payload.npcMessage.speakerType !== 'npc'))
      ) {
        throw new Error('The room chat response was invalid.');
      }
      if (currentRoomIdRef.current !== roomId) return;

      const incomingMessages = [payload.message, ...(payload.npcMessage ? [payload.npcMessage] : [])];
      setMessages((current) => mergeMessages(current, incomingMessages));
      setDraft('');
      pendingSubmissionRef.current = null;
    } catch (error) {
      if (currentRoomIdRef.current === roomId) {
        setSendError(error instanceof Error ? error.message : 'Could not send room message.');
      }
    } finally {
      if (currentRoomIdRef.current === roomId) setSending(false);
    }
  };

  const panel = (
    <section
      className={[
        'focused-room-chat',
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
        {!fullscreenPresent && (
          <DisclosureButton
            className="focused-room-chat__fullscreen-button focused-room-chat__collapse-button"
            onClick={() => setCollapsed((current) => !current)}
            aria-label={collapsed ? 'Expand room chat' : 'Collapse room chat'}
            title={collapsed ? 'Expand room chat' : 'Collapse room chat'}
            controls="room-chat-content"
            expanded={!collapsed}
            indicator={collapsed ? <ChevronDown size={17} aria-hidden="true" /> : <ChevronUp size={17} aria-hidden="true" />}
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
            key={message.id}
          >
            <span className="focused-room-chat__speaker">{message.speakerName}</span>
            <p>{message.text}</p>
          </div>
        ))}
        {!messages.length && (
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
