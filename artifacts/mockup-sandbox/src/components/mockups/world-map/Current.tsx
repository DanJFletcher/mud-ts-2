import "./_group.css";
import { useState } from "react";
import { WorldMapPanel } from "./WorldMapPanel";

const map = {
  worldInstanceId: "mudd-demo-instance",
  currentLocationId: "glasswater-bridge",
  locations: [
    { id: "mossgate-clearing", name: "Mossgate Clearing", x: 0, y: 0, terrain: "land" },
    { id: "stillwater-path", name: "Willowshade Track", x: -1, y: 0, terrain: "forest" },
    { id: "stillwater-fountain", name: "Stillwater Fountain", x: -2, y: 0, terrain: "cobblestone" },
    { id: "glasswater-approach", name: "Glasswater Approach", x: 0, y: 1, terrain: "gravel" },
    { id: "glasswater-bridge", name: "Glasswater Bridge", x: 0, y: 2, terrain: "land" },
    { id: "glasswater-west-reach", name: "Glasswater West Reach", x: -1, y: 2, terrain: "river" },
    { id: "glasswater-willow-reach", name: "Glasswater Willow Reach", x: -2, y: 2, terrain: "river" },
    { id: "glasswater-far-reach", name: "Glasswater Far Reach", x: -3, y: 2, terrain: "river" },
    { id: "glasswater-east-reach", name: "Glasswater East Reach", x: 1, y: 2, terrain: "river" },
    { id: "bellwarden-track", name: "Bellwarden Track", x: 1, y: 0, terrain: "pasture" },
    { id: "bell-tower-west", name: "West of Old Bell Tower", x: 2, y: 0, terrain: "land" },
    { id: "reedbank-road", name: "Reedbank Road", x: 0, y: 3, terrain: "dirt" },
    { id: "reedbank-stalls", name: "Reedbank Stalls", x: 0, y: 4, terrain: "land" },
    { id: "willowrest-lane", name: "Willowrest Lane", x: 1, y: 4, terrain: "land" },
    { id: "willowrest-inn", name: "Willowrest Inn", x: 2, y: 4, terrain: "building" },
  ],
  connections: [
    { fromLocationId: "mossgate-clearing", toLocationId: "stillwater-path", direction: "west" },
    { fromLocationId: "stillwater-path", toLocationId: "stillwater-fountain", direction: "west" },
    { fromLocationId: "mossgate-clearing", toLocationId: "glasswater-approach", direction: "north" },
    { fromLocationId: "glasswater-approach", toLocationId: "glasswater-bridge", direction: "north" },
    { fromLocationId: "glasswater-bridge", toLocationId: "glasswater-west-reach", direction: "west", mapLineGapAtLocationId: "glasswater-bridge" },
    { fromLocationId: "glasswater-west-reach", toLocationId: "glasswater-willow-reach", direction: "west" },
    { fromLocationId: "glasswater-willow-reach", toLocationId: "glasswater-far-reach", direction: "west" },
    { fromLocationId: "glasswater-bridge", toLocationId: "glasswater-east-reach", direction: "east", mapLineGapAtLocationId: "glasswater-bridge" },
    { fromLocationId: "mossgate-clearing", toLocationId: "bellwarden-track", direction: "east" },
    { fromLocationId: "bellwarden-track", toLocationId: "bell-tower-west", direction: "east" },
    { fromLocationId: "glasswater-bridge", toLocationId: "reedbank-road", direction: "north" },
    { fromLocationId: "reedbank-road", toLocationId: "reedbank-stalls", direction: "north" },
    { fromLocationId: "reedbank-stalls", toLocationId: "willowrest-lane", direction: "east" },
    { fromLocationId: "willowrest-lane", toLocationId: "willowrest-inn", direction: "east" },
  ],
} as const;

export function Current() {
  const [fullscreen, setFullscreen] = useState(false);
  return (
    <main className="focused-client" data-theme="dark">
      <div className="focused-map-preview">
        <WorldMapPanel map={map} fullscreen={fullscreen} onFullscreenChange={setFullscreen} layout="labels" />
      </div>
    </main>
  );
}
