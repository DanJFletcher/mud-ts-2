import express, { type Request, type Response } from 'express';
import { installProductionWebServing } from './web-serving.js';

export function installHttpFallbacks(app: import('express').Express, moduleUrl: string) {
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  installProductionWebServing(app, express.static, process.env.NODE_ENV === 'production', moduleUrl);
  app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    const requestId = String(res.locals.requestId ?? 'unknown');
    console.error(`[${requestId}] Request failed`, error);
    const status = error && typeof error === 'object' && 'status' in error &&
      typeof error.status === 'number' && error.status >= 400 && error.status <= 599
      ? error.status
      : 500;
    res.status(status).json({
      message: status === 413
        ? 'The request body is too large.'
        : 'The game server could not complete that request.',
      requestId,
    });
  });
}
