import { useEffect, useState, type ReactNode } from 'react';
import { useClerk, useUser } from '@clerk/react';
import { Menu, Moon, Sun, X } from 'lucide-react';
import { Link } from 'wouter';
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
      <Link className="lobby-brand" href="/" aria-label="MUDD worlds"><img src={appHref('/logo.svg')} alt="" />MUDD</Link>
      <div className="lobby-mobile-primary-nav" role="navigation" aria-label="Primary navigation">
        <Link href="/" onClickCapture={closeMobileMenu}>Worlds</Link>
        <Link href="/characters" onClickCapture={closeMobileMenu}>Characters</Link>
        {isSignedIn
          ? <Button className="lobby-mobile-auth" variant="quiet" onClick={() => { closeMobileMenu(); void signOut({ redirectUrl: appHref('/') }); }}>Sign out</Button>
          : <Link className="lobby-mobile-auth" href="/sign-in" onClickCapture={() => { closeMobileMenu(); rememberCurrent(); }}>Sign in</Link>}
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
        <Link className="lobby-desktop-nav-item" href="/" onClickCapture={closeMobileMenu}>Worlds</Link>
        <Link className="lobby-desktop-nav-item" href="/characters" onClickCapture={closeMobileMenu}>Characters</Link>
        <Link href="/codex" onClickCapture={closeMobileMenu}>Codex</Link>
        <PwaInstallAction className="pwa-install-action__nav-button" />
        {isSignedIn ? <Button className="lobby-desktop-nav-item" variant="quiet" onClick={() => { closeMobileMenu(); void signOut({ redirectUrl: appHref('/') }); }}>Sign out</Button>
          : <Link className="lobby-desktop-nav-item" href="/sign-in" onClickCapture={() => { closeMobileMenu(); rememberCurrent(); }}>Sign in</Link>}
        <Button variant="quiet" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); closeMobileMenu(); }}>
          {theme === 'dark' ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
          <span className="lobby-theme-label">{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>
        </Button>
      </nav>
    </header>
    <main className="lobby-content">{children}</main>
  </div>;
}
