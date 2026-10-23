import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, Maximize2, X } from 'lucide-react';
import { DisclosureButton, Panel } from '@mudd/ui';
import { trapDialogTab } from './dialog-focus.js';

type TerminalPanelProps = Readonly<{
  title: string;
  busy: boolean;
  children: ReactNode;
  expandRequest?: number;
  mobileViewport: boolean;
}>;

export function TerminalPanel({ title, busy, children, expandRequest = 0, mobileViewport }: TerminalPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenPresent, setFullscreenPresent] = useState(false);
  const [fullscreenClosing, setFullscreenClosing] = useState(false);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lastExpandRequestRef = useRef(expandRequest);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const wasFullscreenRef = useRef(false);

  useLayoutEffect(() => {
    if (expandRequest === lastExpandRequestRef.current) return;
    lastExpandRequestRef.current = expandRequest;
    setCollapsed(false);
  }, [expandRequest]);

  useEffect(() => {
    if (fullscreen) {
      setFullscreenPresent(true);
      setFullscreenClosing(false);
      return;
    }
    if (!fullscreenPresent) return;

    setFullscreenClosing(true);
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const timeout = window.setTimeout(() => {
      setFullscreenPresent(false);
      setFullscreenClosing(false);
    }, prefersReducedMotion ? 0 : 250);
    return () => window.clearTimeout(timeout);
  }, [fullscreen, fullscreenPresent]);

  useEffect(() => {
    if (!fullscreenPresent) {
      if (wasFullscreenRef.current) openButtonRef.current?.focus();
      wasFullscreenRef.current = false;
      return;
    }

    wasFullscreenRef.current = true;
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
      trapDialogTab(event, document.querySelector<HTMLElement>('[aria-modal="true"]'));
    };
    document.addEventListener('keydown', closeOnEscape);
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [fullscreenPresent]);

  useEffect(() => {
    if (!mobileViewport) return;
    setFullscreen(false);
    setFullscreenPresent(false);
    setFullscreenClosing(false);
  }, [mobileViewport]);

  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    if (mobileViewport) {
      touchStartRef.current = null;
      return;
    }
    const target = event.target;
    const touch = event.touches[0];
    if (
      !touch ||
      !(target instanceof Element) ||
      !target.closest('.focused-terminal-room') ||
      target.closest('button, a, input, textarea, select')
    ) {
      touchStartRef.current = null;
      return;
    }
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (event: TouchEvent<HTMLElement>) => {
    if (mobileViewport) {
      touchStartRef.current = null;
      return;
    }
    const start = touchStartRef.current;
    const touch = event.changedTouches[0];
    touchStartRef.current = null;
    if (!start || !touch) return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) >= 60 || Math.abs(deltaY) < 80) return;
    if (!fullscreenPresent && deltaY > 0) setFullscreen(true);
    if (fullscreenPresent && deltaY < 0) setFullscreen(false);
  };

  const panel = (
    <Panel
      className={[
        'focused-room',
        'focused-terminal',
        !fullscreenPresent && collapsed ? 'focused-terminal--collapsed' : '',
        fullscreenPresent ? 'focused-terminal--fullscreen' : '',
        fullscreenClosing ? 'focused-terminal--closing' : '',
      ].filter(Boolean).join(' ')}
      aria-busy={busy}
      role={fullscreenPresent ? 'dialog' : undefined}
      aria-label={fullscreenPresent ? 'Terminal' : undefined}
      aria-modal={fullscreenPresent ? true : undefined}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={() => { touchStartRef.current = null; }}
    >
      <div className="focused-terminal-room">
        <h1 className="focused-terminal-location mudd-visually-hidden">{title}</h1>
        {!mobileViewport && !fullscreenPresent && (
          <DisclosureButton
            className="focused-terminal-toggle"
            onClick={() => setCollapsed((current) => !current)}
            aria-label={collapsed ? 'Expand terminal' : 'Collapse terminal'}
            title={collapsed ? 'Expand terminal' : 'Collapse terminal'}
            controls="focused-terminal-body"
            expanded={!collapsed}
            indicator={collapsed ? <ChevronDown size={17} aria-hidden="true" /> : <ChevronUp size={17} aria-hidden="true" />}
          >
            <span className="focused-panel-disclosure-label">
              {collapsed ? 'Expand terminal' : 'Collapse terminal'}
            </span>
          </DisclosureButton>
        )}
        {!mobileViewport && (
          <button
            ref={fullscreenPresent ? closeButtonRef : openButtonRef}
            className="focused-terminal-fullscreen-button"
            type="button"
            onClick={() => setFullscreen((current) => !current)}
            aria-label={fullscreenPresent ? 'Close full-screen terminal' : 'Open terminal full screen'}
            title={fullscreenPresent ? 'Close full-screen terminal' : 'Open terminal full screen'}
          >
            {fullscreenPresent ? <X size={17} aria-hidden="true" /> : <Maximize2 size={17} aria-hidden="true" />}
          </button>
        )}
      </div>
      <div className="focused-terminal-body" id="focused-terminal-body">
        {children}
      </div>
    </Panel>
  );

  return fullscreenPresent ? createPortal(panel, document.body) : panel;
}
