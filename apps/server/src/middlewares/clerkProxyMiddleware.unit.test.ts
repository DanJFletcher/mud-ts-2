import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const proxyState = vi.hoisted(() => ({ config: null as unknown }));

vi.mock('http-proxy-middleware', () => ({
  createProxyMiddleware: (config: unknown) => {
    proxyState.config = config;
    return (_request: unknown, _response: unknown, next: () => void) => next();
  },
}));

const originalNodeEnv = process.env.NODE_ENV;
const originalClerkSecretKey = process.env.CLERK_SECRET_KEY;

type HeaderValue = string | string[] | undefined;
type ProxyRequest = {
  headers: Record<string, HeaderValue>;
  socket?: { remoteAddress?: string };
  method?: string;
};
type ProxyResponse = EventEmitter & {
  headers: Record<string, HeaderValue>;
  statusCode?: number;
  pipe: (response: unknown) => void;
};
type ClientResponse = {
  headersSent: boolean;
  writeHead: (status: number, headers: Record<string, HeaderValue>) => unknown;
  end: (body?: Buffer) => unknown;
  destroy: () => unknown;
};
type ProxyOptions = {
  target: string;
  changeOrigin: boolean;
  selfHandleResponse: boolean;
  pathRewrite: (path: string) => string;
  on: {
    proxyReq: (
      proxyRequest: { setHeader: (name: string, value: string) => void },
      request: ProxyRequest,
    ) => void;
    proxyRes: (
      upstream: ProxyResponse,
      request: ProxyRequest,
      response: ClientResponse,
    ) => void;
  };
};

async function loadMiddleware(environment: 'development' | 'production', secretKey?: string) {
  process.env.NODE_ENV = environment;
  if (secretKey) process.env.CLERK_SECRET_KEY = secretKey;
  else delete process.env.CLERK_SECRET_KEY;
  vi.resetModules();
  return import('./clerkProxyMiddleware.js');
}

async function createProductionProxy() {
  const middleware = await loadMiddleware('production', 'test-secret');
  middleware.clerkProxyMiddleware();
  return proxyState.config as ProxyOptions;
}

function createUpstream(
  headers: Record<string, HeaderValue>,
  statusCode?: number,
): ProxyResponse {
  return Object.assign(new EventEmitter(), {
    headers,
    statusCode,
    pipe: vi.fn(),
  }) as ProxyResponse;
}

function createClientResponse(headersSent = false): ClientResponse {
  return {
    headersSent,
    writeHead: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
  };
}

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalClerkSecretKey === undefined) delete process.env.CLERK_SECRET_KEY;
  else process.env.CLERK_SECRET_KEY = originalClerkSecretKey;
  proxyState.config = null;
  vi.resetModules();
});

describe('Clerk proxy middleware', () => {
  it('chooses the first forwarded host and falls back to the request host', async () => {
    const { getClerkProxyHost } = await loadMiddleware('development');

    expect(getClerkProxyHost({
      headers: {
        'x-forwarded-host': 'public.example, proxy.internal',
        host: 'internal.example',
      },
    })).toBe('public.example');
    expect(getClerkProxyHost({
      headers: { 'x-forwarded-host': ['first.example', 'second.example'] },
    })).toBe('first.example');
    expect(getClerkProxyHost({
      headers: { 'x-forwarded-host': '   ', host: '  request.example  ' },
    })).toBe('request.example');
    expect(getClerkProxyHost({ headers: {} })).toBeUndefined();
  });

  it('passes requests through outside production or without a Clerk secret', async () => {
    for (const environment of [
      { nodeEnv: 'development' as const, secretKey: 'test-secret' },
      { nodeEnv: 'production' as const, secretKey: undefined },
    ]) {
      const { clerkProxyMiddleware } = await loadMiddleware(environment.nodeEnv, environment.secretKey);
      const next = vi.fn();
      clerkProxyMiddleware()({} as Request, {} as Response, next as NextFunction);
      expect(next).toHaveBeenCalledOnce();
      expect(proxyState.config).toBeNull();
    }
  });

  it('configures the production proxy and forwards the canonical host and client IP', async () => {
    const options = await createProductionProxy();
    expect(options.target).toBe('https://frontend-api.clerk.dev');
    expect(options.changeOrigin).toBe(true);
    expect(options.selfHandleResponse).toBe(true);
    expect(options.pathRewrite('/api/__clerk/v1/client')).toBe('/v1/client');
    expect(options.pathRewrite('/unrelated/path')).toBe('/unrelated/path');

    const headers = new Map<string, string>();
    options.on.proxyReq({ setHeader: (name, value) => headers.set(name, value) }, {
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'login.example, proxy.internal',
        'x-forwarded-for': '203.0.113.8, 10.0.0.1',
      },
      socket: { remoteAddress: '127.0.0.0' },
    });
    expect(headers.get('Clerk-Proxy-Url')).toBe('https://login.example/api/__clerk');
    expect(headers.get('Clerk-Secret-Key')).toBe('test-secret');
    expect(headers.get('X-Forwarded-For')).toBe('203.0.113.8');

    const fallbackHeaders = new Map<string, string>();
    options.on.proxyReq({ setHeader: (name, value) => fallbackHeaders.set(name, value) }, {
      headers: { host: 'app.example' },
      socket: { remoteAddress: '127.0.0.2' },
    });
    expect(fallbackHeaders.get('Clerk-Proxy-Url')).toBe('https://app.example/api/__clerk');
    expect(fallbackHeaders.get('X-Forwarded-For')).toBe('127.0.0.2');

    const noClientIpHeaders = new Map<string, string>();
    options.on.proxyReq({ setHeader: (name, value) => noClientIpHeaders.set(name, value) }, {
      headers: { host: 'app.example' },
    });
    expect(noClientIpHeaders.has('X-Forwarded-For')).toBe(false);
  });

  it('streams responses with a known length and destroys the client on stream errors', async () => {
    const options = await createProductionProxy();
    const upstream = createUpstream({
      'content-length': '4',
      'content-encoding': 'gzip',
      'transfer-encoding': 'chunked',
      connection: 'keep-alive',
      'keep-alive': 'timeout=5',
    }, 200);
    const client = createClientResponse();

    options.on.proxyRes(upstream, { method: 'GET', headers: {} }, client);

    expect(client.writeHead).toHaveBeenCalledWith(200, {
      'content-length': '4',
      'content-encoding': 'gzip',
    });
    expect(upstream.pipe).toHaveBeenCalledWith(client);
    upstream.emit('error', new Error('upstream reset'));
    expect(client.destroy).toHaveBeenCalledOnce();
  });

  it.each([
    { method: 'HEAD', statusCode: 200, contentLength: '8', expectedLength: '8' },
    { method: 'GET', statusCode: 101, contentLength: '8', expectedLength: undefined },
    { method: 'GET', statusCode: 204, contentLength: '8', expectedLength: undefined },
    { method: 'GET', statusCode: 304, contentLength: '8', expectedLength: '8' },
  ])('streams bodyless $method/$statusCode responses with the correct length header', async ({
    method,
    statusCode,
    contentLength,
    expectedLength,
  }) => {
    const options = await createProductionProxy();
    const upstream = createUpstream({ 'content-length': contentLength }, statusCode);
    const client = createClientResponse();

    options.on.proxyRes(upstream, { method, headers: {} }, client);

    expect(client.writeHead).toHaveBeenCalledWith(statusCode, {
      ...(expectedLength ? { 'content-length': expectedLength } : {}),
    });
    expect(upstream.pipe).toHaveBeenCalledWith(client);
  });

  it('buffers unknown-length responses and sets a content length', async () => {
    const options = await createProductionProxy();
    const upstream = createUpstream({ 'content-encoding': 'gzip' }, 201);
    const client = createClientResponse();
    options.on.proxyRes(upstream, { method: 'GET', headers: {} }, client);

    upstream.emit('data', Buffer.from('hello'));
    upstream.emit('data', Buffer.from(' world'));
    upstream.emit('end');

    expect(client.writeHead).toHaveBeenCalledWith(201, {
      'content-encoding': 'gzip',
      'content-length': '11',
    });
    expect(client.end).toHaveBeenCalledWith(Buffer.from('hello world'));
  });

  it('uses the fallback status and safely ends buffered responses on upstream errors', async () => {
    const options = await createProductionProxy();
    const upstream = createUpstream({});
    const client = createClientResponse();
    options.on.proxyRes(upstream, { method: 'GET', headers: {} }, client);
    upstream.emit('end');

    expect(client.writeHead).toHaveBeenCalledWith(502, { 'content-length': '0' });
    expect(client.end).toHaveBeenCalledWith(Buffer.alloc(0));

    const failedBeforeHeaders = createClientResponse(false);
    const failingUpstream = createUpstream({}, 200);
    options.on.proxyRes(failingUpstream, { method: 'GET', headers: {} }, failedBeforeHeaders);
    failingUpstream.emit('error', new Error('connection closed'));
    expect(failedBeforeHeaders.writeHead).toHaveBeenCalledWith(502, { 'content-length': '0' });
    expect(failedBeforeHeaders.end).toHaveBeenCalledOnce();

    const failedAfterHeaders = createClientResponse(true);
    const failingAfterHeaders = createUpstream({}, 200);
    options.on.proxyRes(failingAfterHeaders, { method: 'GET', headers: {} }, failedAfterHeaders);
    failingAfterHeaders.emit('error', new Error('connection closed'));
    expect(failedAfterHeaders.writeHead).not.toHaveBeenCalled();
    expect(failedAfterHeaders.end).toHaveBeenCalledOnce();
  });
});
