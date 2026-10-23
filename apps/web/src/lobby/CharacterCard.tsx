import { useState } from 'react';
import { Button, CharacterEntryCard, TextInput } from '@mudd/ui';
import { type LobbyCharacter, entryDisabled } from './useLobby.js';

export function CharacterCard({ character, active, pending, onPlay, onManage }: {
  character: LobbyCharacter; active: boolean; pending: boolean;
  onPlay: () => void;
  onManage: (action: 'rename' | 'archive' | 'restore', character: LobbyCharacter, name?: string) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<'rename' | 'archive' | null>(null);
  const [name, setName] = useState(character.name);
  const dead = character.combat?.status === 'defeat' || character.health?.current === 0;
  return <CharacterEntryCard name={character.name} worldName={character.worldName}
    locationLabel={character.locationTitle} classLabel={character.characterClass?.label}
    level={character.advancement?.level}
    statusLabel={character.archived ? 'Archived' : dead ? 'Deceased' : active ? 'In world' : 'Ready to play'}
    actionLabel={active ? `Continue as ${character.name}` : `Play as ${character.name}`}
    onPlay={onPlay} disabled={pending || entryDisabled(character)} busy={false}
    secondaryActions={<details className="character-options"><summary aria-label={`Manage ${character.name}`}>Manage</summary>
      <div>{character.archived ? <Button variant="quiet" disabled={pending} onClick={() => void onManage('restore', character)}>Restore</Button>
        : <><Button variant="quiet" disabled={pending} onClick={() => setMode('rename')}>Rename</Button>
          <Button variant="quiet" disabled={pending || active} onClick={() => setMode('archive')}>Archive</Button></>}</div>
    </details>}>
    <p className="lobby-small">{character.lastPlayedAt
      ? <>Last played <time dateTime={character.lastPlayedAt}>{new Date(character.lastPlayedAt).toLocaleDateString()}</time></>
      : 'No recorded play history yet'}</p>
    {mode === 'rename' && <form className="lobby-form" onSubmit={(event) => {
      event.preventDefault(); void onManage('rename', character, name.trim()).then((ok) => { if (ok) setMode(null); });
    }}>
      <TextInput label="Character name" id={`rename-${character.characterId}`} value={name} onChange={(event) => setName(event.target.value)} autoFocus required minLength={2} maxLength={32} disabled={pending} />
      <div className="lobby-buttons"><Button type="submit" disabled={pending || name.trim().length < 2}>Save name</Button><Button variant="quiet" type="button" onClick={() => setMode(null)}>Cancel</Button></div>
    </form>}
    {mode === 'archive' && <div className="lobby-form"><p>Archive {character.name}? Progress is kept, and you can restore this character later.</p>
      <div className="lobby-buttons"><Button disabled={pending} onClick={() => void onManage('archive', character).then((ok) => { if (ok) setMode(null); })}>Confirm archive</Button>
        <Button variant="quiet" onClick={() => setMode(null)}>Cancel</Button></div></div>}
  </CharacterEntryCard>;
}
