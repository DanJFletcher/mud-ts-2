import { useState } from "react";
import { Compass, Menu, Moon, NotebookText, Sun, UserRound, Users, X } from "lucide-react";
import "./_group.css";

export function Current() {
  const [menuOpen, setMenuOpen] = useState(true);
  const [darkTheme, setDarkTheme] = useState(true);

  return (
    <main className="mudd-nav-preview">
      <section className="mudd-nav-preview__content" aria-label="Play screen">
        <article className="mudd-nav-preview__room">
          <h1>Glasswater Bridge</h1>
          <p>The bridge crosses the river between the clearing and the reedbank road. The stream moves beneath the stone arches.</p>
        </article>
      </section>
      <nav className="mudd-nav-preview__tabs" aria-label="Game screens">
        <button className="mudd-nav-preview__tab mudd-nav-preview__tab--active" type="button"><Compass aria-hidden="true" /><span>Play</span></button>
        <button className="mudd-nav-preview__tab" type="button"><UserRound aria-hidden="true" /><span>Traveler</span></button>
        <button className="mudd-nav-preview__tab" type="button"><NotebookText aria-hidden="true" /><span>Field notes</span></button>
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
