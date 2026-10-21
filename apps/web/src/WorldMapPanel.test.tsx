import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorldMapProjection } from '@mudd/contracts';
import { WorldMapPanel } from './WorldMapPanel.js';

const overworld: WorldMapProjection = {
  worldInstanceId: 'world', currentLocationId: 'tower',
  locations: [
    { id: 'clearing', name: 'Clearing', x: 0, y: 0, terrain: 'land' },
    { id: 'tower', name: 'Bell Tower', x: 1, y: 0, terrain: 'building', verticalExits: ['up'] },
  ],
  connections: [{ fromLocationId: 'clearing', toLocationId: 'tower', direction: 'east' }],
};
const basement: WorldMapProjection = {
  worldInstanceId: 'world', currentLocationId: 'basement',
  locations: [
    { id: 'basement', name: 'Basement', x: 1, y: 0, terrain: 'building', verticalExits: ['up'] },
    { id: 'corridor', name: 'Lower Corridor', x: 2, y: 0 },
  ],
  connections: [{ fromLocationId: 'basement', toLocationId: 'corridor' }],
};
const denseMap: WorldMapProjection = {
  worldInstanceId: 'world',
  currentLocationId: 'overlook',
  locations: [
    { id: 'overlook', name: 'High Lantern Overlook', x: 1, y: 1, terrain: 'land' },
    { id: 'bell-west', name: 'West of Old Bell Tower', x: 1, y: 2, terrain: 'building' },
    { id: 'bridge-approach', name: 'Glasswater Bridge Approach', x: 2, y: 1, terrain: 'river', verticalExits: ['down'] },
    { id: 'reedbank-road', name: 'Reedbank Market Road', x: 3, y: 2, terrain: 'land' },
  ],
  connections: [
    { fromLocationId: 'overlook', toLocationId: 'bell-west', direction: 'south', oneWay: true },
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
        const svg = screen.getByRole('group', { name: 'Directional map of visited locations' });
        expect(svg.querySelector('desc')).toHaveTextContent(current);
        expect(within(svg).getByRole('button', { name: `Focus ${current} on map, current location` })).toHaveAttribute('aria-current', 'location');
        expect(within(svg).getByRole('button', { name: `Focus ${visited} on map` })).toBeInTheDocument();
        expect(within(svg).queryByRole('button', { name: `Focus ${absent} on map` })).not.toBeInTheDocument();
        expect(svg.querySelectorAll('.focused-world-map__tile')).toHaveLength(2);
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
    const map = screen.getByRole('group', { name: 'Directional map of visited locations' });
    expect(within(map).getByRole('button', { name: 'Focus Basement on map, current location' })).toHaveAttribute('aria-current', 'location');
    expect(within(map).queryByRole('button', { name: 'Focus Bell Tower on map' })).not.toBeInTheDocument();
  });

  it('uses distinct room tiles, exit symbols, and accessible names without map labels', () => {
    const { container } = render(
      <WorldMapPanel map={denseMap} fullscreen={false} onFullscreenChange={vi.fn()} />,
    );
    const svg = screen.getByRole('group', { name: 'Directional map of visited locations' });

    expect(svg.querySelectorAll('.focused-world-map__tile')).toHaveLength(denseMap.locations.length);
    expect(svg.querySelector('.focused-world-map__label')).not.toBeInTheDocument();
    expect(svg.querySelector('.focused-world-map__tile--river')).toBeInTheDocument();
    expect(svg.querySelector('.focused-world-map__tile--building')).toBeInTheDocument();
    expect(svg.querySelector('.focused-world-map__vertical-arrow')).toBeInTheDocument();
    expect(svg.querySelector('.focused-world-map__path--one-way')).toHaveAttribute(
      'marker-end',
      'url(#world-map-one-way-arrow)',
    );
    for (const location of denseMap.locations) {
      expect(within(svg).getByRole('button', {
        name: `Focus ${location.name} on map${location.id === 'overlook' ? ', current location' : ''}`,
      })).toBeInTheDocument();
    }

    const destination = within(svg).getByRole('button', { name: 'Focus West of Old Bell Tower on map' });
    fireEvent.click(destination);
    expect(destination).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('.focused-world-map__location--selected')).toBeInTheDocument();
  });
});
