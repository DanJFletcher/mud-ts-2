import { createRateLimiter } from '../app/request-security.js';
import { type ServerDependencies } from '../app/dependencies.js';

export function registerGuestRoutes(app: import('express').Express, dependencies: Pick<
  ServerDependencies,
  | 'createGuestIdentity'
  | 'requestAuth'
>) {
  const { createGuestIdentity, requestAuth } = dependencies;
  app.post('/api/guest-session', createRateLimiter({ windowMs: 60_000, maxRequests: 10 }), async (req, res, next) => {
    try {
      if (requestAuth(req).userId) {
        return res.status(409).json({ message: 'Sign out before starting a guest session.' });
      }
      const { identity, setCookie } = await createGuestIdentity(req);
      if (setCookie) res.setHeader('Set-Cookie', setCookie);
      return res.json({ player: { id: identity.playerId, displayName: identity.displayName } });
    } catch (error) {
      next(error);
    }
  });
}
