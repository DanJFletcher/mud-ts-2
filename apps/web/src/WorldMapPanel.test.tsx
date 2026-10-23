import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorldMapProjection } from '@mudd/contracts';
import { WorldMapPanel } from './WorldMapPanel.js';

const overworld: WorldMapProjection = {
  worldInstanceId: 'world', packId: 'pack', packVersion: '1.0.0', currentLocationId: 'tower', locationGroups: [],
  locations: [
    { id: 'clearing', name: 'Clearing', shortName: 'Clearing', qualifiedName: 'Clearing', locationGroupIds: [], x: 0, y: 0, terrain: 'land' },
    { id: 'tower', name: 'Bell Tower', shortName: 'Bell Tower', qualifiedName: 'Bell Tower', locationGroupIds: [], x: 1, y: 0, terrain: 'building', verticalExits: ['up'] },
  ],
  connections: [{ fromLocationId: 'clearing', toLocationId: 'tower', direction: 'east' }],
};
const basement: WorldMapProjection = {
  worldInstanceId: 'world', packId: 'pack', packVersion: '1.0.0', currentLocationId: 'basement', locationGroups: [],
  locations: [
    { id: 'basement', name: 'Basement', shortName: 'Basement', qualifiedName: 'Basement', locationGroupIds: [], x: 1, y: 0, terrain: 'building', verticalExits: ['up'] },
    { id: 'corridor', name: 'Lower Corridor', shortName: 'Lower Corridor', qualifiedName: 'Lower Corridor', locationGroupIds: [], x: 2, y: 0 },
  ],
  connections: [{ fromLocationId: 'basement', toLocationId: 'corridor' }],
};
const denseMap: WorldMapProjection = {
  worldInstanceId: 'world',
  packId: 'pack',
  packVersion: '1.0.0',
  currentLocationId: 'overlook',
  locationGroups: [],
  locations: [
    { id: 'overlook', name: 'High Lantern Overlook', shortName: 'High Lantern Overlook', qualifiedName: 'High Lantern Overlook', locationGroupIds: [], x: 1, y: 1, terrain: 'land' },
    { id: 'bell-west', name: 'West of Old Bell Tower', shortName: 'West of Old Bell Tower', qualifiedName: 'West of Old Bell Tower', locationGroupIds: [], x: 1, y: 2, terrain: 'building' },
    { id: 'bridge-approach', name: 'Glasswater Bridge Approach', shortName: 'Glasswater Bridge Approach', qualifiedName: 'Glasswater Bridge Approach', locationGroupIds: [], x: 2, y: 1, terrain: 'river', verticalExits: ['down'] },
    { id: 'reedbank-road', name: 'Reedbank Market Road', shortName: 'Reedbank Market Road', qualifiedName: 'Reedbank Market Road', locationGroupIds: [], x: 3, y: 2, terrain: 'land' },
  ],
  connections: [
    { fromLocationId: 'overlook', toLocationId: 'bell-west', direction: 'south', oneWay: true },
    { fromLocationId: 'bell-west', toLocationId: 'bridge-approach' },
    { fromLocationId: 'bridge-approach', toLocationId: 'reedbank-road' },
  ],
};

function arrowYBounds(path: SVGElement): Readonly<{ top: number; bottom: number }> {
  const values = path.getAttribute('d')?.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const start = values[1] ?? 0;
  const second = start + (values[3] ?? 0);
  const third = second + (values[5] ?? 0);
  return { top: Math.min(start, second, third), bottom: Math.max(start, second, third) };
}

describe('map switching between floors', () => {
  it('stacks up above down inside a location square with a visible gap', () => {
    const churchMap: WorldMapProjection = {
      worldInstanceId: 'world',
      packId: 'pack',
      packVersion: '1.0.0',
      currentLocationId: 'church',
      locationGroups: [],
      locations: [{
        id: 'church',
        name: 'Abandoned Church',
        shortName: 'Church',
        qualifiedName: 'Abandoned Church',
        locationGroupIds: [],
        x: 0,
        y: 0,
        terrain: 'building',
        verticalExits: ['down', 'up'],
      }],
      connections: [],
    };
    const { container } = render(
      <WorldMapPanel map={churchMap} fullscreen={false} onFullscreenChange={vi.fn()} />,
    );
    const svg = screen.getByRole('group', { name: 'Directional map of visited locations' });
    const church = within(svg).getByRole('button', {
      name: 'Focus Abandoned Church on map, current location',
    });
    const up = church.querySelector<SVGElement>('[data-direction="up"]');
    const down = church.querySelector<SVGElement>('[data-direction="down"]');
    const tile = church.querySelector<SVGRectElement>('.focused-world-map__tile');

    expect(up).not.toBeNull();
    expect(down).not.toBeNull();
    expect(tile).not.toBeNull();
    const upBounds = arrowYBounds(up!);
    const downBounds = arrowYBounds(down!);
    const tileTop = Number(tile!.getAttribute('y'));
    const tileBottom = tileTop + Number(tile!.getAttribute('height'));
    expect(upBounds.bottom).toBeLessThan(downBounds.top);
    expect(upBounds.top).toBeGreaterThan(tileTop);
    expect(downBounds.bottom).toBeLessThan(tileBottom);

    const minimap = container.querySelector('.focused-world-map__minimap-svg');
    if (minimap) {
      const miniUp = minimap.querySelector<SVGElement>('[data-direction="up"]');
      const miniDown = minimap.querySelector<SVGElement>('[data-direction="down"]');
      expect(miniUp).not.toBeNull();
      expect(miniDown).not.toBeNull();
      expect(arrowYBounds(miniUp!).bottom).toBeLessThan(arrowYBounds(miniDown!).top);
    }
  });

  it('renders a northward exit above the current room', () => {
    const map: WorldMapProjection = {
      worldInstanceId: 'world',
      packId: 'pack',
      packVersion: '1.0.0',
      currentLocationId: 'market',
      locationGroups: [],
      locations: [
        { id: 'market', name: 'Market', shortName: 'Market', qualifiedName: 'Market', locationGroupIds: [], x: 0, y: 0 },
        { id: 'road', name: 'Tower Road', shortName: 'Tower Road', qualifiedName: 'Tower Road', locationGroupIds: [], x: 0, y: 1 },
        { id: 'tower', name: 'Bell Tower', shortName: 'Bell Tower', qualifiedName: 'Bell Tower', locationGroupIds: [], x: 0, y: 2 },
      ],
      connections: [
        { fromLocationId: 'market', toLocationId: 'road', direction: 'north' },
        { fromLocationId: 'road', toLocationId: 'tower', direction: 'north' },
      ],
    };
    render(<WorldMapPanel map={map} fullscreen={false} onFullscreenChange={vi.fn()} />);
    const svg = screen.getByRole('group', { name: 'Directional map of visited locations' });
    const tileY = (name: string) => Number(
      within(svg).getByRole('button', { name: `Focus ${name} on map${name === 'Market' ? ', current location' : ''}` })
        .querySelector('.focused-world-map__tile')
        ?.getAttribute('y'),
    );

    expect(tileY('Tower Road')).toBeLessThan(tileY('Market'));
    expect(tileY('Bell Tower')).toBeLessThan(tileY('Tower Road'));
  });

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
    expect(screen.getByText('Water')).toBeInTheDocument();
    expect(screen.queryByText('River')).not.toBeInTheDocument();
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

  it('draws ordinary exits flush to room tiles and leaves a gap only at underpass endpoints', () => {
    const { container, rerender } = render(
      <WorldMapPanel map={overworld} fullscreen={false} onFullscreenChange={vi.fn()} />,
    );
    const path = () => container.querySelector('.focused-world-map__svg .focused-world-map__path');

    expect(path()).toHaveAttribute('d', 'M 36 27 H 42 V 27 H 48');

    rerender(
      <WorldMapPanel
        map={{
          ...overworld,
          connections: [{
            ...overworld.connections[0]!,
            mapLineGapAtLocationId: 'tower',
          }],
        }}
        fullscreen={false}
        onFullscreenChange={vi.fn()}
      />,
    );
    expect(path()).toHaveAttribute('d', 'M 36 27 H 40 V 27 H 44');
  });

  it('keeps the legend focused on shared symbols and supports developer-colored terrain', () => {
    const terrains = [
      'forest',
      'pasture',
      'vegetable-garden',
      'cobblestone',
      'gravel',
      'dirt',
      'wheat-field',
      'river',
      'building',
    ] as const;
    const map: WorldMapProjection = {
      ...overworld,
      currentLocationId: 'tile-0',
      locations: terrains.map((terrain, index) => ({
        id: `tile-${index}`,
        name: `Terrain ${index}`,
        shortName: `Terrain ${index}`,
        qualifiedName: `Terrain ${index}`,
        locationGroupIds: [],
        x: index,
        y: 0,
        terrain,
        ...(terrain === 'wheat-field' ? { mapColor: '#c89b45' } : {}),
      })),
      connections: [],
    };
    const { container } = render(
      <WorldMapPanel map={map} fullscreen={false} onFullscreenChange={vi.fn()} />,
    );
    const svg = container.querySelector('.focused-world-map__svg')!;

    for (const terrain of terrains) {
      expect(svg.querySelector(`.focused-world-map__tile--${terrain}`)).toBeInTheDocument();
    }
    expect(svg.querySelector('.focused-world-map__tile--wheat-field')).toHaveStyle({ fill: '#c89b45' });
    for (const label of ['Water', 'Building', 'Exit', 'One-way']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const label of ['Land', 'Forest', 'Pasture', 'Vegetable garden', 'Cobblestone', 'Gravel', 'Dirt']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('opens the full-screen map when the mobile minimap is tapped', () => {
    const onFullscreenChange = vi.fn();
    const { container } = render(
      <WorldMapPanel map={overworld} fullscreen={false} onFullscreenChange={onFullscreenChange} />,
    );
    const minimap = container.querySelector<HTMLButtonElement>('.focused-world-map__minimap');

    expect(minimap).toHaveAttribute('aria-label', 'Open map full screen; drag to move the minimap');
    expect(minimap?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(minimap!);
    expect(onFullscreenChange).toHaveBeenCalledWith(true);
  });

  it('keeps a fixed minimap scale across different map sizes and centers on the current room', () => {
    const { container, rerender } = render(
      <WorldMapPanel map={overworld} fullscreen={false} onFullscreenChange={vi.fn()} />,
    );
    const svg = container.querySelector<SVGSVGElement>('.focused-world-map__minimap-svg')!;
    const readViewBox = () => svg.getAttribute('viewBox')!.split(/\s+/).map(Number);
    const assertCurrentRoomCentered = (viewBox: number[]) => {
      const currentTile = svg.querySelector<SVGRectElement>(
        '.focused-world-map__minimap-point--current .focused-world-map__tile',
      )!;
      const tileX = Number(currentTile.getAttribute('x')) + Number(currentTile.getAttribute('width')) / 2;
      const tileY = Number(currentTile.getAttribute('y')) + Number(currentTile.getAttribute('height')) / 2;
      expect(viewBox[0]! + viewBox[2]! / 2).toBeCloseTo(tileX);
      expect(viewBox[1]! + viewBox[3]! / 2).toBeCloseTo(tileY);
    };
    const smallMapViewBox = readViewBox();
    assertCurrentRoomCentered(smallMapViewBox);

    rerender(<WorldMapPanel map={denseMap} fullscreen={false} onFullscreenChange={vi.fn()} />);
    const denseMapViewBox = readViewBox();
    expect(denseMapViewBox.slice(2)).toEqual(smallMapViewBox.slice(2));
    assertCurrentRoomCentered(denseMapViewBox);

    const largerMap: WorldMapProjection = {
      worldInstanceId: 'world',
      packId: 'pack',
      packVersion: '1.0.0',
      currentLocationId: 'line-4',
      locationGroups: [],
      locations: Array.from({ length: 9 }, (_, x) => ({
        id: `line-${x}`,
        name: `Line ${x}`,
        shortName: `Line ${x}`,
        qualifiedName: `Line ${x}`,
        locationGroupIds: [],
        x,
        y: 0,
        terrain: 'land' as const,
      })),
      connections: [],
    };
    rerender(<WorldMapPanel map={largerMap} fullscreen={false} onFullscreenChange={vi.fn()} />);
    const largerMapViewBox = readViewBox();
    expect(largerMapViewBox.slice(2)).toEqual(smallMapViewBox.slice(2));
    assertCurrentRoomCentered(largerMapViewBox);
  });

  it('zooms the full-screen map in and out and can reset to the full map', () => {
    render(<WorldMapPanel map={denseMap} fullscreen onFullscreenChange={vi.fn()} />);
    const svg = document.querySelector<SVGSVGElement>('.focused-world-map__svg')!;
    const readViewBox = () => svg.getAttribute('viewBox')!.split(/\s+/).map(Number);
    const initialViewBox = readViewBox();

    expect(screen.getByRole('group', { name: 'Map zoom controls' })).toBeVisible();
    expect(screen.getByText('100%')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reset map zoom' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('125%')).toBeVisible();
    expect(readViewBox()[2]).toBeCloseTo(initialViewBox[2]! / 1.25);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(screen.getByText('100%')).toBeVisible();
    expect(readViewBox()).toEqual(initialViewBox);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset map zoom' }));
    expect(readViewBox()).toEqual(initialViewBox);
  });

  it('pans the full-screen map by dragging after zooming in', () => {
    render(<WorldMapPanel map={denseMap} fullscreen onFullscreenChange={vi.fn()} />);
    const svg = document.querySelector<SVGSVGElement>('.focused-world-map__svg')!;
    const readViewBox = () => svg.getAttribute('viewBox')!.split(/\s+/).map(Number);
    const currentRoom = screen.getByRole('button', {
      name: 'Focus High Lantern Overlook on map, current location',
    });
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 300));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    const zoomedViewBox = readViewBox();

    fireEvent.pointerDown(svg, {
      pointerId: 1,
      pointerType: 'touch',
      button: 0,
      clientX: 200,
      clientY: 150,
    });
    fireEvent.pointerMove(svg, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 160,
      clientY: 150,
    });
    fireEvent.pointerUp(svg, { pointerId: 1, pointerType: 'touch' });

    expect(readViewBox()[0]).toBeGreaterThan(zoomedViewBox[0]!);
    expect(currentRoom).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps location taps working while zoomed', () => {
    render(<WorldMapPanel map={denseMap} fullscreen onFullscreenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    const destination = screen.getByRole('button', { name: 'Focus Reedbank Market Road on map' });

    fireEvent.pointerDown(destination, {
      pointerId: 2,
      pointerType: 'touch',
      button: 0,
      clientX: 200,
      clientY: 150,
    });
    fireEvent.pointerUp(destination, { pointerId: 2, pointerType: 'touch' });
    fireEvent.click(destination);

    expect(destination).toHaveAttribute('aria-pressed', 'true');
  });

  it('lets the minimap be dragged without opening the map and remembers its position', () => {
    window.localStorage.removeItem('mudd.mobile-map-minimap-offset.v1');
    const onFullscreenChange = vi.fn();
    const { container, unmount } = render(
      <WorldMapPanel map={overworld} fullscreen={false} onFullscreenChange={onFullscreenChange} />,
    );
    const minimap = container.querySelector<HTMLButtonElement>('.focused-world-map__minimap')!;

    expect(minimap).toHaveStyle({ transform: 'translate3d(0px, 0px, 0)' });

    fireEvent.pointerDown(minimap, {
      pointerId: 1,
      pointerType: 'touch',
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(minimap, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 140,
      clientY: 150,
    });
    fireEvent.pointerUp(minimap, { pointerId: 1, pointerType: 'touch' });
    fireEvent.click(minimap);

    expect(minimap).toHaveStyle({ transform: 'translate3d(40px, 50px, 0)' });
    expect(onFullscreenChange).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('mudd.mobile-map-minimap-offset.v1')).toBe('{"x":40,"y":50}');

    unmount();
    const restored = render(
      <WorldMapPanel map={overworld} fullscreen={false} onFullscreenChange={onFullscreenChange} />,
    );
    expect(restored.container.querySelector('.focused-world-map__minimap')).toHaveStyle({
      transform: 'translate3d(40px, 50px, 0)',
    });
  });
});
