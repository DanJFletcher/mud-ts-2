import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActivityLog } from './ActivityLog.js';
import { Button } from './Button.js';
import { DisclosureButton } from './DisclosureButton.js';
import { NavigationControls } from './NavigationControls.js';
import { Panel } from './Panel.js';
import { RoomDescription } from './RoomDescription.js';
import { Text } from './Text.js';
import { TextInput } from './TextInput.js';

describe('@mudd/ui components', () => {
  it('renders accessible button actions and disabled state', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Inspect</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));
    expect(onClick).toHaveBeenCalledOnce();
    render(<Button disabled>Unavailable</Button>);
    expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled();
  });

  it('renders disclosure controls with their expanded state and controlled region', () => {
    const onClick = vi.fn();
    render(
      <DisclosureButton controls="quest-details" expanded onClick={onClick}>
        Current quests
      </DisclosureButton>,
    );
    const trigger = screen.getByRole('button', { name: 'Current quests' });
    expect(trigger).toHaveAttribute('aria-controls', 'quest-details');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(trigger);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders the requested semantic text element', () => {
    render(<Text as="h2" variant="heading">A quiet place</Text>);
    expect(screen.getByRole('heading', { level: 2, name: 'A quiet place' })).toBeInTheDocument();
  });

  it('renders a panel as a section with a title', () => {
    render(<Panel title="World notes">The clearing is quiet.</Panel>);
    expect(screen.getByRole('region', { name: 'World notes' })).toBeInTheDocument();
  });

  it('connects labels and validation messages to the input', () => {
    render(<TextInput id="name" label="Character name" error="Enter a name." />);
    expect(screen.getByLabelText('Character name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a name.')).toHaveAttribute('id', 'name-error');
  });

  it('announces activity entries without interpreting their text as markup', () => {
    render(<ActivityLog entries={[{ id: '1', kind: 'narration', text: '<b>Still water</b>' }]} />);
    expect(screen.getByRole('region', { name: 'Adventure log' })).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('<b>Still water</b>')).toBeInTheDocument();
  });

  it('renders room title, description and exits', () => {
    render(<RoomDescription title="Mossgate Clearing" description="Pale stones emerge from moss." exits={[
      { id: 'north', direction: 'north', label: 'To the bridge', available: true },
    ]} />);
    expect(screen.getByRole('heading', { name: 'Mossgate Clearing' })).toBeInTheDocument();
    expect(screen.getByText('To the bridge')).toBeInTheDocument();
  });

  it('sends the selected exit ID through the navigation callback', () => {
    const onMove = vi.fn();
    render(<NavigationControls exits={[{ id: 'bridge-exit', label: 'North', available: true }]} onMove={onMove} />);
    fireEvent.click(screen.getByRole('button', { name: 'North' }));
    expect(onMove).toHaveBeenCalledWith('bridge-exit');
  });
});
