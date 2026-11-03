import { describe, expect, it } from 'vitest';
import { readServerConfiguration } from './server-config.js';

describe('readServerConfiguration', () => {
  it('uses development proxy and preview-origin defaults', () => {
    const configuration = readServerConfiguration({
      NODE_ENV: 'development',
      REPLIT_DEV_DOMAIN: 'mud-d.example',
    });

    expect(configuration.trustedProxyHops).toBe(0);
    expect(configuration.allowedOrigins).toEqual(new Set([
      'https://mud-d.example',
      'https://mud-d.example:5000',
    ]));
    expect(configuration.trustedHosts.size).toBe(0);
  });

  it('uses production defaults and configured host and origin allowlists', () => {
    const configuration = readServerConfiguration({
      NODE_ENV: 'production',
      TRUSTED_HOSTS: 'mud-d.example',
      REPLIT_DOMAINS: 'mud-d.example',
      CORS_ALLOWED_ORIGINS: 'https://mud-d.example',
    });

    expect(configuration.trustedProxyHops).toBe(1);
    expect(configuration.allowedOrigins).toEqual(new Set(['https://mud-d.example']));
    expect(configuration.trustedHosts).toEqual(new Set(['mud-d.example']));
  });

  it.each(['not-a-number', '1.5', '-1'])(
    'rejects an invalid trusted proxy hop count: %s',
    (value) => {
      expect(() => readServerConfiguration({ TRUSTED_PROXY_HOPS: value }))
        .toThrow('TRUSTED_PROXY_HOPS must be a non-negative integer.');
    },
  );

  it('refuses production startup without any trusted host', () => {
    expect(() => readServerConfiguration({
      NODE_ENV: 'production',
      TRUSTED_HOSTS: '',
      REPLIT_DOMAINS: '',
    })).toThrow('TRUSTED_HOSTS must be configured before starting the production server.');
  });
});
