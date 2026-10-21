import { useState } from "react";
import "./_group.css";

type MapLocation = Readonly<{
  id: string;
  name: string;
  x: number;
  y: number;
  terrain?: "land" | "water" | "building";
}>;

type MapConnection = Readonly<{
  fromLocationId: string;
  toLocationId: string;
  direction?: string;
}>;

type MapPoint = MapLocation & { screenX: number; screenY: number };

const map: Readonly<{
  currentLocationId: string;
  locations: readonly MapLocation[];
  connections: readonly MapConnection[];
}> = {
  currentLocationId: "mossgate-clearing",
  locations: [
    { id: "mossgate-clearing", name: "Mossgate Clearing", x: 0, y: 0 },
    { id: "glasswater-approach", name: "Glasswater Approach", x: 0, y: 1 },
    { id: "glasswater-bridge", name: "Glasswater Bridge", x: 0, y: 2 },
    { id: "bellwarden-track", name: "Bellwarden Track", x: 1, y: 0 },
    { id: "bell-tower-west", name: "West of Old Bell Tower", x: 2, y: 0, terrain: "building" },
    { id: "river-west", name: "West River Reach", x: -1, y: 2, terrain: "water" },
    { id: "river-east", name: "East River Reach", x: 1, y: 2, terrain: "water" },
    { id: "reedbank-road", name: "Reedbank Road", x: 0, y: 3 },
  ],
  connections: [
    { fromLocationId: "mossgate-clearing", toLocationId: "glasswater-approach", direction: "north" },
    { fromLocationId: "glasswater-approach", toLocationId: "glasswater-bridge", direction: "north" },
    { fromLocationId: "mossgate-clearing", toLocationId: "bellwarden-track", direction: "east" },
    { fromLocationId: "bellwarden-track", toLocationId: "bell-tower-west", direction: "east" },
    { fromLocationId: "glasswater-bridge", toLocationId: "river-west", direction: "west" },
    { fromLocationId: "glasswater-bridge", toLocationId: "river-east", direction: "east" },
    { fromLocationId: "glasswater-bridge", toLocationId: "reedbank-road", direction: "north" },
  ],
};

const MAP_TILE_SIZE = 18;
const MAP_GRID_STEP = 30;
const MAP_PADDING = 18;

function projectMapPoints(locations: readonly MapLocation[]): { points: MapPoint[]; width: number; height: number } {
  const xValues = locations.map((location) => location.x);
  const yValues = locations.map((location) => location.y);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  return {
    points: locations.map((location) => ({
      ...location,
      screenX: MAP_PADDING + (location.x - minX) * MAP_GRID_STEP + MAP_TILE_SIZE / 2,
      screenY: MAP_PADDING + (maxY - location.y) * MAP_GRID_STEP + MAP_TILE_SIZE / 2,
    })),
    width: Math.max(MAP_TILE_SIZE + MAP_PADDING * 2, (maxX - minX) * MAP_GRID_STEP + MAP_TILE_SIZE + MAP_PADDING * 2),
    height: Math.max(MAP_TILE_SIZE + MAP_PADDING * 2, (maxY - minY) * MAP_GRID_STEP + MAP_TILE_SIZE + MAP_PADDING * 2),
  };
}

function connectionPath(from: MapPoint, to: MapPoint, direction?: string): string {
  const halfTile = MAP_TILE_SIZE / 2;
  const gap = 4;
  if (direction === "north" || direction === "south") {
    const sign = direction === "north" ? -1 : 1;
    const startY = from.screenY + sign * (halfTile + gap);
    const endY = to.screenY - sign * (halfTile + gap);
    const bendY = (startY + endY) / 2;
    return `M ${from.screenX} ${startY} V ${bendY} H ${to.screenX} V ${endY}`;
  }
  if (direction === "east" || direction === "west") {
    const sign = direction === "east" ? 1 : -1;
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

export function FloatingMinimap() {
  const [fullscreen, setFullscreen] = useState(false);
  const layout = projectMapPoints(map.locations);
  const pointById = new Map(layout.points.map((point) => [point.id, point]));

  const renderMap = (className: string) => (
    <svg className={className} viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="xMidYMid meet">
      {map.connections.map((connection) => {
        const from = pointById.get(connection.fromLocationId);
        const to = pointById.get(connection.toLocationId);
        if (!from || !to) return null;
        return <path key={`${connection.fromLocationId}-${connection.toLocationId}`} className="minimap-demo__line" d={connectionPath(from, to, connection.direction)} />;
      })}
      {layout.points.map((point) => (
        <rect
          key={point.id}
          className={[
            "minimap-demo__tile",
            `minimap-demo__tile--${point.terrain ?? "land"}`,
            point.id === map.currentLocationId ? "minimap-demo__tile--current" : "",
          ].filter(Boolean).join(" ")}
          x={point.screenX - MAP_TILE_SIZE / 2}
          y={point.screenY - MAP_TILE_SIZE / 2}
          width={MAP_TILE_SIZE}
          height={MAP_TILE_SIZE}
        />
      ))}
    </svg>
  );

  return (
    <main className="minimap-demo">
      <header className="minimap-demo__topbar">◇ MUDD</header>
      <section className="minimap-demo__transcript" aria-label="Room transcript">
        <h1>Mossgate Clearing</h1>
        <p>A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east.</p>
        <p className="minimap-demo__muted">› look</p>
        <p>You look around. The clearing opens beneath the old trees. The sound of moving water rises from the north.</p>
        <p className="minimap-demo__muted">› read marker</p>
        <p>The marker points toward Glasswater Bridge and the tower road.</p>
        <p>A traveler passes between the stones, heading west toward the fountain.</p>
      </section>
      {!fullscreen ? (
        <button
          className="minimap-demo__open"
          type="button"
          onClick={() => setFullscreen(true)}
          aria-label="Open map from minimap in full screen"
        >
          {renderMap("minimap-demo__mini-svg")}
        </button>
      ) : (
        <section className="minimap-demo__fullscreen" role="dialog" aria-modal="true" aria-label="World map">
          <div className="minimap-demo__fullscreen-header">
            <h2>Map</h2>
            <button className="minimap-demo__close" type="button" onClick={() => setFullscreen(false)} aria-label="Close full-screen map">×</button>
          </div>
          {renderMap("minimap-demo__full-svg")}
        </section>
      )}
    </main>
  );
}
