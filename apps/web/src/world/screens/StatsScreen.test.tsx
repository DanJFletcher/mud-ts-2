import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWorldClientSnapshot } from '../test-support/world-client-harness.js';
import { classCatalog, classDefinition } from '../test-support/class-fixture-data.js';
import { StatsScreen, type StatsScreenProps } from './StatsScreen.js';

function statsScreenProps(overrides: Partial<StatsScreenProps> = {}): StatsScreenProps {
  return {
    infoTabs: null,
    snapshot: createWorldClientSnapshot(),
    currentCharacterClass: undefined,
    classCatalogError: undefined,
    isAnyCombatActive: false,
    visiblePvp: undefined,
    classCatalog,
    classChoiceId: '',
    setClassChoiceId: vi.fn(),
    setConfirmClassAdoption: vi.fn(),
    pending: null,
    confirmClassAdoption: false,
    adoptCharacterClass: vi.fn().mockResolvedValue(undefined),
    loading: false,
    ...overrides,
  };
}

describe('StatsScreen class presentation', () => {
  it('explains permanent adoption and keeps the action disabled until a choice is made', () => {
    const props = statsScreenProps();
    render(<StatsScreen {...props} />);

    expect(screen.getByRole('heading', { name: 'Choose your class' })).toBeVisible();
    expect(screen.getByText(/This choice is permanent/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Adopt this class' })).toBeDisabled();

    fireEvent.click(screen.getByRole('radio'));

    expect(props.setClassChoiceId).toHaveBeenCalledWith(classDefinition.id);
    expect(props.setConfirmClassAdoption).toHaveBeenCalledWith(false);
  });

  it('shows the confirmation prompt and delegates the confirmed action', () => {
    const props = statsScreenProps({
      classChoiceId: classDefinition.id,
      confirmClassAdoption: true,
    });
    render(<StatsScreen {...props} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Confirm this class for Arin. It cannot be changed later.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm permanent choice' }));

    expect(props.adoptCharacterClass).toHaveBeenCalledOnce();
  });

  it('renders the recorded class identity and its starting action', () => {
    const recordedClass: NonNullable<StatsScreenProps['currentCharacterClass']> = {
      ...classDefinition,
      catalogId: classCatalog.id,
      catalogRevision: classCatalog.revision,
    };
    render(<StatsScreen {...statsScreenProps({ currentCharacterClass: recordedClass })} />);

    expect(screen.getByRole('heading', { name: 'Class · Vanguard' })).toBeVisible();
    expect(screen.getByText('Heavy Strike')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Choose your class' })).not.toBeInTheDocument();
  });

  it('presents a class-catalog loading failure as an alert', () => {
    render(<StatsScreen {...statsScreenProps({
      classCatalog: undefined,
      classCatalogError: 'Class choices could not be loaded. Reconnect or reload to try again.',
    })} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Class choices could not be loaded. Reconnect or reload to try again.',
    );
  });
});
