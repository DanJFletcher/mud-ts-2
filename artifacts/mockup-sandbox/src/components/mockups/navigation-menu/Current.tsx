import { useRef, useState } from "react";
import { Compass, Keyboard, Menu, Moon, NotebookText, Sun, UserRound, Users, X } from "lucide-react";
import "./_group.css";

export function Current() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(true);
  const [darkTheme, setDarkTheme] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <main className="mudd-nav-preview">
      <section className="mudd-nav-preview__content" aria-label="Play screen">
        <article className="mudd-nav-preview__terminal">
          <header className="mudd-nav-preview__room-header">
            <h1>Glasswater Bridge</h1>
            <button type="button" aria-label="Collapse terminal">⌃</button>
          </header>
          <div className="mudd-nav-preview__history" aria-label="Terminal output">
            <p><span>south</span><strong>A Paved Street</strong>The paved street runs between a round stone temple to the west and the city barracks to the east.</p>
            <p>The street turns into a path further north, cutting between homes before vanishing into a green forest.</p>
            <p className="mudd-nav-preview__muted">[exits: N S]</p>
            <p><u>A guard of the Town Watch patrols the area, eyes alert.</u></p>
          </div>
          {typeOpen && (
            <form className="mudd-nav-preview__composer" onSubmit={(event) => event.preventDefault()}>
              <input ref={inputRef} aria-label="Enter a command" autoFocus autoComplete="off" spellCheck={false} defaultValue="look" />
            </form>
          )}
        </article>
      </section>
      <nav className="mudd-nav-preview__tabs" aria-label="Game screens">
        <button className="mudd-nav-preview__tab mudd-nav-preview__tab--active" type="button"><Compass aria-hidden="true" /><span>Play</span></button>
        <button className="mudd-nav-preview__tab" type="button"><UserRound aria-hidden="true" /><span>Traveler</span></button>
        <button className="mudd-nav-preview__tab" type="button"><NotebookText aria-hidden="true" /><span>Field notes</span></button>
        <button
          className={`mudd-nav-preview__tab${typeOpen ? " mudd-nav-preview__tab--active" : ""}`}
          type="button"
          aria-pressed={typeOpen}
          onClick={() => {
            if (typeOpen) {
              inputRef.current?.blur();
              setTypeOpen(false);
              return;
            }
            setMenuOpen(false);
            setTypeOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        >
          <Keyboard aria-hidden="true" /><span>Type</span>
        </button>
        <div className="mudd-nav-preview__menu">
          <button
            className={`mudd-nav-preview__tab mudd-nav-preview__menu-trigger${menuOpen ? " mudd-nav-preview__tab--active" : ""}`}
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mudd-nav-preview-panel"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
            <span>Menu</span>
          </button>
          {menuOpen && (
            <div className="mudd-nav-preview__panel" id="mudd-nav-preview-panel" role="region" aria-label="Menu">
              <div className="mudd-nav-preview__brand"><span className="mudd-nav-preview__brand-mark" aria-hidden="true" /><span>MUDD</span></div>
              <button className="mudd-nav-preview__action" type="button"><Users size={18} aria-hidden="true" /><span>Characters</span></button>
              <button className="mudd-nav-preview__action" type="button" onClick={() => setDarkTheme((dark) => !dark)}>
                {darkTheme ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
                <span>Switch to {darkTheme ? "light" : "dark"} theme</span>
              </button>
            </div>
          )}
        </div>
      </nav>
    </main>
  );
}
