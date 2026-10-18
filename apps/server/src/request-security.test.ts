import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  createOriginGuard,
  createRateLimiter,
  createTrustedHostGuard,
  originIsAllowed,
  parseAllowedOrigins,
  parseTrustedHosts,
} from './request-security.js';

function makeRequest(headers: Record<string, string> = {}, ip = '192.0.2.1') {
  return {
    method: 'POST',
    protocol: 'https',
    ip,
    socket: { remoteAddress: ip },
    get(name: string) { return headers[name.toLowerCase()]; },
  } as unknown as Request;
}

function makeResponse() {
  const headers = new Map<string, string>();
  const response = {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    json: vi.fn((body: unknown) => body),
    setHeader(name: string, value: string) { headers.set(name, value); return this; },
  };
  return { response: response as unknown as Response, headers, state: response };
}

describe('request security policy', () => {
  it('allows same-origin and explicitly configured browser origins only', () => {
    const origins = parseAllowedOrigins('https://play.example.test');
    const request = makeRequest({ host: 'game.example.test' });
    expect(originIsAllowed('https://game.example.test', request, origins)).toBe(true);
    expect(originIsAllowed('https://play.example.test', request, origins)).toBe(true);
    expect(originIsAllowed('https://attacker.example', request, origins)).toBe(false);
    expect(originIsAllowed('null', request, origins)).toBe(false);
    expect(() => parseAllowedOrigins('https://example.test/path')).toThrow(/bare HTTP\(S\) origins/i);
  });

  it('includes the exact Replit development origin without widening the allowlist', () => {
    const origins = parseAllowedOrigins('https://play.example.test', 'mudd-demo.replit.dev,preview.replit.dev');
    const proxiedRequest = makeRequest({ host: '127.0.0.1:5001' });
    expect(originIsAllowed('https://mudd-demo.replit.dev', proxiedRequest, origins)).toBe(true);
    expect(originIsAllowed('https://mudd-demo.replit.dev:5000', proxiedRequest, origins)).toBe(true);
    expect(originIsAllowed('https://mudd-demo.replit.dev:5001', proxiedRequest, origins)).toBe(false);
    expect(originIsAllowed('https://other.replit.dev', proxiedRequest, origins)).toBe(false);
    expect(() => parseAllowedOrigins(undefined, 'mudd-demo.replit.dev/path')).toThrow(/hostname/i);
  });

  it('blocks cross-site and untrusted-origin state-changing requests', () => {
    const middleware = createOriginGuard(new Set(['https://game.example.test']));
    const denied = makeResponse();
    middleware(
      makeRequest({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }),
      denied.response,
      vi.fn(),
    );
    expect(denied.state.statusCode).toBe(403);
    expect(denied.response.json).toHaveBeenCalledWith({ message: 'This request origin is not allowed.' });

    const previewNext = vi.fn();
    middleware(
      makeRequest({ origin: 'https://game.example.test', 'sec-fetch-site': 'cross-site' }),
      makeResponse().response,
      previewNext,
    );
    expect(previewNext).toHaveBeenCalledOnce();

    const allowedNext = vi.fn();
    middleware(
      makeRequest({ origin: 'https://game.example.test' }),
      makeResponse().response,
      allowedNext,
    );
    expect(allowedNext).toHaveBeenCalledOnce();
  });

  it('limits requests per client key and resets after the window', () => {
    let time = 1_000;
    const middleware = createRateLimiter({ maxRequests: 2, windowMs: 10_000, now: () => time });
    const request = makeRequest();
    const response = makeResponse();
    const next = vi.fn();

    middleware(request, response.response, next);
    middleware(request, response.response, next);
    middleware(request, response.response, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(response.state.statusCode).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('10');

    time += 10_001;
    middleware(request, response.response, next);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('parses host allowlists without accepting empty entries', () => {
    expect(parseTrustedHosts('game.example.test, play.example.test')).toEqual(
      new Set(['game.example.test', 'play.example.test']),
    );
  });

  it('rejects unconfigured host and forwarded-host values', () => {
    const middleware = createTrustedHostGuard(parseTrustedHosts('game.example.test'));
    const denied = makeResponse();
    const next = vi.fn();
    middleware(
      makeRequest({ host: 'game.example.test', 'x-forwarded-host': 'attacker.example' }),
      denied.response,
      next,
    );
    expect(denied.state.statusCode).toBe(421);
    expect(next).not.toHaveBeenCalled();

    const allowedNext = vi.fn();
    middleware(
      makeRequest({ host: 'game.example.test', 'x-forwarded-host': 'game.example.test' }),
      makeResponse().response,
      allowedNext,
    );
    expect(allowedNext).toHaveBeenCalledOnce();
  });
});
