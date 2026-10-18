import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler } from 'express';

function normalizedOrigins(value: string | undefined): Set<string> {
  const origins = new Set<string>();
  for (const candidate of value?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? []) {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error(`Invalid origin in CORS_ALLOWED_ORIGINS: ${candidate}`);
    }
    if (parsed.origin !== candidate || !['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`CORS_ALLOWED_ORIGINS entries must be bare HTTP(S) origins: ${candidate}`);
    }
    origins.add(parsed.origin);
  }
  return origins;
}

export function parseAllowedOrigins(value: string | undefined, replitDevDomain?: string): ReadonlySet<string> {
  const origins = normalizedOrigins(value);
  const devDomain = replitDevDomain?.trim();
  if (devDomain) {
    let parsed: URL;
    try {
      parsed = new URL(`https://${devDomain}`);
    } catch {
      throw new Error('REPLIT_DEV_DOMAIN must be a hostname.');
    }
    if (parsed.host !== devDomain || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('REPLIT_DEV_DOMAIN must be a hostname without a scheme, path, or port.');
    }
    origins.add(parsed.origin);
  }
  return origins;
}

export function originIsAllowed(
  origin: string | undefined,
  request: Pick<Request, 'protocol' | 'get'>,
  configuredOrigins: ReadonlySet<string>,
): boolean {
  if (!origin) return true;
  if (origin === 'null') return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin !== origin) return false;
  return configuredOrigins.has(origin) || origin === `${request.protocol}://${request.get('host')}`;
}

export function createOriginGuard(configuredOrigins: ReadonlySet<string>): RequestHandler {
  return (request, response, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
    const origin = request.get('origin');
    const fetchSite = request.get('sec-fetch-site');
    if (fetchSite === 'cross-site' || !originIsAllowed(origin, request, configuredOrigins)) {
      return response.status(403).json({ message: 'This request origin is not allowed.' });
    }
    return next();
  };
}

export function createRequestId(): RequestHandler {
  return (_request, response, next) => {
    const requestId = randomUUID();
    response.locals.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    next();
  };
}

export function createRateLimiter(options: Readonly<{
  windowMs: number;
  maxRequests: number;
  now?: () => number;
  key?: (request: Request) => string;
}>): RequestHandler {
  if (!Number.isInteger(options.windowMs) || options.windowMs < 1 ||
    !Number.isInteger(options.maxRequests) || options.maxRequests < 1) {
    throw new Error('Rate limit window and request maximum must be positive integers.');
  }

  const now = options.now ?? Date.now;
  const keyFor = options.key ?? ((request: Request) => request.ip || request.socket.remoteAddress || 'unknown');
  const buckets = new Map<string, { startedAt: number; count: number }>();
  let lastCleanupAt = 0;

  return (request, response, next) => {
    const time = now();
    if (time - lastCleanupAt > options.windowMs) {
      for (const [key, bucket] of buckets) {
        if (time - bucket.startedAt >= options.windowMs) buckets.delete(key);
      }
      lastCleanupAt = time;
    }
    const key = keyFor(request);
    let bucket = buckets.get(key);
    if (!bucket || time - bucket.startedAt >= options.windowMs) {
      bucket = { startedAt: time, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    response.setHeader('RateLimit-Limit', String(options.maxRequests));
    response.setHeader('RateLimit-Remaining', String(Math.max(0, options.maxRequests - bucket.count)));
    if (bucket.count > options.maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((bucket.startedAt + options.windowMs - time) / 1000));
      response.setHeader('Retry-After', String(retryAfter));
      return response.status(429).json({ message: 'Too many requests. Try again shortly.' });
    }
    return next();
  };
}

export function parseTrustedHosts(value: string | undefined): ReadonlySet<string> {
  return new Set(value?.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean) ?? []);
}

export function createTrustedHostGuard(trustedHosts: ReadonlySet<string>): RequestHandler {
  return (request, response, next) => {
    if (trustedHosts.size === 0) return next();
    const host = request.get('host')?.toLowerCase();
    const forwardedHost = request.get('x-forwarded-host')?.split(',')[0]?.trim().toLowerCase();
    if (!host || !trustedHosts.has(host) || (forwardedHost && !trustedHosts.has(forwardedHost))) {
      return response.status(421).json({ message: 'This host is not configured for the game server.' });
    }
    return next();
  };
}
