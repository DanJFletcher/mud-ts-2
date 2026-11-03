/** Keep process signal ownership out of reusable application/runtime modules. */
export function installProcessSignals(shutdown: () => Promise<void>) {
  const handle = () => { void shutdown(); };
  process.on('SIGTERM', handle);
  process.on('SIGINT', handle);
  return () => { process.off('SIGTERM', handle); process.off('SIGINT', handle); };
}
