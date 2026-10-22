import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Maximize2, X } from "lucide-react";

type WorldMapProjection = Readonly<{
  worldInstanceId: string;
  currentLocationId: string;
  locations: ReadonlyArray<Readonly<{
    id: string;
    name: string;
    x: number;
    y: number;
    terrain?: string;
    mapColor?: string;
    verticalExits?: ReadonlyArray<"up" | "down">;
  }>>;
  connections: ReadonlyArray<Readonly<{
    fromLocationId: string;
    toLocationId: string;
    direction?: string;
    oneWay?: boolean;
    mapLineGapAtLocationId?: string;
  }>>;
}>;

type MapPoint = WorldMapProjection["locations"][number] & { screenX: number; screenY: number };
type MapLayout = "labels" | "directory";
const MAP_TILE_SIZE = 8;
const MAP_UNDERPASS_GAP = 2;

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

function connectionPath(
  from: MapPoint,
  to: MapPoint,
  direction?: string,
  mapLineGapAtLocationId?: string,
): string {
  const halfTile = MAP_TILE_SIZE / 2;
  const startGap = mapLineGapAtLocationId === from.id ? MAP_UNDERPASS_GAP : 0;
  const endGap = mapLineGapAtLocationId === to.id ? MAP_UNDERPASS_GAP : 0;
  const dx = to.screenX - from.screenX;
  const dy = to.screenY - from.screenY;
  const horizontal = direction === "east" || direction === "west" ||
    (!["north", "south"].includes(direction ?? "") && Math.abs(dx) >= Math.abs(dy));

  if (horizontal) {
    const sign = direction === "west" || (!direction && dx < 0) ? -1 : 1;
    const startX = from.screenX + sign * (halfTile + startGap);
    const endX = to.screenX - sign * (halfTile + endGap);
    const bendX = (startX + endX) / 2;
    return `M ${startX} ${from.screenY} H ${bendX} V ${to.screenY} H ${endX}`;
  }

  const sign = direction === "north" || (!direction && dy < 0) ? -1 : 1;
  const startY = from.screenY + sign * (halfTile + startGap);
  const endY = to.screenY - sign * (halfTile + endGap);
  const bendY = (startY + endY) / 2;
  return `M ${from.screenX} ${startY} V ${bendY} H ${to.screenX} V ${endY}`;
}

function trapDialogTab(event: KeyboardEvent, dialog: HTMLElement | null): void {
  if (event.key !== "Tab" || !dialog) return;
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
    'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
  )).filter((element) =>
    !element.hasAttribute("hidden") &&
    element.getAttribute("aria-hidden") !== "true" &&
    element.getAttribute("aria-disabled") !== "true",
  );
  if (focusable.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !dialog.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

function DisclosureButton({
  children,
  className = "",
  controls,
  expanded,
  indicator,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  controls: string;
  expanded: boolean;
  indicator: ReactNode;
}) {
  return (
    <button
      {...props}
      className={`mudd-disclosure-button ${className}`}
      aria-controls={controls}
      aria-expanded={expanded}
      type="button"
    >
      {children}
      <span className="mudd-disclosure-button__indicator" aria-hidden="true">{indicator}</span>
    </button>
  );
}

export function WorldMapPanel({
  map,
  fullscreen,
  onFullscreenChange,
  layout = "labels",
}: {
  map?: WorldMapProjection;
  fullscreen: boolean;
  onFullscreenChange: (fullscreen: boolean) => void;
  layout?: MapLayout;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreenPresent, setFullscreenPresent] = useState(fullscreen);
  const [fullscreenClosing, setFullscreenClosing] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<string>();
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const wasFullscreenRef = useRef(false);

  const points = projectMapPoints(map);
  const pointById = new Map(points.map((point) => [point.id, point]));
  const currentLocation = map?.locations.find((location) => location.id === map.currentLocationId);
  const focusedLocationId = points.some((point) => point.id === selectedLocationId)
    ? selectedLocationId
    : map?.currentLocationId;

  useEffect(() => {
    if (fullscreen) {
      setFullscreenPresent(true);
      setFullscreenClosing(false);
      return;
    }
    if (!fullscreenPresent) return;

    setFullscreenClosing(true);
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const timeout = window.setTimeout(() => {
      setFullscreenPresent(false);
      setFullscreenClosing(false);
    }, prefersReducedMotion ? 0 : 250);
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
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onFullscreenChange(false);
      trapDialogTab(event, document.querySelector<HTMLElement>('[aria-modal="true"]'));
    };
    document.addEventListener("keydown", closeOnEscape);
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [fullscreenPresent, onFullscreenChange]);

  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    if (!fullscreenPresent) return;
    const touch = event.touches[0];
    const target = event.target;
    if (!touch || (target instanceof Element && target.closest("button, a, input, textarea, select"))) {
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
        "focused-world-map",
        !fullscreenPresent && collapsed ? "focused-world-map--collapsed" : "",
        fullscreenPresent ? "focused-world-map--fullscreen" : "",
        fullscreenClosing ? "focused-world-map--closing" : "",
      ].filter(Boolean).join(" ")}
      aria-label="World map"
      role={fullscreenPresent ? "dialog" : "region"}
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
            aria-label={collapsed ? "Expand map" : "Collapse map"}
            title={collapsed ? "Expand map" : "Collapse map"}
            controls="world-map-content"
            expanded={!collapsed}
            indicator={collapsed ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
          >
            <span className="focused-panel-disclosure-label">{collapsed ? "Expand map" : "Collapse map"}</span>
          </DisclosureButton>
        )}
        <button
          ref={fullscreenPresent ? closeButtonRef : expandButtonRef}
          className="focused-world-map__button"
          type="button"
          onClick={() => onFullscreenChange(!fullscreenPresent)}
          aria-label={fullscreenPresent ? "Close full-screen map" : "Open map full screen"}
          title={fullscreenPresent ? "Close full-screen map" : "Open map full screen"}
        >
          {fullscreenPresent ? <X size={17} aria-hidden="true" /> : <Maximize2 size={17} aria-hidden="true" />}
        </button>
      </div>
      <div
        className={`focused-world-map__content${layout === "directory" ? " focused-world-map__content--readable" : ""}`}
        id="world-map-content"
      >
        {points.length > 0 ? (
          <>
            <svg
              className="focused-world-map__svg"
              viewBox="0 0 100 100"
              role="group"
              aria-label="Directional map of visited locations"
              preserveAspectRatio="xMidYMid meet"
            >
              <title>Map of visited locations</title>
              <desc>
                {layout === "directory"
                  ? `North is up. Square tiles show visited locations and their terrain. ${currentLocation?.name ?? ""} is your current location.`
                  : "North is up. Water and building tiles have labeled colors; world developers choose other terrain colors. White lines connect exits, and arrows mark one-way exits."}
              </desc>
              <defs>
                <marker id="world-map-preview-one-way-arrow" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">
                  <path d="M0 0 4 2 0 4Z" />
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
                      "focused-world-map__path",
                      connection.oneWay ? "focused-world-map__path--one-way" : "",
                    ].filter(Boolean).join(" ")}
                    d={connectionPath(from, to, connection.direction, connection.mapLineGapAtLocationId)}
                    markerEnd={connection.oneWay ? "url(#world-map-preview-one-way-arrow)" : undefined}
                  />
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
                    aria-label={`Focus ${point.name} on map${isCurrent ? ", current location" : ""}`}
                    aria-current={isCurrent ? "location" : undefined}
                    aria-pressed={isSelected}
                    className={[
                      "focused-world-map__location",
                      isCurrent ? "focused-world-map__location--current" : "",
                      isSelected ? "focused-world-map__location--selected" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => setSelectedLocationId(point.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedLocationId(point.id);
                      }
                    }}
                  >
                    <title>{point.name}</title>
                    <rect
                      className={`focused-world-map__tile focused-world-map__tile--${point.terrain ?? "land"}`}
                      x={point.screenX - MAP_TILE_SIZE / 2}
                      y={point.screenY - MAP_TILE_SIZE / 2}
                      width={MAP_TILE_SIZE}
                      height={MAP_TILE_SIZE}
                      style={point.mapColor ? { fill: point.mapColor } : undefined}
                    />
                    {(point.verticalExits ?? []).map((verticalExit, exitIndex) => (
                      <path
                        key={`${point.id}-${verticalExit}`}
                        className="focused-world-map__vertical-arrow"
                        d={verticalExit === "up"
                          ? `M ${point.screenX - 1.4 + exitIndex * 2.8} ${point.screenY + .7} l 1.4 -1.4 1.4 1.4 Z`
                          : `M ${point.screenX - 1.4 + exitIndex * 2.8} ${point.screenY - .7} l 1.4 1.4 1.4 -1.4 Z`}
                        aria-hidden="true"
                      />
                    ))}
                  </g>
                );
              })}
            </svg>
            {layout === "directory" && (
              <ol className="focused-world-map__places" aria-label="Visited locations">
                {points.map((point, index) => {
                  const isCurrent = point.id === map?.currentLocationId;
                  const isSelected = point.id === focusedLocationId;
                  return (
                    <li className="focused-world-map__place" key={point.id}>
                      <button
                        type="button"
                        className="focused-world-map__place-button"
                        aria-label={`Focus ${point.name} on map`}
                        aria-current={isCurrent ? "location" : undefined}
                        aria-pressed={isSelected}
                        onClick={() => setSelectedLocationId(point.id)}
                      >
                        <span className="focused-world-map__place-number" aria-hidden="true">{index + 1}</span>
                        <span className="focused-world-map__place-name">{point.name}</span>
                        {isCurrent && <span className="focused-world-map__place-status">HERE</span>}
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
            <div className="focused-world-map__legend" aria-label="Map legend">
              <span><i className="focused-world-map__legend-tile focused-world-map__legend-tile--river" /> Water</span>
              <span><i className="focused-world-map__legend-tile focused-world-map__legend-tile--building" /> Building</span>
              <span><i className="focused-world-map__legend-line" /> Exit</span>
              <span><i className="focused-world-map__legend-arrow" /> One-way</span>
            </div>
            {layout === "labels" && (
              <ul className="focused-world-map__screen-reader-only" aria-label="Visited locations">
                {points.map((point) => (
                  <li key={point.id}>
                    {point.name}{point.id === map?.currentLocationId ? " — current location" : " — visited"}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="focused-world-map__empty">Your map will fill in as you explore.</p>
        )}
      </div>
    </section>
  );

  return fullscreenPresent ? createPortal(panel, document.body) : panel;
}
