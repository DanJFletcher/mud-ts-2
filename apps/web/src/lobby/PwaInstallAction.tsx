import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@mudd/ui';
import './pwa-install.css';

type InstallChoice = { outcome: 'accepted' | 'dismissed'; platform: string };
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
};

function isRunningInstalled() {
  return window.matchMedia?.('(display-mode: standalone)').matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function PwaInstallAction({ className }: { className?: string }) {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isRunningInstalled);
  const [showInstructions, setShowInstructions] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onAppInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setShowInstructions(false);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  if (installed) return null;

  async function installOrShowHelp() {
    if (!installPrompt) {
      setShowInstructions((visible) => !visible);
      return;
    }
    setInstalling(true);
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      if (choice.outcome === 'accepted') setInstalled(true);
      else setShowInstructions(true);
    } catch {
      setInstallPrompt(null);
      setShowInstructions(true);
    } finally {
      setInstalling(false);
    }
  }

  const isAppleMobile = /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  return (
    <div className="pwa-install-action">
      <Button
        type="button"
        variant="quiet"
        className={className}
        onClick={() => void installOrShowHelp()}
        aria-expanded={showInstructions}
        disabled={installing}
      >
        <Download size={18} aria-hidden="true" />
        <span>{installing ? 'Installing…' : 'Install MUDD'}</span>
      </Button>
      {showInstructions && (
        <p className="pwa-install-action__instructions" role="status">
          {isAppleMobile
            ? 'In Safari, tap Share, then Add to Home Screen.'
            : 'Choose Install app or Add to Home Screen in your browser menu.'}
        </p>
      )}
    </div>
  );
}
