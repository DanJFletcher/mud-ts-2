import { Button } from './Button.js';

export interface StaminaStatusProps {
  current: number;
  maximum: number;
  posture: 'standing' | 'resting';
  safeToRest: boolean;
  disabled?: boolean;
  onRest: () => void;
  onStand: () => void;
}

/** Displays server-projected stamina and offers free posture controls. */
export function StaminaStatus({
  current,
  maximum,
  posture,
  safeToRest,
  disabled = false,
  onRest,
  onStand,
}: StaminaStatusProps) {
  const resting = posture === 'resting';
  return (
    <section className="mudd-stamina-status" aria-labelledby="mudd-stamina-title">
      <div className="mudd-stamina-status__heading">
        <h2 id="mudd-stamina-title">Stamina</h2>
        <strong>{current} / {maximum}</strong>
      </div>
      <progress
        aria-label={`Stamina ${current} of ${maximum}`}
        max={maximum}
        value={current}
      />
      <p className="mudd-stamina-status__posture" role="status">
        {resting
          ? 'Resting · recovers 3% of maximum stamina per second while connected.'
          : 'Standing · recovers 1% of maximum stamina per second while connected.'}
      </p>
      <p className="mudd-stamina-status__note">
        Free rest changes posture and restores stamina over time. Paid inn recovery immediately restores health,
        stamina, and mana for the inn’s listed price.
      </p>
      {resting ? (
        <Button type="button" variant="secondary" disabled={disabled} onClick={onStand}>
          Stand
        </Button>
      ) : safeToRest ? (
        <Button type="button" variant="secondary" disabled={disabled} onClick={onRest}>
          Rest here for free
        </Button>
      ) : (
        <p className="mudd-stamina-status__note">Free rest is only available at safe places.</p>
      )}
    </section>
  );
}
