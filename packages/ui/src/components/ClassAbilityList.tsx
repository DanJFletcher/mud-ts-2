import type { AvailableClassAction } from './classTypes.js';

export interface ClassAbilityListProps {
  actions: readonly AvailableClassAction[];
  onUse: (abilityId: string) => void;
  disabled?: boolean;
  busyActionId?: string;
  label?: string;
  loading?: boolean;
  error?: string;
}

/** Presents server-projected eligibility and sends only the selected action ID upstream. */
export function ClassAbilityList({
  actions,
  onUse,
  disabled = false,
  busyActionId,
  label = 'Class abilities',
  loading = false,
  error,
}: ClassAbilityListProps) {
  if (loading) {
    return <section className="mudd-class-abilities" aria-label={label} aria-busy="true"><p role="status">Loading class actions…</p></section>;
  }
  if (error) {
    return <section className="mudd-class-abilities" aria-label={label}><p role="alert" className="mudd-class-abilities__error">{error}</p></section>;
  }
  if (actions.length === 0) {
    return (
      <section className="mudd-class-abilities" aria-label={label}>
        <p className="mudd-class-abilities__empty">No class actions are available.</p>
      </section>
    );
  }

  return (
    <section className="mudd-class-abilities" aria-label={label}>
      <ul className="mudd-class-abilities__list">
        {actions.map((action) => {
          const busy = busyActionId === action.id;
          const unavailable = !action.available;
          return (
            <li className="mudd-class-abilities__item" key={action.id}>
              <div className="mudd-class-abilities__copy">
                <h3>{action.label}</h3>
                <p>{action.description}</p>
                <span className="mudd-class-abilities__cost">
                  {action.cost.amount} {action.cost.resource}
                </span>
                {unavailable && action.unavailableReason && (
                  <p className="mudd-class-abilities__reason" id={`${action.id}-reason`}>{action.unavailableReason}</p>
                )}
              </div>
              <button
                className="mudd-class-abilities__use"
                type="button"
                onClick={() => onUse(action.id)}
                disabled={disabled || unavailable || busy}
                aria-label={busy ? `${action.label}, using` : `Use ${action.label}`}
                aria-describedby={unavailable && action.unavailableReason ? `${action.id}-reason` : undefined}
              >
                {busy ? 'Using…' : 'Use'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
