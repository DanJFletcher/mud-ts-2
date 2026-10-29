import { Link, useLocation } from 'wouter';
import { useState } from 'react';
import { Button } from '@mudd/ui';
import { WorldClient } from '../App.js';
import { AccountShell } from './AccountShell.js';
import { worldPath } from './navigation.js';
import { useLobby, worldClient } from './useLobby.js';

export function WorldPlayPage({ worldId }: { worldId: string }) {
  const state = useLobby();
  const [, navigate] = useLocation();
  const [error, setError] = useState('');
  const [leaving, setLeaving] = useState(false);
  if (state.loading) return <AccountShell><p role="status">Checking your world session…</p></AccountShell>;
  if (state.catalogError || state.rosterError) return <AccountShell><p role="alert">{state.catalogError || state.rosterError}</p><Button onClick={() => void state.reload()}>Retry</Button></AccountShell>;
  const world = state.worlds.find((item) => item.worldInstanceId === worldId);
  const session = state.roster?.activeWorldSessions?.find((item) => item.worldInstanceId === worldId);
  if (!world || !session) return <AccountShell><h1>{world ? 'Choose a character to enter' : 'World not found'}</h1>
    <Link href={world ? worldPath(worldId) : '/'}>{world ? `Visit ${world.name}` : 'Back to worlds'}</Link></AccountShell>;
  return <>{error && <div role="alert" className="lobby-leave-error">{error}<Button disabled={leaving} onClick={() => setError('')}>Dismiss</Button></div>}
    <WorldClient worldInstanceId={worldId} onLeaveWorld={async () => {
      if (leaving) return;
      setLeaving(true);
      try {
        await worldClient(worldId).leaveWorld(); window.location.hash = '';
        navigate(worldPath(worldId));
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Could not leave the world. Try again.');
      } finally { setLeaving(false); }
    }} />
  </>;
}
