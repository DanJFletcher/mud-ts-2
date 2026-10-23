import { Button } from './Button.js';

export interface StaminaStatusProps {
  current: number;
  maximum: number;
  posture: 'standing' | 'resting';
  disabled?: boolean;
  onRest: () => void;
  onStand: () => void;
}

/** Displays server-projected stamina and offers free posture controls. */
export function StaminaStatus({
  current,
  maximum,
  posture,
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
          ? 'Resting · health, stamina, and mana recover by 6% of maximum every two seconds while connected.'
          : 'Standing · health, stamina, and mana recover by 2% of maximum every two seconds while connected.'}
      </p>
      <p className="mudd-stamina-status__note">
        Free rest works in any room outside combat. Paid inn recovery immediately restores all three vitals for the inn’s listed price.
      </p>
      {resting ? (
        <Button type="button" variant="secondary" disabled={disabled} onClick={onStand}>
          Stand
        </Button>
      ) : (
        <Button type="button" variant="secondary" disabled={disabled} onClick={onRest}>
          Rest for free
        </Button>
      )}
    </section>
  );
}
