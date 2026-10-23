import { ClerkProvider, SignIn, SignUp } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import CodexScreen from './codex/CodexScreen.js';
import { AccountShell } from './lobby/AccountShell.js';
import { LobbyPage } from './lobby/LobbyPage.js';
import { WorldPlayPage } from './lobby/WorldPlayPage.js';
import { appHref, basePath, entryIntent, playPath } from './lobby/navigation.js';
import './account.css';

const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL
  || (import.meta.env.PROD ? `${window.location.origin}${basePath}/api/__clerk` : undefined);
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in the environment.');

// Preserve the managed Clerk tenant, proxy configuration and MUDD auth branding.
const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: {
    colorPrimary: '#496c55', colorForeground: '#28352e', colorMutedForeground: '#707b70',
    colorDanger: '#a34f43', colorBackground: '#fbfaf4', colorInput: '#fffef9',
    colorInputForeground: '#28352e', colorNeutral: '#d6d9c9',
    fontFamily: '"DM Sans", system-ui, sans-serif', borderRadius: '12px',
  },
};

function SignInPage() {
  return <AccountShell><div className="auth-content"><SignIn routing="path" path={appHref('/sign-in')} signUpUrl={appHref('/sign-up')}
    forceRedirectUrl={appHref(entryIntent())} /></div></AccountShell>;
}
function SignUpPage() {
  return <AccountShell><div className="auth-content"><SignUp routing="path" path={appHref('/sign-up')} signInUrl={appHref('/sign-in')}
    forceRedirectUrl={appHref(entryIntent())} /></div></AccountShell>;
}
function LegacyWorldPage() {
  const id = localStorage.getItem('mudd-world-instance-id');
  return <Redirect to={id ? playPath(id) : '/'} replace />;
}
function ClerkAppRoutes() {
  const [, setLocation] = useLocation();
  const stripBase = (path: string) => basePath && path.startsWith(`${basePath}/`) ? path.slice(basePath.length) : path;
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance}
    signInUrl={appHref('/sign-in')} signUpUrl={appHref('/sign-up')}
    routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}>
    <Switch>
      <Route path="/"><LobbyPage /></Route>
      <Route path="/lobby"><LobbyPage /></Route>
      <Route path="/worlds/:worldId/play">{(params) => <WorldPlayPage key={params.worldId} worldId={params.worldId} />}</Route>
      <Route path="/worlds/:worldId">{(params) => <LobbyPage key={params.worldId} worldId={params.worldId} />}</Route>
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/characters"><Redirect to="/" replace /></Route>
      <Route path="/guest-world"><Redirect to="/" replace /></Route>
      <Route path="/world" component={LegacyWorldPage} />
      <Route path="/codex"><AccountShell><CodexScreen /></AccountShell></Route>
      <Route><AccountShell><h1>Page not found</h1><a href={appHref('/')}>Back to worlds</a></AccountShell></Route>
    </Switch>
  </ClerkProvider>;
}
export default function AccountApp() {
  return <WouterRouter base={basePath}><ClerkAppRoutes /></WouterRouter>;
}
