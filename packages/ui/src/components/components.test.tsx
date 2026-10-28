import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityLog } from './ActivityLog.js';
import { InteractionOptionsDialog } from './InteractionOptionsDialog.js';
import { CraftingQuantityDialog } from './CraftingQuantityDialog.js';
import { NpcDialogueDialog } from './NpcDialogueDialog.js';
import { Button } from './Button.js';
import { DisclosureButton } from './DisclosureButton.js';
import { NavigationControls } from './NavigationControls.js';
import { Panel } from './Panel.js';
import { RoomDescription } from './RoomDescription.js';
import { Text } from './Text.js';
import { TextInput } from './TextInput.js';
import { ClassChoice } from './ClassChoice.js';
import { ClassAbilityList } from './ClassAbilityList.js';
import type { CharacterClassDefinition, AvailableClassAction } from './classTypes.js';
import { WorldCard } from './WorldCard.js';
import { WorldHero } from './WorldHero.js';
import { CharacterEntryCard } from './CharacterEntryCard.js';
import { StaminaStatus } from './StaminaStatus.js';
import { DailyBoard } from './DailyBoard.js';

afterEach(() => cleanup());

const classFixture: CharacterClassDefinition = {
  id: 'warden', revision: 1, label: 'Warden', description: 'A steady protector.',
  primaryAttribute: 'strength',
  attributes: { strength: 14, intelligence: 8, constitution: 13, dexterity: 10 },
  coreAction: { id: 'shield-break', revision: 1, label: 'Shield break', description: 'A measured strike.', cost: { resource: 'stamina', amount: 3 }, baseDamage: 6, scalingAttribute: 'strength', weaponBonus: true },
};
const abilityFixture: AvailableClassAction = {
  id: 'shield-break', label: 'Shield break', description: 'A measured strike.',
  cost: { resource: 'stamina', amount: 3 }, available: true,
};

describe('@mudd/ui components', () => {
  it('announces vital recovery and offers free rest anywhere', () => {
    const onRest = vi.fn();
    render(
      <StaminaStatus
        current={60}
        maximum={100}
        posture="standing"
        onRest={onRest}
        onStand={vi.fn()}
      />,
    );
    expect(screen.getByRole('progressbar', { name: 'Stamina 60 of 100' })).toHaveValue(60);
    expect(screen.getByRole('status')).toHaveTextContent('health, stamina, and mana recover by 2%');
    fireEvent.click(screen.getByRole('button', { name: 'Rest for free' }));
    expect(onRest).toHaveBeenCalledOnce();
  });

  it('offers stand while resting and still offers free rest without a safe-location flag', () => {
    const onStand = vi.fn();
    const { rerender } = render(
      <StaminaStatus current={80} maximum={100} posture="resting" onRest={vi.fn()} onStand={onStand} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stand' }));
    expect(onStand).toHaveBeenCalledOnce();
    rerender(
      <StaminaStatus current={80} maximum={100} posture="standing" onRest={vi.fn()} onStand={onStand} />,
    );
    expect(screen.getByRole('button', { name: 'Rest for free' })).toBeInTheDocument();
  });

  it('renders world navigation as a native link with meaningful text and recovers from failed art', () => {
    render(<WorldCard name="Orraveth" summary="A salt-road world." href="/worlds/orraveth" imageSrc="/missing.png" />);
    const link = screen.getByRole('link', { name: /Orraveth.*A salt-road world/i });
    expect(link).toHaveAttribute('href', '/worlds/orraveth');
    fireEvent.error(link.querySelector('img')!);
    expect(link).toHaveClass('is-text-cover');
    expect(link.querySelector('img')).toBeNull();
  });

  it('links only known interactables from the current room in terminal prose', () => {
    const onLookTarget = vi.fn();
    render(
      <ActivityLog
        entries={[
          {
            id: 'current',
            kind: 'narration',
            locationId: 'grove',
            text: 'A brown squirrel watches the weathered marker.',
          },
          {
            id: 'previous',
            kind: 'narration',
            locationId: 'market',
            text: 'A brown squirrel watches the weathered marker.',
          },
        ]}
        currentLocationId="grove"
        lookTargets={[
          { id: 'squirrel', label: 'Brown Squirrel' },
          { id: 'marker', label: 'Weathered marker' },
        ]}
        onLookTarget={onLookTarget}
      />,
    );

    const squirrel = screen.getByRole('button', { name: 'Look at Brown Squirrel in terminal' });
    const marker = screen.getByRole('button', { name: 'Look at Weathered marker in terminal' });
    expect(squirrel).toHaveTextContent('brown squirrel');
    expect(marker).toHaveTextContent('weathered marker');
    expect(screen.getAllByRole('button')).toHaveLength(2);
    fireEvent.click(marker);
    expect(onLookTarget).toHaveBeenCalledWith({ id: 'marker', label: 'Weathered marker' });
  });

  it('shows supported actions in a closeable target dialog', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <InteractionOptionsDialog
        targetLabel="Bulletin board"
        options={[
          { id: 'look', label: 'Look' },
          { id: 'read', label: 'Read' },
        ]}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Choose an action for Bulletin board' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Read' }));
    expect(onSelect).toHaveBeenCalledWith('read');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('offers only available crafting batch sizes in an accessible quantity dialog', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <CraftingQuantityDialog
        itemLabel="Leather gloves"
        choices={[
          { quantity: 1 },
          { quantity: 5, disabled: true },
          { quantity: 10, disabled: true },
        ]}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'How many?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Leather gloves ×1' }));
    expect(onSelect).toHaveBeenCalledWith(1);
    expect(screen.getByRole('button', { name: 'Leather gloves ×5' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes the crafting quantity dialog when the native dialog is cancelled', () => {
    const onClose = vi.fn();
    render(
      <CraftingQuantityDialog
        itemLabel="Leather gloves"
        choices={[{ quantity: 1 }]}
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'How many?' });
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes the interaction dialog when the native dialog is cancelled', () => {
    const onClose = vi.fn();
    render(
      <InteractionOptionsDialog
        targetLabel="Bulletin board"
        options={[{ id: 'look', label: 'Look' }]}
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Choose an action for Bulletin board' });
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows NPC speech and response choices in a closeable conversation dialog', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <NpcDialogueDialog
        npcName="Mara"
        dialogue="The old paths still have their stories."
          farewellLabel="Goodbye"
        choices={[
          { id: 'marker', label: 'Ask about the marker' },
          { id: 'tower', label: 'Ask about the bell tower' },
        ]}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Conversation with Mara' });
    expect(dialog).toHaveTextContent('The old paths still have their stories.');
    expect(screen.getByRole('group', { name: 'Mara response options' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ask about the marker' }));
    expect(onSelect).toHaveBeenCalledWith('marker');
    fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes the NPC conversation when the native dialog is cancelled', () => {
    const onClose = vi.fn();
    render(
      <NpcDialogueDialog
        npcName="Mara"
        dialogue="The old paths still have their stories."
        farewellLabel="Goodbye"
        choices={[]}
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Conversation with Mara' });
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each(['Goodbye', 'I should get going'])(
    'closes the NPC conversation from the “%s” farewell without submitting a dialogue choice',
    (farewell) => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      render(
        <NpcDialogueDialog
          npcName="Mara"
          dialogue="The old paths still have their stories."
            farewellLabel={farewell}
          choices={[{ id: 'marker', label: 'Ask about the marker' }]}
          onSelect={onSelect}
          onClose={onClose}
        />,
      );

      const farewellGroup = screen.getByRole('group', { name: 'End conversation' });
      expect(within(farewellGroup).getAllByRole('button')).toHaveLength(1);
      fireEvent.click(within(farewellGroup).getByRole('button', { name: farewell }));

      expect(onClose).toHaveBeenCalledOnce();
      expect(onSelect).not.toHaveBeenCalled();
    },
  );

  it('uses heading hierarchy and renders world introduction as text', () => {
    render(<WorldHero name="The Waystone Path" summary="An old road." introduction={['Listen for the bells.']} />);
    expect(screen.getByRole('heading', { level: 1, name: 'The Waystone Path' })).toBeInTheDocument();
    expect(screen.getByText('Listen for the bells.')).toBeInTheDocument();
  });

  it('uses supplied artwork and falls back to the text cover if it fails', () => {
    const { container } = render(
      <WorldHero name="The Waystone Path" summary="An old road." imageSrc="/missing-world-art.jpg" />,
    );
    const hero = container.querySelector('header')!;
    expect(hero).toHaveClass('has-art');
    fireEvent.error(container.querySelector('img')!);
    expect(hero).toHaveClass('is-text-cover');
  });

  it('exposes character details and calls its explicit entry action', () => {
    const onPlay = vi.fn();
    render(<CharacterEntryCard
      name="Mira" worldName="Orraveth" classLabel="Scout" level={4}
      statusLabel="Ready" actionLabel="Continue as Mira" onPlay={onPlay}
      detailsHref="/character/mira"
      secondaryActions={<button type="button">Manage</button>}
    />);
    expect(screen.getByRole('heading', { level: 3, name: 'Mira' })).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Details' })).toHaveAttribute('href', '/character/mira');
    fireEvent.click(screen.getByRole('button', { name: 'Continue as Mira' }));
    expect(onPlay).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Manage' })).toBeInTheDocument();
  });

  it('prevents entry while busy and announces the pending state', () => {
    const onPlay = vi.fn();
    render(<CharacterEntryCard name="Mira" statusLabel="Ready" actionLabel="Play" onPlay={onPlay} busy />);
    const button = screen.getByRole('button', { name: 'Opening world…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(onPlay).not.toHaveBeenCalled();
  });

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

  it('shows all six directions and highlights only available exits', () => {
    const { container } = render(<NavigationControls exits={[
      { id: 'north-exit', direction: 'north', label: 'North to the bridge', available: true },
      { id: 'west-exit', direction: 'west', label: 'West to the clearing', available: false },
      { id: 'down-exit', direction: 'down', label: 'Down to the river', available: true },
    ]} onMove={vi.fn()} />);

    const navigation = container.querySelector<HTMLElement>('[aria-label="Quick navigation"]')!;
    expect(within(navigation).getAllByRole('button')).toHaveLength(6);
    expect(within(navigation).getByRole('button', { name: 'North' })).toBeEnabled();
    expect(within(navigation).getByRole('button', { name: 'North' })).toHaveClass('mudd-navigation__direction--available');
    expect(within(navigation).getByRole('button', { name: 'Down' })).toBeEnabled();
    expect(within(navigation).getByRole('button', { name: 'West' })).toBeDisabled();
    expect(within(navigation).getByRole('button', { name: 'West' })).not.toHaveClass('mudd-navigation__direction--available');
    expect(within(navigation).getByRole('button', { name: 'Up' })).toBeDisabled();
  });

  it('opens the Go chooser when a direction has multiple available exits', () => {
    const onMove = vi.fn();
    const onAmbiguousDirection = vi.fn();
    render(<NavigationControls
      exits={[
        { id: 'bridge-exit', direction: 'north', label: 'North to the bridge', available: true },
        { id: 'road-exit', direction: 'north', label: 'North along the road', available: true },
      ]}
      onMove={onMove}
      onAmbiguousDirection={onAmbiguousDirection}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'North, choose a destination' }));
    expect(onAmbiguousDirection).toHaveBeenCalledWith('north');
    expect(onMove).not.toHaveBeenCalled();
  });

  it('requires an explicit class selection and returns only the chosen class ID', () => {
    const onChange = vi.fn();
    render(<ClassChoice classes={[classFixture]} onChange={onChange} />);
    const choice = screen.getByRole('radio', { name: /Warden/ });
    expect(choice).not.toBeChecked();
    fireEvent.click(choice);
    expect(onChange).toHaveBeenCalledWith('warden');
    expect(screen.getByText('Shield break')).toBeInTheDocument();
    expect(screen.getByText('3 stamina')).toBeInTheDocument();
  });

  it('announces class catalog loading and error states', () => {
    const { rerender } = render(<ClassChoice classes={[]} onChange={vi.fn()} loading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading class choices');
    rerender(<ClassChoice classes={[]} onChange={vi.fn()} error="Catalog unavailable." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Catalog unavailable.');
    rerender(<ClassChoice classes={[]} onChange={vi.fn()} />);
    expect(screen.getByText('No classes are available in this world.')).toBeInTheDocument();
  });

  it('uses server availability and exposes the reason for unavailable actions', () => {
    const onUse = vi.fn();
    render(<ClassAbilityList actions={[
      abilityFixture,
      { ...abilityFixture, id: 'ward', label: 'Ward', available: false, unavailableReason: 'Not enough mana.' },
    ]} onUse={onUse} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use Shield break' }));
    expect(onUse).toHaveBeenCalledWith('shield-break');
    const unavailable = screen.getByRole('button', { name: 'Use Ward' });
    expect(unavailable).toBeDisabled();
    expect(screen.getByText('Not enough mana.')).toBeInTheDocument();
  });

  it('announces a loading state for projected actions', () => {
    render(<ClassAbilityList actions={[]} onUse={vi.fn()} loading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading class actions');
  });

  it('shows action errors and the empty state', () => {
    const onUse = vi.fn();
    const { rerender } = render(
      <ClassAbilityList actions={[]} onUse={onUse} error="Actions unavailable." />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Actions unavailable.');
    rerender(<ClassAbilityList actions={[]} onUse={onUse} />);
    expect(screen.getByText('No class actions are available.')).toBeInTheDocument();
  });

  it('shows the board in a closeable modal and sends accessible posting actions', () => {
    const onAccept = vi.fn();
    const onDeliver = vi.fn();
    const onClose = vi.fn();
    render(<DailyBoard
      name="Reedbank Bulletin"
      cycle="2026-10-23"
      resetsAt="2026-10-24T00:00:00.000Z"
      jobs={[
        { id: 'mint', poster: 'Sella', title: 'Gather river mint', supplyTypeId: 'river-mint', supplyLabel: 'River mint', quantity: 3, carried: 1, gold: 18, experience: 12, status: 'active' },
        { id: 'flowers', poster: 'Mira', title: 'Bring marsh flowers', supplyTypeId: 'marsh-flower', quantity: 2, carried: 2, gold: 16, experience: 10, status: 'active' },
        { id: 'reeds', poster: 'Olan', title: 'Bundle reeds', supplyTypeId: 'fresh-reed', quantity: 2, carried: 0, gold: 14, experience: 9, status: 'available' },
      ]}
      onAccept={onAccept}
      onDeliver={onDeliver}
      onClose={onClose}
    />);
    expect(screen.getByRole('dialog', { name: 'Reedbank Bulletin' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Reedbank Bulletin' })).toBeInTheDocument();
    expect(screen.getByText('River mint: 1/3 carried · 2 needed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(onAccept).toHaveBeenCalledWith('reeds');
    const deliverButtons = screen.getAllByRole('button', { name: 'Deliver' });
    expect(deliverButtons[0]).toBeDisabled();
    expect(deliverButtons[1]).toBeEnabled();
    fireEvent.click(deliverButtons[1]!);
    expect(onDeliver).toHaveBeenCalledWith('flowers');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('offers a retry control in the inline board error state', () => {
    const onRetry = vi.fn();
    render(<DailyBoard name="Board" cycle="2026-10-23" resetsAt="2026-10-24T00:00:00.000Z"
      jobs={[]} error="Bulletin unavailable." onRetry={onRetry} onAccept={vi.fn()} onDeliver={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Bulletin unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('closes the daily board when its native dialog is cancelled', () => {
    const onClose = vi.fn();
    render(
      <DailyBoard
        name="Board"
        cycle="2026-10-23"
        jobs={[]}
        onAccept={vi.fn()}
        onDeliver={vi.fn()}
        onClose={onClose}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Board' });
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
