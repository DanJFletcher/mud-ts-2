import { ClerkProvider } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { lazy, Suspense, useEffect } from 'react';
import { Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { AccountShell } from './lobby/AccountShell.js';
import { HomePage } from './lobby/HomePage.js';
import { LobbyPage } from './lobby/LobbyPage.js';
import { LobbyBreadcrumbs } from './lobby/LobbyBreadcrumbs.js';
import { appHref, basePath, playPath } from './lobby/navigation.js';
import './account.css';

const WorldPlayPage = lazy(() => import('./lobby/WorldPlayPage.js').then(({ WorldPlayPage }) => ({ default: WorldPlayPage })));
const CharacterDetailPage = lazy(() => import('./lobby/CharacterDetailPage.js').then(({ CharacterDetailPage }) => ({ default: CharacterDetailPage })));
const CodexScreen = lazy(() => import('./codex/CodexScreen.js'));
const AuthPage = lazy(() => import('./lobby/AuthPages.js').then(({ AuthPage }) => ({ default: AuthPage })));

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

function LegacyWorldPage() {
  const id = localStorage.getItem('mudd-world-instance-id');
  return <Redirect to={id ? playPath(id) : '/'} replace />;
}
function RouteLoading({ label }: { label: string }) {
  return <AccountShell><p role="status">{label}</p></AccountShell>;
}
function ScrollToTopOnNavigation() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector<HTMLElement>('.account-client')?.scrollTo(0, 0);
  }, [location]);
  return null;
}
function ClerkAppRoutes() {
  const [, setLocation] = useLocation();
  const stripBase = (path: string) => basePath && path.startsWith(`${basePath}/`) ? path.slice(basePath.length) : path;
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance}
    signInUrl={appHref('/sign-in')} signUpUrl={appHref('/sign-up')}
    routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}>
    <Switch>
      <Route path="/"><AccountShell><HomePage /></AccountShell></Route>
      <Route path="/worlds"><LobbyPage /></Route>
      <Route path="/lobby"><LobbyPage /></Route>
      <Route path="/worlds/:worldId/play">{(params) => <Suspense fallback={<RouteLoading label="Loading world…" />}>
        <WorldPlayPage key={params.worldId} worldId={params.worldId} />
      </Suspense>}</Route>
      <Route path="/worlds/:worldId/characters/:characterId">{(params) => <Suspense fallback={<RouteLoading label="Loading character…" />}>
        <CharacterDetailPage key={`${params.worldId}:${params.characterId}`} worldId={params.worldId} characterId={params.characterId} />
      </Suspense>}</Route>
      <Route path="/worlds/:worldId/characters">{(params) =>
        <LobbyPage key={`${params.worldId}:characters`} worldId={params.worldId} showWorldCharacters />}</Route>
      <Route path="/worlds/:worldId">{(params) => <LobbyPage key={params.worldId} worldId={params.worldId} />}</Route>
      <Route path="/character/:characterId">{(params) => <Suspense fallback={<RouteLoading label="Loading character…" />}>
        <CharacterDetailPage key={params.characterId} characterId={params.characterId} />
      </Suspense>}</Route>
      <Route path="/characters"><LobbyPage showAllCharacters /></Route>
      <Route path="/sign-in/*?"><Suspense fallback={<RouteLoading label="Loading sign in…" />}>
        <AuthPage kind="sign-in" />
      </Suspense></Route>
      <Route path="/sign-up/*?"><Suspense fallback={<RouteLoading label="Loading sign up…" />}>
        <AuthPage kind="sign-up" />
      </Suspense></Route>
      <Route path="/guest-world"><Redirect to="/" replace /></Route>
      <Route path="/world" component={LegacyWorldPage} />
      <Route path="/codex"><Suspense fallback={<RouteLoading label="Loading the Codex…" />}>
        <AccountShell><CodexScreen /></AccountShell>
      </Suspense></Route>
      <Route><AccountShell><LobbyBreadcrumbs items={[{ label: 'Worlds', href: '/worlds' }, { label: 'Page not found' }]} /><h1>Page not found</h1></AccountShell></Route>
    </Switch>
  </ClerkProvider>;
}
export default function AccountApp() {
  return <WouterRouter base={basePath}><ScrollToTopOnNavigation /><ClerkAppRoutes /></WouterRouter>;
}
