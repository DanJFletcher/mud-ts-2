import { useEffect, useState, type ReactNode } from 'react';
import { useClerk, useUser } from '@clerk/react';
import { Menu, Moon, Sun, X } from 'lucide-react';
import { Button } from '@mudd/ui';
import { appHref, rememberEntryIntent } from './navigation.js';
import { PwaInstallAction } from './PwaInstallAction.js';
import './lobby.css';

export function AccountShell({ children }: { children: ReactNode }) {
  const { isSignedIn } = useUser();
  const { signOut } = useClerk();
  const [theme, setTheme] = useState(() => localStorage.getItem('mudd-theme') === 'dark' ? 'dark' : 'light');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme = theme; localStorage.setItem('mudd-theme', theme);
  }, [theme]);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileMenuOpen]);
  function rememberCurrent() {
    rememberEntryIntent(window.location.pathname.replace(import.meta.env.BASE_URL.replace(/\/$/, ''), '') + window.location.search);
  }
  function closeMobileMenu() {
    setMobileMenuOpen(false);
  }
  return <div className="mudd-client lobby-shell" data-theme={theme}>
    <header className="lobby-header">
      <a className="lobby-brand" href={appHref('/')} aria-label="MUDD worlds"><img src={appHref('/logo.svg')} alt="" />MUDD</a>
      <div className="lobby-mobile-primary-nav" role="navigation" aria-label="Primary navigation">
        <a href={appHref('/')} onClick={closeMobileMenu}>Worlds</a>
        <a href={appHref('/characters')} onClick={closeMobileMenu}>Characters</a>
        {isSignedIn
          ? <Button className="lobby-mobile-auth" variant="quiet" onClick={() => { closeMobileMenu(); void signOut({ redirectUrl: appHref('/') }); }}>Sign out</Button>
          : <a className="lobby-mobile-auth" href={appHref('/sign-in')} onClick={() => { closeMobileMenu(); rememberCurrent(); }}>Sign in</a>}
      </div>
      <button
        type="button"
        className="lobby-mobile-menu-toggle"
        aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={mobileMenuOpen}
        aria-controls="account-navigation"
        onClick={() => setMobileMenuOpen((open) => !open)}
      >
        {mobileMenuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
      </button>
      <nav id="account-navigation" className={mobileMenuOpen ? 'is-open' : undefined} aria-label="Account navigation">
        <a className="lobby-desktop-nav-item" href={appHref('/')} onClick={closeMobileMenu}>Worlds</a>
        <a className="lobby-desktop-nav-item" href={appHref('/characters')} onClick={closeMobileMenu}>Characters</a>
        <a href={appHref('/codex')} onClick={closeMobileMenu}>Codex</a>
        <PwaInstallAction className="pwa-install-action__nav-button" />
        {isSignedIn ? <Button className="lobby-desktop-nav-item" variant="quiet" onClick={() => { closeMobileMenu(); void signOut({ redirectUrl: appHref('/') }); }}>Sign out</Button>
          : <a className="lobby-desktop-nav-item" href={appHref('/sign-in')} onClick={() => { closeMobileMenu(); rememberCurrent(); }}>Sign in</a>}
        <Button variant="quiet" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); closeMobileMenu(); }}>
          {theme === 'dark' ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
          <span className="lobby-theme-label">{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>
        </Button>
      </nav>
    </header>
    <main className="lobby-content">{children}</main>
  </div>;
}
