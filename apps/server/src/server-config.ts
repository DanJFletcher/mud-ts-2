import { parseAllowedOrigins, parseTrustedHosts } from './request-security.js';

export type ServerEnvironment = Readonly<Record<string, string | undefined>>;

export function readServerConfiguration(environment: ServerEnvironment) {
  const trustedProxyHops = Number(
    environment.TRUSTED_PROXY_HOPS ?? (environment.NODE_ENV === 'production' ? '1' : '0'),
  );
  if (!Number.isInteger(trustedProxyHops) || trustedProxyHops < 0) {
    throw new Error('TRUSTED_PROXY_HOPS must be a non-negative integer.');
  }

  const allowedOrigins = parseAllowedOrigins(
    environment.CORS_ALLOWED_ORIGINS,
    environment.NODE_ENV === 'production'
      ? undefined
      : [environment.REPLIT_DEV_DOMAIN, environment.REPLIT_DOMAINS].filter(Boolean).join(','),
  );
  const trustedHosts = parseTrustedHosts([
    environment.TRUSTED_HOSTS,
    environment.NODE_ENV === 'production' ? environment.REPLIT_DOMAINS : undefined,
  ].filter(Boolean).join(','));
  if (environment.NODE_ENV === 'production' && trustedHosts.size === 0) {
    throw new Error('TRUSTED_HOSTS must be configured before starting the production server.');
  }

  return { trustedProxyHops, allowedOrigins, trustedHosts };
}
