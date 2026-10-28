import type { Application, Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installProductionWebServing } from './web-serving.js';

describe('production web serving', () => {
  let app: Pick<Application, 'use'>;
  let staticMiddleware: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = { use: vi.fn() } as unknown as Pick<Application, 'use'>;
    staticMiddleware = vi.fn(() => vi.fn());
  });

  it('does not register static hosting outside production', () => {
    installProductionWebServing(
      app,
      staticMiddleware as never,
      false,
      'file:///workspace/apps/server/src/index.ts',
    );

    expect(app.use).not.toHaveBeenCalled();
    expect(staticMiddleware).not.toHaveBeenCalled();
  });

  it('registers web assets and a history fallback in production', () => {
    installProductionWebServing(
      app,
      staticMiddleware as never,
      true,
      'file:///workspace/apps/server/src/index.ts',
    );

    expect(staticMiddleware).toHaveBeenCalledWith(expect.stringMatching(/apps\/web\/dist\/?$/));
    expect(app.use).toHaveBeenCalledTimes(2);
    expect(app.use).toHaveBeenNthCalledWith(1, expect.any(Function));
    expect(app.use).toHaveBeenNthCalledWith(2, expect.any(Function));
  });

  it.each([
    ['POST', '/worlds/orraveth/play', 'html'],
    ['GET', '/api', 'html'],
    ['GET', '/api/queries', 'html'],
    ['GET', '/worlds/orraveth/play', false],
  ])('passes through %s %s requests that should not receive the app shell', (method, path, accepts) => {
    installProductionWebServing(
      app,
      staticMiddleware as never,
      true,
      'file:///workspace/apps/server/src/index.ts',
    );
    const fallback = vi.mocked(app.use).mock.calls[1]?.[0] as RequestHandler;
    const req = {
      method,
      path,
      accepts: vi.fn(() => accepts),
    } as unknown as Request;
    const sendFile = vi.fn();
    const res = { sendFile } as unknown as Response;
    const next = vi.fn();

    fallback(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(sendFile).not.toHaveBeenCalled();
  });

  it('serves the app shell for an HTML page request and forwards file errors', () => {
    installProductionWebServing(
      app,
      staticMiddleware as never,
      true,
      'file:///workspace/apps/server/src/index.ts',
    );
    const fallback = vi.mocked(app.use).mock.calls[1]?.[0] as RequestHandler;
    const req = {
      method: 'GET',
      path: '/worlds/orraveth/play',
      accepts: vi.fn(() => 'html'),
    } as unknown as Request;
    let completeSendFile: ((error?: Error) => void) | undefined;
    const res = {
      sendFile: vi.fn((_path: string, callback?: (error?: Error) => void) => {
        completeSendFile = callback;
      }),
    } as unknown as Response;
    const next = vi.fn();

    fallback(req, res, next);
    expect(res.sendFile).toHaveBeenCalledWith(
      expect.stringMatching(/apps\/web\/dist\/index\.html$/),
      expect.any(Function),
    );
    completeSendFile?.();
    expect(next).not.toHaveBeenCalled();

    const sendError = new Error('static index unavailable');
    completeSendFile?.(sendError);
    expect(next).toHaveBeenCalledWith(sendError);
  });
});
