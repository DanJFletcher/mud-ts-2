import { SignIn, SignUp } from '@clerk/react';
import { AccountShell } from './AccountShell.js';
import { appHref, entryIntent } from './navigation.js';

export function AuthPage({ kind }: { kind: 'sign-in' | 'sign-up' }) {
  return <AccountShell>
    <div className="auth-content">
      {kind === 'sign-in'
        ? <SignIn routing="path" path={appHref('/sign-in')} signUpUrl={appHref('/sign-up')} forceRedirectUrl={appHref(entryIntent())} />
        : <SignUp routing="path" path={appHref('/sign-up')} signInUrl={appHref('/sign-in')} forceRedirectUrl={appHref(entryIntent())} />}
    </div>
  </AccountShell>;
}
