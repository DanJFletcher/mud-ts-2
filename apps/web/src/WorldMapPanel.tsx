import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, Maximize2, X } from 'lucide-react';
import type { WorldMapProjection } from '@mudd/contracts';
import { trapDialogTab } from './dialog-focus.js';
import { DisclosureButton } from '@mudd/ui';

type WorldMapPanelProps = Readonly<{
  map?: WorldMapProjection;
  fullscreen: boolean;
  onFullscreenChange: (fullscreen: boolean) => void;
}>;

type MapPoint = WorldMapProjection['locations'][number] & { screenX: number; screenY: number };
type MapLayout = Readonly<{ points: MapPoint[]; width: number; height: number }>;

const MAP_TILE_SIZE = 18;
const MAP_GRID_STEP = 30;
const MAP_PADDING = 18;

function projectMapPoints(map: WorldMapProjection | undefined): MapLayout {
  if (!map?.locations.length) return { points: [], width: 100, height: 100 };
  const xValues = map.locations.map((location) => location.x);
  const yValues = map.locations.map((location) => location.y);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);

  return {
    points: map.locations.map((location) => ({
      ...location,
      screenX: MAP_PADDING + (location.x - minX) * MAP_GRID_STEP + MAP_TILE_SIZE / 2,
      screenY: MAP_PADDING + (maxY - location.y) * MAP_GRID_STEP + MAP_TILE_SIZE / 2,
    })),
    width: Math.max(
      MAP_TILE_SIZE + MAP_PADDING * 2,
      (maxX - minX) * MAP_GRID_STEP + MAP_TILE_SIZE + MAP_PADDING * 2,
    ),
    height: Math.max(
      MAP_TILE_SIZE + MAP_PADDING * 2,
      (maxY - minY) * MAP_GRID_STEP + MAP_TILE_SIZE + MAP_PADDING * 2,
    ),
  };
}

function connectionPath(from: MapPoint, to: MapPoint, direction?: string): string {
  const halfTile = MAP_TILE_SIZE / 2;
  const gap = 4;
  if (direction === 'north' || direction === 'south') {
    const sign = direction === 'north' ? -1 : 1;
    const startY = from.screenY + sign * (halfTile + gap);
    const endY = to.screenY - sign * (halfTile + gap);
    const bendY = (startY + endY) / 2;
    return `M ${from.screenX} ${startY} V ${bendY} H ${to.screenX} V ${endY}`;
  }
  if (direction === 'east' || direction === 'west') {
    const sign = direction === 'east' ? 1 : -1;
    const startX = from.screenX + sign * (halfTile + gap);
    const endX = to.screenX - sign * (halfTile + gap);
    const bendX = (startX + endX) / 2;
    return `M ${startX} ${from.screenY} H ${bendX} V ${to.screenY} H ${endX}`;
  }

  const dx = to.screenX - from.screenX;
  const dy = to.screenY - from.screenY;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sign = Math.sign(dx) || 1;
    const startX = from.screenX + sign * (halfTile + gap);
    const endX = to.screenX - sign * (halfTile + gap);
    const bendX = (startX + endX) / 2;
    return `M ${startX} ${from.screenY} H ${bendX} V ${to.screenY} H ${endX}`;
  }
  const sign = Math.sign(dy) || 1;
  const startY = from.screenY + sign * (halfTile + gap);
  const endY = to.screenY - sign * (halfTile + gap);
  const bendY = (startY + endY) / 2;
  return `M ${from.screenX} ${startY} V ${bendY} H ${to.screenX} V ${endY}`;
}

export function WorldMapPanel({ map, fullscreen, onFullscreenChange }: WorldMapPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreenPresent, setFullscreenPresent] = useState(fullscreen);
  const [fullscreenClosing, setFullscreenClosing] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<string>();
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const minimapButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const wasFullscreenRef = useRef(false);

  const layout = projectMapPoints(map);
  const points = layout.points;
  const pointById = new Map(points.map((point) => [point.id, point]));
  const focusedLocationId = points.some((point) => point.id === selectedLocationId)
    ? selectedLocationId
    : map?.currentLocationId;
  const focusedLocation = points.find((point) => point.id === focusedLocationId);

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
      if (wasFullscreenRef.current) {
        const isMobile = window.matchMedia?.('(max-width: 719px)').matches ?? false;
        (isMobile ? minimapButtonRef.current : expandButtonRef.current)?.focus();
      }
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
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              role="group"
              aria-label="Directional map of visited locations"
              preserveAspectRatio="xMidYMid meet"
            >
              <title>Directional map of visited locations</title>
              <desc>
                North is up. Blue squares are water; beige squares are inside buildings.
                White lines connect exits, arrows mark one-way exits, and black triangles mark up or down passages.
                {focusedLocation ? ` ${focusedLocation.name} is selected.` : ''}
              </desc>
              <defs>
                <marker
                  id="world-map-one-way-arrow"
                  className="focused-world-map__arrowhead"
                  markerWidth="7"
                  markerHeight="7"
                  refX="5.6"
                  refY="3.5"
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <path d="M0 0 7 3.5 0 7Z" />
                </marker>
              </defs>
              {map?.connections.map((connection) => {
                const from = pointById.get(connection.fromLocationId);
                const to = pointById.get(connection.toLocationId);
                if (!from || !to) return null;
                return (
                  <path
                    key={`${connection.fromLocationId}-${connection.toLocationId}`}
                    className={[
                      'focused-world-map__path',
                      connection.oneWay ? 'focused-world-map__path--one-way' : '',
                    ].filter(Boolean).join(' ')}
                    d={connectionPath(from, to, connection.direction)}
                    markerEnd={connection.oneWay ? 'url(#world-map-one-way-arrow)' : undefined}
                  >
                    <title>
                      {connection.oneWay
                        ? `One-way exit from ${from.name} to ${to.name}`
                        : `Exit between ${from.name} and ${to.name}`}
                    </title>
                  </path>
                );
              })}
              {points.map((point) => {
                const isCurrent = point.id === map?.currentLocationId;
                const isSelected = point.id === focusedLocationId;
                return (
                  <g
                    key={point.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Focus ${point.name} on map${isCurrent ? ', current location' : ''}`}
                    aria-current={isCurrent ? 'location' : undefined}
                    aria-pressed={isSelected}
                    className={[
                      'focused-world-map__location',
                      isCurrent ? 'focused-world-map__location--current' : '',
                      isSelected ? 'focused-world-map__location--selected' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => setSelectedLocationId(point.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedLocationId(point.id);
                      }
                    }}
                  >
                    <title>{point.name}</title>
                    <rect
                      className={[
                        'focused-world-map__tile',
                        `focused-world-map__tile--${point.terrain ?? 'land'}`,
                      ].join(' ')}
                      x={point.screenX - MAP_TILE_SIZE / 2}
                      y={point.screenY - MAP_TILE_SIZE / 2}
                      width={MAP_TILE_SIZE}
                      height={MAP_TILE_SIZE}
                    />
                    {(point.verticalExits ?? []).map((direction, index) => (
                      <path
                        key={`${point.id}-${direction}`}
                        className="focused-world-map__vertical-arrow"
                        d={direction === 'up'
                          ? `M ${point.screenX - 4 + index * 8} ${point.screenY + 2} l 4 -4 4 4 Z`
                          : `M ${point.screenX - 4 + index * 8} ${point.screenY - 2} l 4 4 4 -4 Z`}
                        aria-hidden="true"
                      />
                    ))}
                  </g>
                );
              })}
            </svg>
            <p className="focused-world-map__current-name">{focusedLocation?.name ?? 'Map'}</p>
            <div className="focused-world-map__legend" aria-label="Map legend">
              <span><i className="focused-world-map__legend-tile focused-world-map__legend-tile--land" /> Land</span>
              <span><i className="focused-world-map__legend-tile focused-world-map__legend-tile--river" /> Water</span>
              <span><i className="focused-world-map__legend-tile focused-world-map__legend-tile--building" /> Building</span>
              <span><i className="focused-world-map__legend-line" /> Exit</span>
              <span><i className="focused-world-map__legend-arrow" /> One-way</span>
            </div>
          </>
        ) : (
          <p className="focused-world-map__empty">Your map will fill in as you explore.</p>
        )}
      </div>
    </section>
  );

  const minimap = !fullscreenPresent ? (
    <button
      ref={minimapButtonRef}
      className="focused-world-map__minimap"
      type="button"
      onClick={() => onFullscreenChange(true)}
      aria-label="Open map from minimap in full screen"
      title="Open map full screen"
    >
      {points.length > 0 ? (
        <svg
          className="focused-world-map__minimap-svg"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
          focusable="false"
        >
          {map?.connections.map((connection) => {
            const from = pointById.get(connection.fromLocationId);
            const to = pointById.get(connection.toLocationId);
            if (!from || !to) return null;
            return (
              <path
                key={`${connection.fromLocationId}-${connection.toLocationId}`}
                className="focused-world-map__path"
                d={connectionPath(from, to, connection.direction)}
              />
            );
          })}
          {points.map((point) => (
            <g
              key={point.id}
              className={point.id === map?.currentLocationId ? 'focused-world-map__minimap-point--current' : ''}
            >
              <rect
                className={`focused-world-map__tile focused-world-map__tile--${point.terrain ?? 'land'}`}
                x={point.screenX - MAP_TILE_SIZE / 2}
                y={point.screenY - MAP_TILE_SIZE / 2}
                width={MAP_TILE_SIZE}
                height={MAP_TILE_SIZE}
              />
              {(point.verticalExits ?? []).map((direction, index) => (
                <path
                  key={`${point.id}-${direction}`}
                  className="focused-world-map__vertical-arrow"
                  d={direction === 'up'
                    ? `M ${point.screenX - 4 + index * 8} ${point.screenY + 2} l 4 -4 4 4 Z`
                    : `M ${point.screenX - 4 + index * 8} ${point.screenY - 2} l 4 4 4 -4 Z`}
                />
              ))}
            </g>
          ))}
        </svg>
      ) : (
        <span className="focused-world-map__minimap-empty">Map</span>
      )}
    </button>
  ) : null;

  return fullscreenPresent
    ? createPortal(panel, document.body)
    : (
      <>
        {panel}
        {minimap}
      </>
    );
}
