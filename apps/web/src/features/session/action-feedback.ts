export function traceFirstFeedbackPaint(traceId: string | undefined, action: string, startedAt: number): void {
  if (!traceId) return;
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    console.info("[mudd_perf_trace_feedback]", JSON.stringify({
      traceId,
      action,
      actionToFirstFeedbackPaintMs: Math.round((performance.now() - startedAt) * 10) / 10,
    }));
  }));
}