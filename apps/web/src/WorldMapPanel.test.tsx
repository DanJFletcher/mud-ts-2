import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorldMapProjection } from '@mudd/contracts';
import { WorldMapPanel } from './WorldMapPanel.js';

const overworld: WorldMapProjection = {
  worldInstanceId: 'world', currentLocationId: 'tower',
  locations: [
    { id: 'clearing', name: 'Clearing', x: 0, y: 0 },
    { id: 'tower', name: 'Bell Tower', x: 1, y: 0 },
  ],
  connections: [{ fromLocationId: 'clearing', toLocationId: 'tower' }],
};
const basement: WorldMapProjection = {
  worldInstanceId: 'world', currentLocationId: 'basement',
  locations: [
    { id: 'basement', name: 'Basement', x: 1, y: 0 },
    { id: 'corridor', name: 'Lower Corridor', x: 2, y: 0 },
  ],
  connections: [{ fromLocationId: 'basement', toLocationId: 'corridor' }],
};
const denseMap: WorldMapProjection = {
  worldInstanceId: 'world',
  currentLocationId: 'overlook',
  locations: [
    { id: 'overlook', name: 'High Lantern Overlook', x: 1, y: 1 },
    { id: 'bell-west', name: 'West of Old Bell Tower', x: 1.01, y: 1.01 },
    { id: 'bridge-approach', name: 'Glasswater Bridge Approach', x: 1.02, y: 1 },
    { id: 'reedbank-road', name: 'Reedbank Market Road', x: 1.03, y: 1.02 },
  ],
  connections: [
    { fromLocationId: 'overlook', toLocationId: 'bell-west' },
    { fromLocationId: 'bell-west', toLocationId: 'bridge-approach' },
    { fromLocationId: 'bridge-approach', toLocationId: 'reedbank-road' },
  ],
};

describe('map switching between floors', () => {
  for (const fullscreen of [false, true]) {
    it(`replaces visual and accessible locations in ${fullscreen ? 'full-screen' : 'compact'} mode`, () => {
      const onFullscreenChange = vi.fn();
      const { rerender } = render(
        <WorldMapPanel map={overworld} fullscreen={fullscreen} onFullscreenChange={onFullscreenChange} />,
      );
      const assertCurrentMap = (current: string, visited: string, absent: string) => {
        const svg = screen.getByRole('img', { name: 'Map of visited locations' });
        const list = screen.getByRole('list', { name: 'Visited locations' });
        expect(svg.querySelector('desc')).toHaveTextContent(current);
        expect(svg).not.toHaveTextContent(absent);
        expect(within(list).getByRole('button', { name: `Focus ${current} on map` })).toHaveAttribute('aria-current', 'location');
        expect(within(list).getByRole('button', { name: `Focus ${visited} on map` })).toBeInTheDocument();
        expect(within(list).queryByRole('button', { name: `Focus ${absent} on map` })).not.toBeInTheDocument();
        expect(svg.querySelectorAll('.focused-world-map__marker-number')).toHaveLength(2);
        expect(svg.querySelectorAll('.focused-world-map__path')).toHaveLength(1);
      };
      assertCurrentMap('Bell Tower', 'Clearing', 'Basement');
      rerender(<WorldMapPanel map={basement} fullscreen={fullscreen} onFullscreenChange={onFullscreenChange} />);
      assertCurrentMap('Basement', 'Lower Corridor', 'Bell Tower');
      rerender(<WorldMapPanel map={overworld} fullscreen={fullscreen} onFullscreenChange={onFullscreenChange} />);
      assertCurrentMap('Bell Tower', 'Clearing', 'Basement');
    });
  }

  it('uses the new map after changing floors while the map panel is collapsed', () => {
    const props = { fullscreen: false, onFullscreenChange: vi.fn() };
    const { rerender } = render(<WorldMapPanel {...props} map={overworld} />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse map' }));
    rerender(<WorldMapPanel {...props} map={basement} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand map' }));
    const list = screen.getByRole('list', { name: 'Visited locations' });
    expect(within(list).getByRole('button', { name: 'Focus Basement on map' })).toHaveAttribute('aria-current', 'location');
    expect(within(list).queryByRole('button', { name: 'Focus Bell Tower on map' })).not.toBeInTheDocument();
  });

  it('uses numbered markers and a readable directory for dense locations', () => {
    const { container } = render(
      <WorldMapPanel map={denseMap} fullscreen={false} onFullscreenChange={vi.fn()} />,
    );
    const svg = screen.getByRole('img', { name: 'Map of visited locations' });
    const list = screen.getByRole('list', { name: 'Visited locations' });

    expect(svg.querySelectorAll('.focused-world-map__marker-number')).toHaveLength(denseMap.locations.length);
    expect(svg.querySelector('.focused-world-map__label')).not.toBeInTheDocument();
    for (const location of denseMap.locations) {
      expect(within(list).getByRole('button', { name: `Focus ${location.name} on map` })).toBeInTheDocument();
    }

    const destination = within(list).getByRole('button', { name: 'Focus West of Old Bell Tower on map' });
    fireEvent.click(destination);
    expect(destination).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('.focused-world-map__selected-ring')).toBeInTheDocument();
  });
});
