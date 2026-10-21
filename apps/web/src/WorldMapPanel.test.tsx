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

  it('zooms the minimap to twice the previous scale around the current location', () => {
    const { container } = render(
      <WorldMapPanel map={overworld} fullscreen={false} onFullscreenChange={vi.fn()} />,
    );
    const svg = container.querySelector<SVGSVGElement>('.focused-world-map__minimap-svg')!;
    const [viewX, viewY, viewWidth, viewHeight] = svg.getAttribute('viewBox')!.split(/\s+/).map(Number);
    const fullMap = screen.getByRole('group', { name: 'Directional map of visited locations' });
    const [, , fullMapWidth, fullMapHeight] = fullMap.getAttribute('viewBox')!.split(/\s+/).map(Number);

    expect(viewWidth).toBeCloseTo(fullMapWidth! / 2);
    expect(viewHeight).toBeCloseTo(fullMapHeight! / 2);
    expect(viewX).toBeGreaterThan(0);
    expect(viewY).toBeGreaterThan(0);
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
