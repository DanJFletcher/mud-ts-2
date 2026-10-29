import { useState } from 'react';
import { Button, CharacterEntryCard, TextInput } from '@mudd/ui';
import { appHref, characterPath } from './navigation.js';
import { type LobbyCharacter, entryDisabled } from './useLobby.js';

export function CharacterCard({ character, active, pending, compact = false, showWorldName = true, onPlay, onManage }: {
  character: LobbyCharacter; active: boolean; pending: boolean;
  compact?: boolean;
  showWorldName?: boolean;
  onPlay: () => void;
  onManage: (action: 'rename' | 'archive' | 'restore', character: LobbyCharacter, name?: string) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<'rename' | 'archive' | null>(null);
  const [name, setName] = useState(character.name);
  const dead = character.combat?.status === 'defeat' || character.health?.current === 0;
  const statusLabel = character.archived ? 'Archived' : dead ? 'Deceased' : active ? 'In world' : 'Ready to play';
  const detailsHref = appHref(characterPath(character.characterId));
  return <CharacterEntryCard name={character.name} worldName={showWorldName ? character.worldName : undefined}
    classLabel={character.characterClass?.label}
    level={character.advancement?.level}
    statusLabel={compact && !dead && !character.archived ? undefined : statusLabel}
    actionLabel={active ? `Continue as ${character.name}` : `Play as ${character.name}`}
    compact={compact}
    onPlay={onPlay} disabled={pending || entryDisabled(character)} busy={false}
    secondaryActions={<details className="character-options"><summary aria-label={`Manage ${character.name}`}>
      <span className="character-options__label">Manage</span>
      <span className="character-options__compact-label" aria-hidden="true">⋯</span>
    </summary>
      <div>
        <a className="mudd-button mudd-button--quiet character-options__details" href={detailsHref}>Details</a>
        {character.archived ? <Button variant="quiet" disabled={pending} onClick={() => void onManage('restore', character)}>Restore</Button>
        : <><Button variant="quiet" disabled={pending} onClick={() => setMode('rename')}>Rename</Button>
          <Button variant="quiet" disabled={pending || active} onClick={() => setMode('archive')}>Archive</Button></>}</div>
    </details>}>
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
