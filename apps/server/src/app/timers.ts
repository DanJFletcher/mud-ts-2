/** Inject background scheduling without replacing process-global timer functions. */
export type RuntimeTimers = Pick<typeof globalThis, "setInterval" | "clearInterval" | "setTimeout" | "clearTimeout">;
export const runtimeTimers: RuntimeTimers = { setInterval, clearInterval, setTimeout, clearTimeout };
