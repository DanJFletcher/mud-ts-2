import { useEffect, useState } from 'react';
import { Button } from './Button.js';

export type DailyBoardJobView = {
  id: string;
  poster: string;
  title: string;
  supplyTypeId: string;
  supplyLabel?: string;
  quantity: number;
  gold: number;
  experience: number;
  carried: number;
  status: 'available' | 'active' | 'completed';
};

export interface DailyBoardProps {
  name: string;
  cycle: string;
  resetsAt: string;
  jobs: readonly DailyBoardJobView[];
  pendingJobId?: string;
  busy?: boolean;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  onClose?: () => void;
  onAccept: (jobId: string) => void;
  onDeliver: (jobId: string) => void;
}

function countdownLabel(resetsAt: string, now: number): string {
  const remaining = Math.max(0, Date.parse(resetsAt) - now);
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** Compact, command-adjacent bulletin view. Actions stay controlled by the host application. */
export function DailyBoard({
  name, cycle, resetsAt, jobs, pendingJobId, busy = false, loading = false, error, onRetry, onClose, onAccept, onDeliver,
}: DailyBoardProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <section className="mudd-daily-board" aria-labelledby="mudd-daily-board-title">
      <header className="mudd-daily-board__header">
        <div>
          <p className="mudd-daily-board__eyebrow">Daily bulletin · {cycle}</p>
          <h2 id="mudd-daily-board-title">{name}</h2>
        </div>
        <div className="mudd-daily-board__header-side">
          <p className="mudd-daily-board__reset">
            Reset {new Date(resetsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} ·{' '}
            <strong>{countdownLabel(resetsAt, now)}</strong>
          </p>
          {onClose && <Button type="button" variant="quiet" className="mudd-daily-board__close" onClick={onClose}>Close</Button>}
        </div>
      </header>
      {loading ? (
        <div className="mudd-daily-board__loading" role="status" aria-label="Loading bulletin">
          <span /><span /><span />
        </div>
      ) : error ? (
        <div className="mudd-daily-board__message" role="alert">
          <span>{error}</span>
          {onRetry && <Button variant="secondary" onClick={onRetry}>Retry</Button>}
        </div>
      ) : jobs.length === 0 ? (
        <p className="mudd-daily-board__empty">No postings are available today.</p>
      ) : (
        <ul className="mudd-daily-board__list">
          {jobs.map((job) => {
            const busy = pendingJobId === job.id;
            const remaining = Math.max(0, job.quantity - job.carried);
            return (
              <li className="mudd-daily-board__job" key={job.id}>
                <div className="mudd-daily-board__job-main">
                  <p className="mudd-daily-board__poster">{job.poster}</p>
                  <h3>{job.title}</h3>
                  <p className="mudd-daily-board__requirement">
                    {job.supplyLabel ?? job.supplyTypeId}: {job.carried}/{job.quantity} carried
                    {job.status === 'active' && remaining > 0 ? ` · ${remaining} needed` : ''}
                  </p>
                </div>
                <div className="mudd-daily-board__job-side">
                  <span className={`mudd-daily-board__status mudd-daily-board__status--${job.status}`}>
                    {job.status === 'available' ? 'Available' : job.status === 'active' ? 'In progress' : 'Complete'}
                  </span>
                  <p className="mudd-daily-board__reward">
                    {job.gold} gold <span aria-hidden="true">·</span> {job.experience} XP
                  </p>
                  {job.status === 'available' ? (
                    <Button variant="secondary" disabled={busy || Boolean(pendingJobId)} onClick={() => onAccept(job.id)}>
                      {busy ? 'Accepting…' : 'Accept'}
                    </Button>
                  ) : job.status === 'active' ? (
                    <Button variant="secondary" disabled={busy || Boolean(pendingJobId) || remaining > 0} onClick={() => onDeliver(job.id)}>
                      {busy ? 'Delivering…' : 'Deliver'}
                    </Button>
                  ) : <span className="mudd-daily-board__done">Filed</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
