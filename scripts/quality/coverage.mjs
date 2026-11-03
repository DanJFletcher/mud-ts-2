import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
export const metrics = ['lines', 'branches', 'functions', 'statements'];
export function coverageResults(coverage, reports) {
  return Object.entries(coverage).flatMap(([name, floors]) => metrics.map(metric => coverageMetric(name, metric, floors, reports[name]?.total)));
}
function coverageMetric(name, metric, floors, report) {
  const measured = report?.[metric]?.pct;
  return { package: name, metric, measured: measured ?? null, limit: floors[metric], failure: typeof measured !== 'number' || !Number.isFinite(measured) || measured < floors[metric] || measured > 100 || measured < 0 };
}
export function readCoverage(cwd, coverage) {
  return Object.fromEntries(Object.entries(coverage).map(([name, config]) => [name, JSON.parse(readFileSync(resolve(cwd, config.path, 'coverage/coverage-summary.json'), 'utf8'))]));
}
