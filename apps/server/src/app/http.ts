import express, { type Request } from 'express';
import expressWs from 'express-ws';
import { requestMeasurements, newMeasurements, formatDatabaseOperationTimings, eventLoopDelayMs } from './performance.js';
import cors from 'cors';
import { clerkMiddleware } from '@clerk/express';
import { publishableKeyFromHost } from '@clerk/shared/keys';
import { DEMO_WORLD_INSTANCE_ID } from '@mudd/world-demo';
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from './middleware/clerk-proxy-middleware.js';
import { createOriginGuard, createRequestId, createTrustedHostGuard } from './request-security.js';
import { type ServerDependencies } from './dependencies.js';

export function createHttp(dependencies: Pick<
  ServerDependencies,
  | 'pool'
  | 'worldRuntimes'
  | 'e2eAuthEnabled'
  | 'trustedProxyHops'
  | 'allowedOrigins'
  | 'trustedHosts'
>) {
  const { pool, worldRuntimes, e2eAuthEnabled, trustedProxyHops, allowedOrigins, trustedHosts } = dependencies;
  const app = express();
  const websocketApp = expressWs(app, undefined, { wsOptions: { maxPayload: 1024 } }).app;
  app.set('trust proxy', trustedProxyHops);
  app.use(createRequestId());
  app.use((req, res, next) => {
    const requestedTraceId = req.get('x-mudd-trace-id') ?? '';
    const tracePhase = req.get('x-mudd-trace-phase');
    const traceableRoute =
      (req.method === 'POST' && req.path === '/api/commands' && tracePhase === 'command') ||
      (req.method === 'GET' && req.path === '/api/game' && tracePhase === 'snapshot') ||
      (req.method === 'GET' && req.path === '/api/characters' && tracePhase === 'characters') ||
      (req.method === 'POST' && req.path === '/api/world-session/heartbeat' && tracePhase === 'heartbeat');
    const traceId = traceableRoute && /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(requestedTraceId)
      ? requestedTraceId
      : undefined;
    const measurements = newMeasurements(traceId);
    if (traceId) res.setHeader('x-mudd-trace-id', traceId);
    const startedAt = performance.now();
    const json = res.json.bind(res);
    res.json = ((body: unknown) => {
      const started = performance.now();
      try { return json(body); }
      finally { measurements.stages.responseSerialization = performance.now() - started; }
    }) as typeof res.json;
    res.once('finish', () => {
      const durationMs = performance.now() - startedAt;
      if (durationMs < 250 && !traceId) return;
      const databaseOperations = formatDatabaseOperationTimings(measurements);
      const loggedMeasurements = {
        stages: measurements.stages,
        queries: measurements.queries,
        poolWaitMs: measurements.poolWaitMs,
        queryMs: measurements.queryMs,
        identityCacheHits: measurements.identityCacheHits,
        identityCacheMisses: measurements.identityCacheMisses,
        worldSessionCacheHits: measurements.worldSessionCacheHits,
        worldSessionCacheMisses: measurements.worldSessionCacheMisses,
        connectionsOpened: measurements.connectionsOpened,
        ...(databaseOperations.length > 0 ? { databaseOperations } : {}),
        ...(traceId ? { queryTimings: measurements.queryTimings } : {}),
      };
      const log = {
        event: traceId ? 'mudd_traced_http_request' : 'slow_http_request',
        requestId: res.locals.requestId,
        ...(traceId ? {
          traceId,
          tracePhase,
          ...(tracePhase === 'command' && typeof req.body?.type === 'string'
            ? { commandType: req.body.type }
            : {}),
        } : {}),
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs),
        measurements: loggedMeasurements,
        eventLoop: eventLoopDelayMs(),
        dbPool: {
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
        },
      };
      (traceId ? console.info : console.warn)(JSON.stringify(log));
    });
    requestMeasurements.run(measurements, next);
  });
  app.use(createTrustedHostGuard(trustedHosts));
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
  app.use(cors({
    credentials: true,
    origin: (origin, callback) => callback(null, Boolean(origin && allowedOrigins.has(origin))),
  }));
  app.use(createOriginGuard(allowedOrigins, (diagnostic) => {
    console.warn('Rejected request by origin guard.', diagnostic);
  }));
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (req, res, next) => {
    const requestedWorldId = req.get('x-mudd-world-instance') || DEMO_WORLD_INSTANCE_ID;
    const runtime = worldRuntimes.get(requestedWorldId);
    if (!runtime) return res.status(404).json({ message: 'That world is not available.' });
    res.locals.worldRuntime = runtime;
    res.locals.worldInstanceId = runtime.worldInstanceId;
    return next();
  });
  if (!e2eAuthEnabled) {
    app.use(clerkMiddleware((req: Request) => ({
      publishableKey: publishableKeyFromHost(getClerkProxyHost(req) ?? '', process.env.CLERK_PUBLISHABLE_KEY),
    })));
  }
  return { app, websocketApp };
}
