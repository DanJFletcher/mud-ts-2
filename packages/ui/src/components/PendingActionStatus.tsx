export type PendingActionStatusState =
  | "sending"
  | "acknowledged"
  | "uncertain"
  | "rejected"
  | "failed";

export type PendingActionStatusProps = Readonly<{
  state: PendingActionStatusState;
  label: string;
  detail?: string;
  className?: string;
}>;

export function PendingActionStatus({
  state,
  label,
  detail,
  className,
}: PendingActionStatusProps) {
  const classNames = [
    "mudd-pending-action",
    `mudd-pending-action--${state}`,
    className,
  ].filter(Boolean).join(" ");

  return (
    <div className={classNames} role="status" aria-live="polite" aria-atomic="true">
      <span className="mudd-pending-action__indicator" aria-hidden="true" />
      <span className="mudd-pending-action__content">
        <span className="mudd-pending-action__label">{label}</span>
        {detail && <span className="mudd-pending-action__detail">{detail}</span>}
      </span>
    </div>
  );
}
