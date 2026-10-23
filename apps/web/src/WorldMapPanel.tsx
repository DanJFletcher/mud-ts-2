import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, Maximize2, Minus, Plus, RotateCcw, X } from 'lucide-react';
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
type MapViewBox = Readonly<{ x: number; y: number; width: number; height: number }>;
type MapPanOffset = Readonly<{ x: number; y: number }>;
type CardinalMapDirection = 'north' | 'east' | 'south' | 'west';
type MapPanDrag = {
  pointerId: number;
  pointerX: number;
  pointerY: number;
  rect: DOMRect;
  viewBox: MapViewBox;
  moved: boolean;
};
type MinimapOffset = Readonly<{ x: number; y: number }>;
type MinimapRect = Readonly<{ left: number; top: number; width: number; height: number }>;
type VerticalMapDirection = 'up' | 'down';
type MinimapDrag = {
  pointerId: number;
  pointerX: number;
  pointerY: number;
  rect: DOMRect;
  offset: MinimapOffset;
  moved: boolean;
};

const MAP_TILE_SIZE = 18;
const MAP_GRID_STEP = 30;
const MAP_PADDING = 18;
const MAP_UNDERPASS_GAP = 4;
const MINIMAP_VIEW_WIDTH = MAP_GRID_STEP * 4;
const MINIMAP_VIEW_HEIGHT = MAP_GRID_STEP * 5;
const MIN_MAP_ZOOM = 0.5;
const MAX_MAP_ZOOM = 4;
const MAP_ZOOM_FACTOR = 1.25;
const MINIMAP_OFFSET_STORAGE_KEY = 'mudd.mobile-map-minimap-offset.v1';
const MINIMAP_EDGE_GAP = 8;

function orderedVerticalExits(directions: readonly VerticalMapDirection[]): VerticalMapDirection[] {
  return (['up', 'down'] as const).filter((direction) => directions.includes(direction));
}

function verticalArrowPath(
  screenX: number,
  screenY: number,
  direction: VerticalMapDirection,
  stacked: boolean,
): string {
  const verticalOffset = stacked ? (direction === 'up' ? -3.5 : 3.5) : 0;
  const centerY = screenY + verticalOffset;
  const leftX = screenX - 3.5;
  return direction === 'up'
    ? `M ${leftX} ${centerY + 1.5} l 3.5 -3.5 3.5 3.5 Z`
    : `M ${leftX} ${centerY - 1.5} l 3.5 3.5 3.5 -3.5 Z`;
}

function exitStubPath(point: MapPoint, direction: CardinalMapDirection): string {
  const halfTile = MAP_TILE_SIZE / 2;
  const stubEnd = MAP_GRID_STEP - halfTile;
  if (direction === 'north') {
    return `M ${point.screenX} ${point.screenY - halfTile} V ${point.screenY - stubEnd}`;
  }
  if (direction === 'south') {
    return `M ${point.screenX} ${point.screenY + halfTile} V ${point.screenY + stubEnd}`;
  }
  if (direction === 'east') {
    return `M ${point.screenX + halfTile} ${point.screenY} H ${point.screenX + stubEnd}`;
  }
  return `M ${point.screenX - halfTile} ${point.screenY} H ${point.screenX - stubEnd}`;
}

function readMinimapOffset(): MinimapOffset {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  try {
    const stored = window.localStorage.getItem(MINIMAP_OFFSET_STORAGE_KEY);
    if (!stored) return { x: 0, y: 0 };
    const parsed = JSON.parse(stored) as Partial<MinimapOffset>;
    if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      return { x: parsed.x!, y: parsed.y! };
    }
  } catch {
    // Storage may be unavailable; the minimap still works at its default position.
  }
  return { x: 0, y: 0 };
}

function clampMinimapPosition(rect: MinimapRect): Readonly<{ left: number; top: number }> {
  const roomNavigationTop = document
    .querySelector<HTMLElement>('.focused-bottom-nav')
    ?.getBoundingClientRect().top ?? window.innerHeight;
  const maxLeft = Math.max(
    MINIMAP_EDGE_GAP,
    window.innerWidth - rect.width - MINIMAP_EDGE_GAP,
  );
  const maxTop = Math.max(
    MINIMAP_EDGE_GAP,
    Math.min(
      window.innerHeight - rect.height - MINIMAP_EDGE_GAP,
      roomNavigationTop - rect.height - MINIMAP_EDGE_GAP,
    ),
  );
  return {
    left: Math.max(MINIMAP_EDGE_GAP, Math.min(maxLeft, rect.left)),
    top: Math.max(MINIMAP_EDGE_GAP, Math.min(maxTop, rect.top)),
  };
}

function persistMinimapOffset(offset: MinimapOffset): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MINIMAP_OFFSET_STORAGE_KEY, JSON.stringify(offset));
  } catch {
    // Keep the live drag usable if browser storage is unavailable.
  }
}

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

function minimapViewBox(layout: MapLayout, points: readonly MapPoint[], currentLocationId?: string): string {
  const current = points.find((point) => point.id === currentLocationId) ?? points[0];
  const width = MINIMAP_VIEW_WIDTH;
  const height = MINIMAP_VIEW_HEIGHT;
  if (!current) {
    return `${layout.width / 2 - width / 2} ${layout.height / 2 - height / 2} ${width} ${height}`;
  }

  const x = width <= layout.width
    ? Math.max(0, Math.min(layout.width - width, current.screenX - width / 2))
    : current.screenX - width / 2;
  const y = height <= layout.height
    ? Math.max(0, Math.min(layout.height - height, current.screenY - height / 2))
    : current.screenY - height / 2;
  return `${x} ${y} ${width} ${height}`;
}

function fullMapViewBox(
  layout: MapLayout,
  focus: MapPoint | undefined,
  zoom: number,
  panOffset: MapPanOffset = { x: 0, y: 0 },
): MapViewBox {
  const width = layout.width / zoom;
  const height = layout.height / zoom;
  const centerX = focus?.screenX ?? layout.width / 2;
  const centerY = focus?.screenY ?? layout.height / 2;
  const baseX = width <= layout.width
    ? Math.max(0, Math.min(layout.width - width, centerX - width / 2))
    : centerX - width / 2;
  const baseY = height <= layout.height
    ? Math.max(0, Math.min(layout.height - height, centerY - height / 2))
    : centerY - height / 2;
  return {
    x: width <= layout.width
      ? Math.max(0, Math.min(layout.width - width, baseX + panOffset.x))
      : baseX + panOffset.x,
    y: height <= layout.height
      ? Math.max(0, Math.min(layout.height - height, baseY + panOffset.y))
      : baseY + panOffset.y,
    width,
    height,
  };
}

function connectionPath(
  from: MapPoint,
  to: MapPoint,
  direction?: string,
  mapLineGapAtLocationId?: string,
): string {
  const halfTile = MAP_TILE_SIZE / 2;
  const startGap = mapLineGapAtLocationId === from.id ? MAP_UNDERPASS_GAP : 0;
  const endGap = mapLineGapAtLocationId === to.id ? MAP_UNDERPASS_GAP : 0;
  if (direction === 'north' || direction === 'south') {
    const sign = direction === 'north' ? -1 : 1;
    const startY = from.screenY + sign * (halfTile + startGap);
    const endY = to.screenY - sign * (halfTile + endGap);
    const bendY = (startY + endY) / 2;
    return `M ${from.screenX} ${startY} V ${bendY} H ${to.screenX} V ${endY}`;
  }
  if (direction === 'east' || direction === 'west') {
    const sign = direction === 'east' ? 1 : -1;
    const startX = from.screenX + sign * (halfTile + startGap);
    const endX = to.screenX - sign * (halfTile + endGap);
    const bendX = (startX + endX) / 2;
    return `M ${startX} ${from.screenY} H ${bendX} V ${to.screenY} H ${endX}`;
  }

  const dx = to.screenX - from.screenX;
  const dy = to.screenY - from.screenY;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sign = Math.sign(dx) || 1;
    const startX = from.screenX + sign * (halfTile + startGap);
    const endX = to.screenX - sign * (halfTile + endGap);
    const bendX = (startX + endX) / 2;
    return `M ${startX} ${from.screenY} H ${bendX} V ${to.screenY} H ${endX}`;
  }
  const sign = Math.sign(dy) || 1;
  const startY = from.screenY + sign * (halfTile + startGap);
  const endY = to.screenY - sign * (halfTile + endGap);
  const bendY = (startY + endY) / 2;
  return `M ${from.screenX} ${startY} V ${bendY} H ${to.screenX} V ${endY}`;
}

export function WorldMapPanel({ map, fullscreen, onFullscreenChange }: WorldMapPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreenPresent, setFullscreenPresent] = useState(fullscreen);
  const [fullscreenClosing, setFullscreenClosing] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<string>();
  const [minimapOffset, setMinimapOffset] = useState(readMinimapOffset);
  const [mapZoom, setMapZoom] = useState(1);
  const [mapPanOffset, setMapPanOffset] = useState<MapPanOffset>({ x: 0, y: 0 });
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const minimapButtonRef = useRef<HTMLButtonElement>(null);
  const minimapOffsetRef = useRef(minimapOffset);
  const minimapDragRef = useRef<MinimapDrag | null>(null);
  const ignoreMinimapClickRef = useRef(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const mapPanDragRef = useRef<MapPanDrag | null>(null);
  const suppressMapClickRef = useRef(false);
  const wasFullscreenRef = useRef(false);

  const layout = projectMapPoints(map);
  const points = layout.points;
  const pointById = new Map(points.map((point) => [point.id, point]));
  const focusedLocationId = points.some((point) => point.id === selectedLocationId)
    ? selectedLocationId
    : map?.currentLocationId;
  const focusedLocation = points.find((point) => point.id === focusedLocationId);
  const mapViewBox = fullMapViewBox(layout, focusedLocation, mapZoom, mapPanOffset);
  const adjustMapZoom = (direction: 1 | -1) => {
    setMapZoom((current) => Math.max(
      MIN_MAP_ZOOM,
      Math.min(
        MAX_MAP_ZOOM,
        Number((current * (direction === 1 ? MAP_ZOOM_FACTOR : 1 / MAP_ZOOM_FACTOR)).toFixed(2)),
      ),
    ));
  };
  const handleMapPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!fullscreenPresent || mapZoom <= 1 || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    mapPanDragRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      rect,
      viewBox: mapViewBox,
      moved: false,
    };
  };

  const handleMapPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = mapPanDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.pointerX;
    const deltaY = event.clientY - drag.pointerY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 4) return;
    if (!drag.moved) event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.moved = true;
    event.preventDefault();

    const nextX = Math.max(
      0,
      Math.min(layout.width - drag.viewBox.width, drag.viewBox.x - deltaX * drag.viewBox.width / drag.rect.width),
    );
    const nextY = Math.max(
      0,
      Math.min(layout.height - drag.viewBox.height, drag.viewBox.y - deltaY * drag.viewBox.height / drag.rect.height),
    );
    const baseViewBox = fullMapViewBox(layout, focusedLocation, mapZoom);
    setMapPanOffset({ x: nextX - baseViewBox.x, y: nextY - baseViewBox.y });
  };

  const finishMapPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = mapPanDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    mapPanDragRef.current = null;
    if (drag.moved) {
      suppressMapClickRef.current = true;
      window.setTimeout(() => {
        suppressMapClickRef.current = false;
      }, 0);
    }
  };

  const updateMinimapOffset = useCallback((offset: MinimapOffset) => {
    minimapOffsetRef.current = offset;
    setMinimapOffset(offset);
  }, []);

  const handleMinimapPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    minimapDragRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      rect,
      offset: minimapOffsetRef.current,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleMinimapPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = minimapDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.pointerX;
    const deltaY = event.clientY - drag.pointerY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 4) return;
    drag.moved = true;
    event.preventDefault();

    const desiredPosition = {
      left: drag.rect.left + deltaX,
      top: drag.rect.top + deltaY,
    };
    const clamped = clampMinimapPosition({
      width: drag.rect.width,
      height: drag.rect.height,
      left: desiredPosition.left,
      top: desiredPosition.top,
    });
    updateMinimapOffset({
      x: drag.offset.x + clamped.left - drag.rect.left,
      y: drag.offset.y + clamped.top - drag.rect.top,
    });
  };

  const finishMinimapDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = minimapDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    minimapDragRef.current = null;
    if (drag.moved) {
      ignoreMinimapClickRef.current = true;
      persistMinimapOffset(minimapOffsetRef.current);
      window.setTimeout(() => {
        ignoreMinimapClickRef.current = false;
      }, 0);
    }
  };

  useEffect(() => {
    const clampRestoredPosition = () => {
      const button = minimapButtonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const clamped = clampMinimapPosition(rect);
      if (clamped.left === rect.left && clamped.top === rect.top) return;
      const offset = {
        x: minimapOffsetRef.current.x + clamped.left - rect.left,
        y: minimapOffsetRef.current.y + clamped.top - rect.top,
      };
      updateMinimapOffset(offset);
      persistMinimapOffset(offset);
    };
    clampRestoredPosition();
    window.addEventListener('resize', clampRestoredPosition);
    return () => window.removeEventListener('resize', clampRestoredPosition);
  }, [fullscreenPresent, updateMinimapOffset]);

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
    if (mapZoom > 1 && target instanceof Element && target.closest('.focused-world-map__svg')) {
      touchStartRef.current = null;
      return;
    }
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
        {fullscreenPresent && (
          <div className="focused-world-map__zoom-controls" role="group" aria-label="Map zoom controls">
            <button
              className="focused-world-map__zoom-button"
              type="button"
              aria-label="Zoom out"
              title="Zoom out"
              onClick={() => adjustMapZoom(-1)}
              disabled={mapZoom <= MIN_MAP_ZOOM}
            >
              <Minus size={17} aria-hidden="true" />
            </button>
            <span className="focused-world-map__zoom-level" aria-live="polite">
              {Math.round(mapZoom * 100)}%
            </span>
            <button
              className="focused-world-map__zoom-button"
              type="button"
              aria-label="Zoom in"
              title="Zoom in"
              onClick={() => adjustMapZoom(1)}
              disabled={mapZoom >= MAX_MAP_ZOOM}
            >
              <Plus size={17} aria-hidden="true" />
            </button>
            <button
              className="focused-world-map__zoom-button"
              type="button"
              aria-label="Reset map zoom"
              title="Reset map zoom"
              onClick={() => {
                setMapZoom(1);
                setMapPanOffset({ x: 0, y: 0 });
              }}
              disabled={mapZoom === 1}
            >
              <RotateCcw size={15} aria-hidden="true" />
            </button>
          </div>
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
              className={[
                'focused-world-map__svg',
                fullscreenPresent && mapZoom > 1 ? 'focused-world-map__svg--pannable' : '',
              ].filter(Boolean).join(' ')}
              viewBox={`${mapViewBox.x} ${mapViewBox.y} ${mapViewBox.width} ${mapViewBox.height}`}
              role="group"
              aria-label="Directional map of visited locations"
              preserveAspectRatio="xMidYMid meet"
              onPointerDown={handleMapPointerDown}
              onPointerMove={handleMapPointerMove}
              onPointerUp={finishMapPan}
              onPointerCancel={finishMapPan}
            >
              <title>Directional map of visited locations</title>
              <desc>
                North is up. Water and building tiles have labeled colors; other terrain colors are authored by the world developer.
                White lines show exits, including stubs for undiscovered destinations; arrows mark one-way exits, and black triangles mark up or down passages.
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
                    d={connectionPath(
                      from,
                      to,
                      connection.direction,
                      connection.mapLineGapAtLocationId,
                    )}
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
              {(map?.exitStubs ?? []).map((stub) => {
                const from = pointById.get(stub.locationId);
                if (!from) return null;
                return (
                  <path
                    key={`${stub.locationId}-${stub.direction}`}
                    className={[
                      'focused-world-map__path',
                      'focused-world-map__path--stub',
                      stub.oneWay ? 'focused-world-map__path--one-way' : '',
                    ].filter(Boolean).join(' ')}
                    d={exitStubPath(from, stub.direction)}
                    markerEnd={stub.oneWay ? 'url(#world-map-one-way-arrow)' : undefined}
                  >
                    <title>
                      {stub.oneWay
                        ? `One-way exit leading ${stub.direction} from ${from.name}`
                        : `Exit leading ${stub.direction} from ${from.name}; destination not discovered`}
                    </title>
                  </path>
                );
              })}
              {points.map((point) => {
                const isCurrent = point.id === map?.currentLocationId;
                const isSelected = point.id === focusedLocationId;
                const verticalExits = orderedVerticalExits(point.verticalExits ?? []);
                const stackVerticalExits = verticalExits.length === 2;
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
                    onClick={(event) => {
                      if (suppressMapClickRef.current) {
                        event.preventDefault();
                        event.stopPropagation();
                        suppressMapClickRef.current = false;
                        return;
                      }
                      setSelectedLocationId(point.id);
                      setMapPanOffset({ x: 0, y: 0 });
                    }}
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
                      style={point.mapColor ? { fill: point.mapColor } : undefined}
                    />
                    {verticalExits.map((direction) => (
                      <path
                        key={`${point.id}-${direction}`}
                        className="focused-world-map__vertical-arrow"
                        data-direction={direction}
                        d={verticalArrowPath(point.screenX, point.screenY, direction, stackVerticalExits)}
                        aria-hidden="true"
                      />
                    ))}
                  </g>
                );
              })}
            </svg>
            <p className="focused-world-map__current-name">{focusedLocation?.name ?? 'Map'}</p>
            <div className="focused-world-map__legend" aria-label="Map legend">
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
      style={{ transform: `translate3d(${minimapOffset.x}px, ${minimapOffset.y}px, 0)` }}
      onPointerDown={handleMinimapPointerDown}
      onPointerMove={handleMinimapPointerMove}
      onPointerUp={finishMinimapDrag}
      onPointerCancel={finishMinimapDrag}
      onClick={(event) => {
        if (ignoreMinimapClickRef.current) {
          event.preventDefault();
          ignoreMinimapClickRef.current = false;
          return;
        }
        onFullscreenChange(true);
      }}
      aria-label="Open map full screen; drag to move the minimap"
      title="Drag to move · Tap to open map"
    >
      {points.length > 0 ? (
        <svg
          className="focused-world-map__minimap-svg"
          viewBox={minimapViewBox(layout, points, map?.currentLocationId)}
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
                  d={connectionPath(
                    from,
                    to,
                    connection.direction,
                    connection.mapLineGapAtLocationId,
                  )}
              />
            );
          })}
          {(map?.exitStubs ?? []).map((stub) => {
            const from = pointById.get(stub.locationId);
            if (!from) return null;
            return (
              <path
                key={`${stub.locationId}-${stub.direction}`}
                className={[
                  'focused-world-map__path',
                  'focused-world-map__path--stub',
                  stub.oneWay ? 'focused-world-map__path--one-way' : '',
                ].filter(Boolean).join(' ')}
                d={exitStubPath(from, stub.direction)}
              />
            );
          })}
          {points.map((point) => {
            const verticalExits = orderedVerticalExits(point.verticalExits ?? []);
            const stackVerticalExits = verticalExits.length === 2;
            return (
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
                {verticalExits.map((direction) => (
                  <path
                    key={`${point.id}-${direction}`}
                    className="focused-world-map__vertical-arrow"
                    data-direction={direction}
                    d={verticalArrowPath(point.screenX, point.screenY, direction, stackVerticalExits)}
                  />
                ))}
              </g>
            );
          })}
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
