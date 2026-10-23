import { useEffect, useState, type ReactNode } from 'react';
import { useClerk, useUser } from '@clerk/react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@mudd/ui';
import { appHref, rememberEntryIntent } from './navigation.js';
import { PwaInstallAction } from './PwaInstallAction.js';
import './lobby.css';

export function AccountShell({ children }: { children: ReactNode }) {
  const { isSignedIn } = useUser();
  const { signOut } = useClerk();
  const [theme, setTheme] = useState(() => localStorage.getItem('mudd-theme') === 'dark' ? 'dark' : 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme; localStorage.setItem('mudd-theme', theme);
  }, [theme]);
  function rememberCurrent() {
    rememberEntryIntent(window.location.pathname.replace(import.meta.env.BASE_URL.replace(/\/$/, ''), '') + window.location.search);
  }
  return <div className="mudd-client lobby-shell" data-theme={theme}>
    <header className="lobby-header">
      <a className="lobby-brand" href={appHref('/')} aria-label="MUDD worlds"><img src={appHref('/logo.svg')} alt="" />MUDD</a>
      <nav aria-label="Account navigation">
        <a href={appHref('/')}>Worlds</a><a href={appHref('/codex')}>Codex</a>
        <PwaInstallAction className="pwa-install-action__nav-button" />
        {isSignedIn ? <Button variant="quiet" onClick={() => { void signOut({ redirectUrl: appHref('/') }); }}>Sign out</Button>
          : <a href={appHref('/sign-in')} onClick={rememberCurrent}>Sign in</a>}
        <Button variant="quiet" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
        </Button>
      </nav>
    </header>
    <main className="lobby-content">{children}</main>
  </div>;
}
