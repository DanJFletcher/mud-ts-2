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
        expect(svg).toHaveTextContent(current);
        expect(svg).toHaveTextContent(visited);
        expect(svg).not.toHaveTextContent(absent);
        expect(within(list).getByText(`${current} — current location`)).toBeInTheDocument();
        expect(within(list).getByText(`${visited} — visited`)).toBeInTheDocument();
        expect(list).not.toHaveTextContent(absent);
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
    const svg = screen.getByRole('img', { name: 'Map of visited locations' });
    expect(svg).toHaveTextContent('Basement');
    expect(svg).not.toHaveTextContent('Bell Tower');
  });
});
