import express, { type Application, type Request, type Response } from 'express';
import { fileURLToPath } from 'node:url';

export function installProductionWebServing(
  app: Pick<Application, 'use'>,
  staticMiddleware: typeof express.static,
  isProduction: boolean,
  moduleUrl: string,
): void {
  if (!isProduction) return;

  const webDistDirectory = fileURLToPath(new URL('../../web/dist/', moduleUrl));
  const webIndexFile = fileURLToPath(new URL('../../web/dist/index.html', moduleUrl));
  app.use(staticMiddleware(webDistDirectory));
  app.use((req: Request, res: Response, next: express.NextFunction) => {
    if (
      req.method !== 'GET' ||
      req.path === '/api' ||
      req.path.startsWith('/api/') ||
      !req.accepts('html')
    ) {
      return next();
    }
    return res.sendFile(webIndexFile, (error) => {
      if (error) next(error);
    });
  });
}
