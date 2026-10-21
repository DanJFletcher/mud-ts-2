import "./_group.css";
import { useState } from "react";
import { WorldMapPanel } from "./WorldMapPanel";

const map = {
  worldInstanceId: "mudd-demo-instance",
  currentLocationId: "willowrest-inn",
  locations: [
    { id: "mossgate-clearing", name: "Mossgate Clearing", x: 0, y: 0 },
    { id: "stillwater-path", name: "Willowshade Track", x: -1, y: 0 },
    { id: "glasswater-approach", name: "Glasswater Approach", x: 0, y: 1 },
    { id: "glasswater-bridge", name: "Glasswater Bridge", x: 0, y: 2 },
    { id: "bellwarden-track", name: "Bellwarden Road", x: 1, y: 0 },
    { id: "tower-ridge", name: "Tower Ridge Road", x: 1, y: 1 },
    { id: "bell-tower-west", name: "West of Old Bell Tower", x: 2, y: 0 },
    { id: "reedbank-road", name: "Reedbank Road", x: 1, y: 3 },
    { id: "reedbank-stalls", name: "Reedbank Stalls", x: 2, y: 4 },
    { id: "willowrest-lane", name: "Willowrest Lane", x: 3, y: 4 },
    { id: "willowrest-inn", name: "Willowrest Inn", x: 4, y: 4 },
  ],
  connections: [
    { fromLocationId: "mossgate-clearing", toLocationId: "stillwater-path" },
    { fromLocationId: "mossgate-clearing", toLocationId: "glasswater-approach" },
    { fromLocationId: "glasswater-approach", toLocationId: "glasswater-bridge" },
    { fromLocationId: "mossgate-clearing", toLocationId: "bellwarden-track" },
    { fromLocationId: "bellwarden-track", toLocationId: "bell-tower-west" },
    { fromLocationId: "glasswater-bridge", toLocationId: "tower-ridge" },
    { fromLocationId: "tower-ridge", toLocationId: "bell-tower-west" },
    { fromLocationId: "glasswater-bridge", toLocationId: "reedbank-road" },
    { fromLocationId: "reedbank-road", toLocationId: "reedbank-stalls" },
    { fromLocationId: "reedbank-stalls", toLocationId: "willowrest-lane" },
    { fromLocationId: "willowrest-lane", toLocationId: "willowrest-inn" },
  ],
} as const;

export function Readable() {
  const [fullscreen, setFullscreen] = useState(false);
  return (
    <main className="focused-client" data-theme="dark">
      <div className="focused-map-preview">
        <WorldMapPanel map={map} fullscreen={fullscreen} onFullscreenChange={setFullscreen} layout="directory" />
      </div>
    </main>
  );
}
