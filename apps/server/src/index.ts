import { startServer } from './app/bootstrap.js';
import { installProcessSignals } from './app/process-signals.js';

const runtime = await startServer(import.meta.url);
export const server = runtime.server;
installProcessSignals(runtime.shutdown);
