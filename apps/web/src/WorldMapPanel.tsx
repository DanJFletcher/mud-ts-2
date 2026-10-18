import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, Maximize2, X } from 'lucide-react';
import type { WorldMapProjection } from '@mudd/contracts';
import { DisclosureButton } from '@mudd/ui';

type WorldMapPanelProps = Readonly<{
  map?: WorldMapProjection;
  fullscreen: boolean;
  onFullscreenChange: (fullscreen: boolean) => void;
}>;

type MapPoint = WorldMapProjection['locations'][number] & { screenX: number; screenY: number };

function projectMapPoints(map: WorldMapProjection | undefined): MapPoint[] {
  if (!map?.locations.length) return [];

  const xValues = map.locations.map((location) => location.x);
  const yValues = map.locations.map((location) => location.y);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const project = (value: number, min: number, max: number) =>
    min === max ? 50 : 16 + ((value - min) / (max - min)) * 68;

  return map.locations.map((location) => ({
    ...location,
    screenX: project(location.x, minX, maxX),
    screenY: 84 - project(location.y, minY, maxY),
  }));
}

export function WorldMapPanel({ map, fullscreen, onFullscreenChange }: WorldMapPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreenPresent, setFullscreenPresent] = useState(fullscreen);
  const [fullscreenClosing, setFullscreenClosing] = useState(false);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const wasFullscreenRef = useRef(false);

  const points = projectMapPoints(map);
  const pointById = new Map(points.map((point) => [point.id, point]));
  const currentLocation = map?.locations.find((location) => location.id === map.currentLocationId);

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
    };
    document.addEventListener('keydown', closeOnEscape);
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [fullscreenPresent, onFullscreenChange]);

  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    if (!fullscreenPresent) return;
    const touch = event.touches[0];
    const target = event.target;
    if (!touch || (target instanceof Element && target.closest('button, a, input, textarea, select'))) {
      touchStartRef.current = null;
      return;
    }
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (event: TouchEvent<HTMLElement>) => {
    if (!fullscreenPresent) return;
    const start = touchStartRef.current;
    const touch = event.changedTouches[0];
    touchStartRef.current = null;
    if (!start || !touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (deltaX > 80 && Math.abs(deltaY) <= 60) onFullscreenChange(false);
  };

  const panel = (
    <section
      className={[
        'focused-world-map',
        !fullscreenPresent && collapsed ? 'focused-world-map--collapsed' : '',
        fullscreenPresent ? 'focused-world-map--fullscreen' : '',
        fullscreenClosing ? 'focused-world-map--closing' : '',
      ].filter(Boolean).join(' ')}
      aria-label="World map"
      role={fullscreenPresent ? 'dialog' : 'region'}
      aria-modal={fullscreenPresent ? true : undefined}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={() => { touchStartRef.current = null; }}
    >
      <div className="focused-world-map__header">
        <h2>Map</h2>
        {currentLocation && <span className="focused-world-map__current-name">{currentLocation.name}</span>}
        {!fullscreenPresent && (
          <DisclosureButton
            className="focused-world-map__button"
            onClick={() => setCollapsed((current) => !current)}
            aria-label={collapsed ? 'Expand map' : 'Collapse map'}
            title={collapsed ? 'Expand map' : 'Collapse map'}
            controls="world-map-content"
            expanded={!collapsed}
            indicator={collapsed ? <ChevronDown size={17} aria-hidden="true" /> : <ChevronUp size={17} aria-hidden="true" />}
          >
            <span className="focused-panel-disclosure-label">
              {collapsed ? 'Expand map' : 'Collapse map'}
            </span>
          </DisclosureButton>
        )}
        <button
          ref={fullscreenPresent ? closeButtonRef : expandButtonRef}
          className="focused-world-map__button"
          type="button"
          onClick={() => onFullscreenChange(!fullscreenPresent)}
          aria-label={fullscreenPresent ? 'Close full-screen map' : 'Open map full screen'}
          title={fullscreenPresent ? 'Close full-screen map' : 'Open map full screen'}
        >
          {fullscreenPresent ? <X size={17} aria-hidden="true" /> : <Maximize2 size={17} aria-hidden="true" />}
        </button>
      </div>
      <div className="focused-world-map__content" id="world-map-content">
        {points.length > 0 ? (
          <>
            <svg
              className="focused-world-map__svg"
              viewBox="0 0 100 100"
              role="img"
              aria-label="Map of visited locations"
              preserveAspectRatio="xMidYMid meet"
            >
              <title>Map of visited locations</title>
              <desc>
                North is up. {points.map((point) => `${point.name}${point.id === map?.currentLocationId ? ', current location' : ', visited'}`).join('. ')}
              </desc>
              {map?.connections.map((connection) => {
                const from = pointById.get(connection.fromLocationId);
                const to = pointById.get(connection.toLocationId);
                if (!from || !to) return null;
                return (
                  <line
                    key={`${connection.fromLocationId}-${connection.toLocationId}`}
                    className="focused-world-map__path"
                    x1={from.screenX}
                    y1={from.screenY}
                    x2={to.screenX}
                    y2={to.screenY}
                  />
                );
              })}
              <g className="focused-world-map__compass" aria-hidden="true" transform="translate(92 12)">
                <circle className="focused-world-map__compass-face" r="4.8" />
                <path className="focused-world-map__compass-needle--north" d="M0 -3.7 1.4 1 0 0 -1.4 1Z" />
                <path className="focused-world-map__compass-needle--south" d="M0 3.7 1.4 -1 0 0 -1.4 -1Z" />
                <text className="focused-world-map__compass-direction" x="0" y="-6.5" textAnchor="middle">N</text>
                <text className="focused-world-map__compass-direction" x="7.1" y="1" textAnchor="middle">E</text>
                <text className="focused-world-map__compass-direction" x="0" y="8.3" textAnchor="middle">S</text>
                <text className="focused-world-map__compass-direction" x="-7.1" y="1" textAnchor="middle">W</text>
              </g>
              {points.map((point) => {
                const isCurrent = point.id === map?.currentLocationId;
                return (
                  <g
                    key={point.id}
                    className={`focused-world-map__location${isCurrent ? ' focused-world-map__location--current' : ''}`}
                  >
                    {isCurrent && <circle className="focused-world-map__current-ring" cx={point.screenX} cy={point.screenY} r="7" />}
                    <circle className="focused-world-map__marker" cx={point.screenX} cy={point.screenY} r="4" />
                    <text className="focused-world-map__label" x={point.screenX} y={point.screenY + 11} textAnchor="middle">
                      {point.name}
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="focused-world-map__legend" aria-label="Map legend">
              <span><i className="focused-world-map__legend-marker focused-world-map__legend-marker--current" /> You are here</span>
              <span><i className="focused-world-map__legend-marker" /> Visited</span>
            </div>
            <ul className="focused-world-map__screen-reader-only" aria-label="Visited locations">
              {points.map((point) => (
                <li key={point.id}>
                  {point.name}{point.id === map?.currentLocationId ? ' — current location' : ' — visited'}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="focused-world-map__empty">Your map will fill in as you explore.</p>
        )}
      </div>
    </section>
  );

  return fullscreenPresent ? createPortal(panel, document.body) : panel;
}
