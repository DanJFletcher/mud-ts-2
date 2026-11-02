import type { ReactNode } from 'react';

export function ClerkProvider({ children }: { children: ReactNode }) {
  return children;
}

export function useUser() {
  return { isLoaded: true, isSignedIn: false, user: null };
}

export function useClerk() {
  return { signOut: async () => undefined };
}

export function SignIn() {
  return <p>Sign-in is unavailable in the E2E guest adapter.</p>;
}

export function SignUp() {
  return <p>Account creation is unavailable in the E2E guest adapter.</p>;
}
