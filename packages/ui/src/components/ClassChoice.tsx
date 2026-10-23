import type { CharacterClassDefinition } from './classTypes.js';

export interface ClassChoiceProps {
  classes: readonly CharacterClassDefinition[];
  value?: string;
  onChange: (classId: string) => void;
  disabled?: boolean;
  name?: string;
  legend?: string;
  loading?: boolean;
  error?: string;
}

/** Accessible, explicit class selection. No class is selected unless value is supplied. */
export function ClassChoice({
  classes,
  value,
  onChange,
  disabled = false,
  name = 'character-class',
  legend = 'Choose a class',
  loading = false,
  error,
}: ClassChoiceProps) {
  if (loading) {
    return (
      <div className="mudd-class-choice__loading" role="status" aria-busy="true">
        <span className="mudd-class-choice__skeleton" />
        <span className="mudd-class-choice__skeleton" />
        <span className="mudd-visually-hidden">Loading class choices</span>
      </div>
    );
  }
  if (error) return <p className="mudd-class-choice__error" role="alert">{error}</p>;
  if (classes.length === 0) {
    return <p className="mudd-class-choice__empty">No classes are available in this world.</p>;
  }

  return (
    <fieldset className="mudd-class-choice" disabled={disabled}>
      <legend className="mudd-class-choice__legend">{legend}</legend>
      <div className="mudd-class-choice__list">
        {classes.map((characterClass) => {
          const selected = value === characterClass.id;
          const radioId = `${name}-${characterClass.id}`;
          return (
            <label
              className={`mudd-class-choice__option${selected ? ' is-selected' : ''}`}
              htmlFor={radioId}
              key={characterClass.id}
            >
              <input
                id={radioId}
                className="mudd-class-choice__radio"
                type="radio"
                name={name}
                value={characterClass.id}
                checked={selected}
                onChange={() => onChange(characterClass.id)}
              />
              <span className="mudd-class-choice__body">
                <span className="mudd-class-choice__heading">
                  <strong>{characterClass.label}</strong>
                  <span className="mudd-class-choice__role">{characterClass.primaryAttribute} lead</span>
                </span>
                <span className="mudd-class-choice__description">{characterClass.description}</span>
                <span className="mudd-class-choice__attributes" aria-label="Starting attributes">
                  {(['strength', 'intelligence', 'constitution', 'dexterity'] as const).map((attribute) => (
                    <span key={attribute}>
                      <span>{attribute.slice(0, 3)}</span> {characterClass.attributes[attribute]}
                    </span>
                  ))}
                </span>
                <span className="mudd-class-choice__action">
                  <span>First action</span>
                  <strong>{characterClass.coreAction.label}</strong>
                  <span>{characterClass.coreAction.description}</span>
                  <span className="mudd-class-choice__cost">
                    {characterClass.coreAction.cost.amount} {characterClass.coreAction.cost.resource}
                  </span>
                </span>
              </span>
              <span className="mudd-class-choice__mark" aria-hidden="true" />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
